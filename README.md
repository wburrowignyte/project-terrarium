# project-terrarium

A Claude Code plugin marketplace from Ignyte Group.

| Plugin | What it does | Docs |
|---|---|---|
| `project-terrarium` | Project maintenance for software delivery engagements (ERD build + Appian architecture review). | [README](plugins/project-terrarium/README.md) |
| `context-guard` | Generic. Watches context size, suggests a handover to a fresh session at natural stopping points, and carries the note across a clear or compaction. | [README](plugins/context-guard/README.md) |

## Install

```bash
claude plugin marketplace add <path-or-git-url-of-this-repo>
claude plugin install <plugin>@project-terrarium-dev
```

If you added this marketplace before the plugins moved under `plugins/`, run
`claude plugin marketplace update project-terrarium-dev`.

## Layout

```
.claude-plugin/marketplace.json   lists the plugins
plugins/<plugin>/                 one self-contained plugin each
tests/<plugin>/                   tests run in CI (.github/workflows/)
```

## Develop

```bash
claude plugin validate .                      # marketplace
claude plugin validate plugins/<plugin>       # one plugin
python -m pytest tests/context-guard
```
