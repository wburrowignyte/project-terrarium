"""Acceptance checks for the context-guard plugin's hooks."""
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

HOOKS = Path(__file__).resolve().parents[2] / "plugins" / "context-guard" / "hooks"
GUARD = HOOKS / "context_guard.py"
BASH = shutil.which("bash")


@pytest.fixture
def project(tmp_path, monkeypatch):
    for key in list(os.environ):
        if key.startswith("CONTEXT_GUARD_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(tmp_path))
    return tmp_path


def usage_line(tokens, sidechain=False, ts=None):
    return {
        "type": "assistant",
        "isSidechain": sidechain,
        "timestamp": ts or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "message": {"role": "assistant", "usage": {
            "input_tokens": 10, "cache_read_input_tokens": tokens - 10,
            "cache_creation_input_tokens": 0}},
    }


def prompt_line(text):
    return {"type": "user", "isSidechain": False, "timestamp": "2026-10-08T12:00:00Z",
            "message": {"role": "user", "content": text}}


def transcript(project, *entries):
    path = project / "transcript.jsonl"
    path.write_text("".join(json.dumps(e) + "\n" for e in entries), encoding="utf-8")
    return str(path)


def run_guard(payload, raw=None, env=None, via_launcher=False):
    stdin = raw if raw is not None else json.dumps(payload)
    if via_launcher:
        cmd = [BASH, str(HOOKS / "run-hook.cmd"), "context-guard"]
    else:
        cmd = [sys.executable, str(GUARD)]
    full_env = dict(os.environ, **(env or {}))
    proc = subprocess.run(cmd, input=stdin.encode(), capture_output=True, env=full_env, timeout=30)
    assert proc.returncode == 0, proc.stderr
    out = proc.stdout.decode().strip()
    return json.loads(out) if out else None


def event(name, tpath, **extra):
    return dict({"hook_event_name": name, "session_id": "s1", "transcript_path": tpath}, **extra)


# 1
@pytest.mark.parametrize("raw", ["", "not json", "[1, 2]", "{\"hook_event_name\": 5}"])
def test_garbage_input_is_silent(project, raw):
    assert run_guard(None, raw=raw) is None


# 2
def test_soft_limit_blocks_stop_once(project):
    t = transcript(project, usage_line(130000))
    assert run_guard(event("UserPromptSubmit", t)) is None
    out = run_guard(event("Stop", t))
    assert out["decision"] == "block"
    assert "130,000" in out["reason"] and "soft limit" in out["reason"]
    assert run_guard(event("Stop", t)) is None


def test_stop_hook_active_defers(project):
    t = transcript(project, usage_line(130000))
    run_guard(event("PostToolUse", t, tool_name="Read"))
    assert run_guard(event("Stop", t, stop_hook_active=True)) is None
    assert run_guard(event("Stop", t))["decision"] == "block"


def test_hard_limit_repeats_every_step(project):
    t = transcript(project, usage_line(210000))
    assert "hard limit" in run_guard(event("Stop", t))["reason"]
    assert run_guard(event("Stop", t)) is None
    t = transcript(project, usage_line(255000))
    assert "hard limit" in run_guard(event("Stop", t))["reason"]


# 3
def test_sidechain_usage_is_ignored(project):
    t = transcript(project, usage_line(130000, sidechain=True))
    run_guard(event("UserPromptSubmit", t))
    assert run_guard(event("Stop", t)) is None


# 4
def commit_event(t, stdout, command="git commit -m x"):
    return event("PostToolUse", t, tool_name="Bash", tool_input={"command": command},
                 tool_response={"stdout": stdout, "stderr": "", "interrupted": False})


def test_milestone_commit_records_stopping_point(project):
    env = {"CONTEXT_GUARD_COMMIT_PATTERN": "gate passed"}
    t = transcript(project, usage_line(60000))
    run_guard(commit_event(t, "[main 9301ab5] X gate passed\n 1 file changed"), env=env)
    assert "milestone commit" in run_guard(event("Stop", t), env=env)["reason"]


def test_command_text_alone_is_not_a_milestone(project):
    env = {"CONTEXT_GUARD_COMMIT_PATTERN": "gate passed"}
    t = transcript(project, usage_line(60000))
    run_guard(commit_event(t, "nothing to commit", command="git commit -m 'gate passed'"), env=env)
    run_guard(commit_event(t, "echo [main 9301ab5] gate passed"), env=env)
    assert run_guard(event("Stop", t), env=env) is None


def test_commit_pattern_is_off_by_default(project):
    t = transcript(project, usage_line(60000))
    run_guard(commit_event(t, "[main 9301ab5] X gate passed"))
    assert run_guard(event("Stop", t)) is None


def test_idle_session_records_stopping_point(project):
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    t = transcript(project, usage_line(130000, ts=old))
    run_guard(event("Stop", t))  # consume the soft limit
    run_guard(event("UserPromptSubmit", t))
    assert "idle" in run_guard(event("Stop", t))["reason"]


# 5
def write_note(project, age_hours=0):
    memory = project / ".claude" / "compact-memory"
    memory.mkdir(parents=True)
    note = memory / "latest.md"
    note.write_text("Task: ship the widget\n", encoding="utf-8")
    stamp = time.time() - age_hours * 3600
    os.utime(note, (stamp, stamp))
    return memory


def test_handover_is_picked_up_once(project):
    memory = write_note(project)
    t = transcript(project)
    out = run_guard(event("UserPromptSubmit", t))
    ctx = out["hookSpecificOutput"]
    assert ctx["hookEventName"] == "UserPromptSubmit"
    assert "ship the widget" in ctx["additionalContext"]
    assert "Picked up the handover" in ctx["additionalContext"]
    assert not (memory / "latest.md").exists() and (memory / "previous.md").exists()
    assert run_guard(event("UserPromptSubmit", t)) is None


def test_stale_handover_is_left_alone(project):
    memory = write_note(project, age_hours=25)
    assert run_guard(event("UserPromptSubmit", transcript(project))) is None
    assert (memory / "latest.md").exists()


# 6
@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_launcher_runs_the_guard(project):
    t = transcript(project, usage_line(130000))
    run_guard(event("UserPromptSubmit", t), via_launcher=True)
    assert run_guard(event("Stop", t), via_launcher=True)["decision"] == "block"


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_launcher_survives_garbage(project):
    assert run_guard(None, raw="garbage", via_launcher=True) is None


# 7
def test_subagent_input_does_nothing(project):
    t = transcript(project, usage_line(130000))
    for key in ("agent_id", "agent_type"):
        assert run_guard(event("Stop", t, **{key: "x"})) is None
    assert not (project / ".claude" / "context-guard").exists()


# 8
@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_project_local_guard_takes_over(project):
    local = project / ".claude" / "hooks"
    local.mkdir(parents=True)
    (local / "context_guard.py").write_text("", encoding="utf-8")
    t = transcript(project, usage_line(130000))
    run_guard(event("UserPromptSubmit", t), via_launcher=True)
    assert run_guard(event("Stop", t), via_launcher=True) is None
    assert not (project / ".claude" / "context-guard").exists()


# Compaction
def test_handover_saved_before_auto_compaction(project):
    t = transcript(project, usage_line(285000))
    out = run_guard(event("Stop", t))
    assert "auto-compacted soon" in out["reason"]
    assert run_guard(event("Stop", t, stop_hook_active=True)) is None
    assert "hard limit" in run_guard(event("Stop", t))["reason"]  # deferred stopping point
    assert run_guard(event("Stop", t)) is None


def test_precompact_writes_fallback_note(project):
    t = transcript(project, prompt_line("build the importer"), usage_line(300000),
                   {"type": "user", "message": {"content": [{"type": "tool_result", "content": "x"}]}},
                   prompt_line("<command-name>/compact</command-name>"))
    assert run_guard(event("PreCompact", t, trigger="auto")) is None
    note = (project / ".claude" / "compact-memory" / "latest.md").read_text(encoding="utf-8")
    assert "build the importer" in note and "tool_result" not in note and "/compact" not in note


def test_precompact_keeps_a_recent_note(project):
    memory = write_note(project)
    run_guard(event("PreCompact", transcript(project, prompt_line("other"))))
    assert "ship the widget" in (memory / "latest.md").read_text(encoding="utf-8")


def test_precompact_stands_down_for_project_hooks(project):
    (project / ".claude").mkdir()
    (project / ".claude" / "settings.json").write_text('{"x": "compact-memory"}', encoding="utf-8")
    run_guard(event("PreCompact", transcript(project, prompt_line("build it"))))
    assert not (project / ".claude" / "compact-memory").exists()


# SessionStart
@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_session_start_loads_note_once(project):
    memory = write_note(project)
    cmd = [BASH, str(HOOKS / "run-hook.cmd"), "session-start"]
    out = subprocess.run(cmd, input=b"{}", capture_output=True, env=dict(os.environ), timeout=30)
    assert out.returncode == 0 and b"ship the widget" in out.stdout
    assert (memory / "previous.md").exists() and not (memory / "latest.md").exists()


def test_old_state_files_are_pruned(project):
    state = project / ".claude" / "context-guard"
    state.mkdir(parents=True)
    old = state / "gone.json"
    old.write_text("{}")
    stamp = time.time() - 8 * 86400
    os.utime(old, (stamp, stamp))
    run_guard(event("UserPromptSubmit", transcript(project)))
    assert not old.exists() and (state / "s1.json").exists()


@pytest.mark.skipif(os.name != "nt", reason="cmd.exe branch of the launcher")
def test_launcher_from_cmd(project):
    t = transcript(project, usage_line(130000))
    cmd = ["cmd", "/c", str(HOOKS / "run-hook.cmd"), "context-guard"]
    for payload in (event("UserPromptSubmit", t), event("Stop", t)):
        proc = subprocess.run(cmd, input=json.dumps(payload).encode(), capture_output=True,
                              env=dict(os.environ), timeout=30)
        assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout.decode().strip())["decision"] == "block"
