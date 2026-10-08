#!/usr/bin/env python3
"""context-guard: watch context size, record stopping points, ask about a handover.

Runs on UserPromptSubmit, PostToolUse, Stop, PreCompact and SessionStart.
Reads the hook JSON from stdin.
Stopping points are only recorded while a task runs; the Stop hook asks the
user about them once the task is done. This script must never fail a session.
"""
import datetime
import json
import os
import re
import sys
import time

TAIL_BYTES = 4 * 1024 * 1024
COMMIT_MIN_CTX = 50000
IDLE_SECONDS = 60 * 60
FRESH_NOTE_SECONDS = 60 * 60
FALLBACK_PROMPTS = 5
# Measured: auto-compaction fires when the next request would pass roughly
# (compaction window - 33K) tokens, between tool calls as well as between turns.
COMPACTION_RESERVE = 33000
# The transcript's usage lags by the tool result that just came back, which can
# be ~25K tokens; ask for the handover this far ahead of compaction.
COMPACT_MARGIN = 30000
CHARS_PER_TOKEN = 3
STATE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60


def env_int(name, default):
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def env_float(name, default):
    try:
        return float(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


# The window auto-compaction measures against: the smaller of the model's
# context window and autoCompactWindow. 200K is the safe default.
WINDOW = env_int("CONTEXT_GUARD_WINDOW", 200000)
COMPACT_AT = env_int("CONTEXT_GUARD_COMPACT_AT", WINDOW - COMPACTION_RESERVE - COMPACT_MARGIN)
SOFT = env_int("CONTEXT_GUARD_SOFT", min(120000, WINDOW // 2))
HARD = max(env_int("CONTEXT_GUARD_HARD", min(200000, COMPACT_AT - 15000)), SOFT)
STEP = max(env_int("CONTEXT_GUARD_STEP", 50000), 1)
COMMIT_PATTERN = os.environ.get("CONTEXT_GUARD_COMMIT_PATTERN", "")
HANDOVER_MAX_AGE_HOURS = env_float("CONTEXT_GUARD_HANDOVER_MAX_AGE", 24)

HANDOVER_SPEC = (
    "Overwrite {path} with a handover note under 40 lines: the task in play, "
    "the open steps, decisions not yet written down anywhere, and anything a "
    "fresh session would otherwise have to re-derive."
)


# Outside .claude/, which Claude Code treats as sensitive: writing a note there
# always asks for permission, even mid-task.
GUARD_DIR = ".context-guard"


def project_dir(data):
    return os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()


def read_context(transcript_path):
    """Return (tokens, timestamp) from the last main-thread usage line."""
    if not transcript_path or not os.path.isfile(transcript_path):
        return 0, None
    with open(transcript_path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - TAIL_BYTES))
        tail = f.read()
    for raw in reversed(tail.splitlines()):
        if b'"usage"' not in raw:
            continue
        try:
            entry = json.loads(raw.decode("utf-8", "replace"))
        except ValueError:
            continue  # includes the line cut in half by the tail read
        if not isinstance(entry, dict) or entry.get("isSidechain"):
            continue
        message = entry.get("message")
        usage = message.get("usage") if isinstance(message, dict) else None
        if not isinstance(usage, dict):
            continue
        tokens = sum(
            int(usage.get(k) or 0)
            for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
        )
        if tokens == 0:
            continue  # synthetic messages carry an all-zero usage block
        return tokens, entry.get("timestamp")
    return 0, None


def parse_timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def band_of(ctx):
    if ctx < SOFT:
        return 0
    if ctx < HARD:
        return 1
    return 2 + (ctx - HARD) // STEP


def load_state(path):
    try:
        with open(path, encoding="utf-8") as f:
            state = json.load(f)
        if isinstance(state, dict):
            return state
    except (OSError, ValueError):
        pass
    return {}


def save_state(path, state):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, path)


def prune_state(state_dir):
    cutoff = time.time() - STATE_MAX_AGE_SECONDS
    try:
        names = os.listdir(state_dir)
    except OSError:
        return
    for name in names:
        path = os.path.join(state_dir, name)
        try:
            if name.endswith(".json") and os.path.getmtime(path) < cutoff:
                os.remove(path)
        except OSError:
            pass


def tool_output(response):
    if isinstance(response, str):
        return response
    if isinstance(response, dict):
        parts = [response.get(k) for k in ("stdout", "output")]
        return "\n".join(p for p in parts if isinstance(p, str))
    return ""


def is_milestone_commit(output):
    if not COMMIT_PATTERN or not output:
        return False
    try:
        regex = re.compile(
            r"^\[[^\]\s]+ [0-9a-f]{7,}\] .*(?:" + COMMIT_PATTERN + ")",
            re.IGNORECASE | re.MULTILINE,
        )
    except re.error:
        return False
    return bool(regex.search(output))


def describe(reason, ctx):
    if reason == "soft":
        return "it passed the soft limit of {:,} tokens".format(SOFT)
    if reason == "hard":
        return "it is past the hard limit of {:,} tokens".format(HARD)
    if reason == "commit":
        return "a milestone commit just landed, which is a natural break"
    if reason == "idle":
        return ("the session sat idle for over an hour, so the last prompt re-read "
                "the whole context at full price; another long break will do the same")
    return reason


def ask_user(ctx, pending, handover_path):
    reasons = "; ".join(describe(r, ctx) for r in pending)
    return (
        "[context-guard] The task you just finished is done; do not redo or extend it. "
        "Tell the user in 2-3 lines that this session's context is about {ctx:,} tokens "
        "because {reasons}, that every call re-sends all of it, and that you recommend "
        "a handover to a fresh session. Then ask them to choose:\n"
        "  1. write the handover and start a fresh session\n"
        "  2. write the handover only\n"
        "  3. keep going\n"
        "Write nothing and clear nothing until they answer.\n"
        "On 1 or 2: " + HANDOVER_SPEC + "\n"
        "On 1, after writing it: if a tool that clears this session is available (the "
        "Claude desktop app has offered one named mcp__ccd_session_mgmt__clear_session; "
        "look for it with ToolSearch), tell the user the window will go empty and that "
        "any message they send picks the handover up; if a set_session_title tool is "
        "also available, you may title the session \"Handover ready - send any "
        "message\"; then clear the session. Without such a tool, tell them to run /clear "
        "and then send any message."
    ).format(ctx=ctx, reasons=reasons, path=handover_path)


def prepare_for_compaction(ctx, handover_path, at_stop):
    then = ("then tell the user in one line that a handover note is saved in case the "
            "context is compacted, and stop." if at_stop else
            "then carry on with the task exactly where you left off, without comment.")
    return (
        "[context-guard] This session's context is about {ctx:,} tokens and will be "
        "auto-compacted soon. Before anything else, without asking the user: "
        + HANDOVER_SPEC + " Keep it current as of this moment; " + then
    ).format(ctx=ctx, path=handover_path)


def stands_down(root):
    """A hook in the project's settings already handles compact-memory handovers."""
    try:
        with open(os.path.join(root, ".claude", "settings.json"), encoding="utf-8") as f:
            hooks = json.load(f).get("hooks")
    except (OSError, ValueError, AttributeError):
        return False
    if not isinstance(hooks, dict):
        return False
    for groups in hooks.values():
        for group in groups if isinstance(groups, list) else []:
            entries = group.get("hooks") if isinstance(group, dict) else None
            for hook in entries if isinstance(entries, list) else []:
                command = hook.get("command") if isinstance(hook, dict) else None
                if isinstance(command, str) and "compact-memory" in command:
                    return True
    return False


def recent_prompts(transcript_path, limit):
    """Return [(timestamp, text)] for the last few prompts the user typed."""
    if not transcript_path or not os.path.isfile(transcript_path):
        return []
    with open(transcript_path, "rb") as f:
        f.seek(0, os.SEEK_END)
        f.seek(max(0, f.tell() - TAIL_BYTES))
        tail = f.read()
    found = []
    for raw in reversed(tail.splitlines()):
        if b'"user"' not in raw:
            continue
        try:
            entry = json.loads(raw.decode("utf-8", "replace"))
        except ValueError:
            continue
        if (not isinstance(entry, dict) or entry.get("type") != "user"
                or entry.get("isSidechain") or entry.get("isMeta")):
            continue
        content = (entry.get("message") or {}).get("content")
        if isinstance(content, list):
            if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
                continue
            content = "\n".join(b.get("text", "") for b in content
                                if isinstance(b, dict) and b.get("type") == "text")
        if not isinstance(content, str):
            continue
        text = " ".join(content.split())
        if not text or text.startswith("<") or text.startswith("[context-guard]"):
            continue  # slash-command wrappers and our own injections
        found.append((entry.get("timestamp") or "", text[:400]))
        if len(found) >= limit:
            break
    return list(reversed(found))


def write_fallback_note(memory_dir, transcript_path):
    """At compaction, keep a recent handover note; otherwise write a thin one."""
    latest = os.path.join(memory_dir, "latest.md")
    try:
        if time.time() - os.path.getmtime(latest) < FRESH_NOTE_SECONDS:
            return
    except OSError:
        pass
    prompts = recent_prompts(transcript_path, FALLBACK_PROMPTS)
    if not prompts:
        return
    lines = [
        "# Handover (automatic fallback, written at compaction)",
        "",
        "No handover note was written before this compaction. These are the last",
        "requests the user typed; check them against the compaction summary.",
        "",
    ]
    lines += ["- {} {}".format(stamp[:16].replace("T", " "), text).strip() for stamp, text in prompts]
    os.makedirs(memory_dir, exist_ok=True)
    with open(latest, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def output_chars(response):
    """Rough size of a tool result the transcript's usage does not count yet."""
    if isinstance(response, str):
        return len(response)
    try:
        return len(json.dumps(response))
    except (TypeError, ValueError):
        return 0


def pick_up_handover(memory_dir):
    latest = os.path.join(memory_dir, "latest.md")
    try:
        mtime = os.path.getmtime(latest)
    except OSError:
        return None
    if time.time() - mtime > HANDOVER_MAX_AGE_HOURS * 3600:
        return None
    with open(latest, encoding="utf-8", errors="replace") as f:
        note = f.read()
    os.replace(latest, os.path.join(memory_dir, "previous.md"))  # load it once
    written = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
    return (
        "[context-guard] A previous session left this handover note (written {when}). "
        "Open your reply with \"Picked up the handover from {when}: <one-line gist>\", "
        "then carry on with the user's message.\n\n{note}"
    ).format(when=written, note=note.strip())


def run(data):
    if data.get("agent_id") or data.get("agent_type"):
        return  # subagents have their own context; only the main thread matters
    event = data.get("hook_event_name")
    session_id = str(data.get("session_id") or "")
    if not event or not re.match(r"^[A-Za-z0-9_.-]+$", session_id):
        return

    root = project_dir(data)
    if event == "PreCompact":
        if not stands_down(root):
            write_fallback_note(os.path.join(root, GUARD_DIR),
                                data.get("transcript_path"))
        return
    if event == "SessionStart":  # after a compaction or /clear (see the matcher)
        if not stands_down(root):
            text = pick_up_handover(os.path.join(root, GUARD_DIR))
            if text:
                print(json.dumps({"hookSpecificOutput": {
                    "hookEventName": event, "additionalContext": text}}))
        return

    state_dir = os.path.join(root, GUARD_DIR, "state")
    memory_dir = os.path.join(root, GUARD_DIR)
    state_path = os.path.join(state_dir, session_id + ".json")
    state = load_state(state_path)
    pending = [p for p in state.get("pending", []) if isinstance(p, str)]
    ctx, stamp = read_context(data.get("transcript_path"))

    output = None

    def note(reason):
        if reason not in pending:
            pending.append(reason)

    first_run = not state.get("started")
    if first_run:
        state["started"] = time.time()
        prune_state(state_dir)

    band = band_of(ctx)
    if band > int(state.get("band") or 0):
        note("soft" if band == 1 else "hard")
    elif band < int(state.get("band") or 0):
        # A compaction shrank the context; its size is no longer a reason to stop.
        pending[:] = [p for p in pending if p not in ("soft", "hard")]
    state["band"] = band  # drops after a compaction, which re-arms the warnings
    if ctx < int(state.get("prepped_at") or 0):
        state["prepped_at"] = 0  # a compaction shrank the context: re-arm
    handover_path = os.path.join(memory_dir, "latest.md")
    estimate = ctx
    if event == "PostToolUse":
        estimate += output_chars(data.get("tool_response")) // CHARS_PER_TOKEN
    prep = (0 < COMPACT_AT <= estimate and not state.get("prepped_at")
            and not stands_down(root))

    if prep and event in ("PostToolUse", "UserPromptSubmit"):
        # Compaction can fire between tool calls, so this cannot wait for Stop.
        output = {"hookSpecificOutput": {"hookEventName": event, "additionalContext":
                                         prepare_for_compaction(estimate, handover_path, False)}}
        state["prepped_at"] = max(ctx, 1)

    if event == "PostToolUse":
        if (data.get("tool_name") in ("Bash", "PowerShell") and ctx >= COMMIT_MIN_CTX
                and is_milestone_commit(tool_output(data.get("tool_response")))):
            note("commit")

    elif event == "UserPromptSubmit":
        last = parse_timestamp(stamp)
        if ctx >= SOFT and last is not None and time.time() - last > IDLE_SECONDS:
            note("idle")
        if ctx == 0 and first_run:
            text = pick_up_handover(memory_dir)
            if text:
                output = {"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}

    elif event == "Stop" and not data.get("stop_hook_active"):
        if prep:
            # Pending stopping points wait for a later Stop.
            output = {"decision": "block",
                      "reason": prepare_for_compaction(ctx, handover_path, True)}
            state["prepped_at"] = max(ctx, 1)
        elif pending:
            reason = ask_user(ctx, pending, handover_path)
            output = {"decision": "block", "reason": reason}
            pending = []

    state["pending"] = pending
    save_state(state_path, state)  # before output, so a failed save cannot repeat a block
    if output:
        print(json.dumps(output))


def main():
    try:
        raw = sys.stdin.buffer.read().decode("utf-8", "replace")
        data = json.loads(raw) if raw.strip() else None
        if isinstance(data, dict):
            run(data)
    except Exception:
        pass  # never fail a session
    sys.exit(0)


if __name__ == "__main__":
    main()
