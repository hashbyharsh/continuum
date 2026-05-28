# Continuum

**Seamless AI session continuity** — token analytics, context capsule handoffs, and prompt recommendations across all your AI coding tools.

```bash
npm install -g @hashbyharsh/continuum
continuum web
```

Opens a live dashboard at **http://localhost:3737** showing your token usage, costs, and session health across Claude Code, Cursor, Cline, Copilot, and more.

---

## Features

### Token Analytics
Real-time cost and token tracking across every AI coding session — broken down by provider, model, project, and task category (coding, debugging, refactoring, planning, etc.).

### Context Capsule
Automatically detects when a session is approaching its model's context window limit (warning at 70%, critical at 90%). Generate a `.capsule.md` handoff file with a single click — containing a structured summary, key decisions, open questions, and a ready-to-paste continuation prompt for a fresh session or a different model.

### Prompt Recommendations
Analyzes your past prompts for token-wasting patterns and suggests drop-in templates to fix them. Detects: verbose prompts, repeated context, missing cache hints, vague task descriptions, and missing output format constraints.

### Web Dashboard
A self-contained dark-mode dashboard with four tabs:
- **Overview** — KPIs, token charts by provider, cost by category, model breakdown table
- **Sessions** — all sessions sorted by recency with context utilization bars
- **Context Capsule** — alerts for sessions nearing their limit, one-click capsule generation
- **Prompt Tips** — ranked recommendations with copy-paste templates

---

## Supported Providers

| Provider | Log Location |
|---|---|
| Claude Code | `~/.claude/projects/` |
| Claude Desktop / Cowork | `~/Library/Application Support/Claude/local-agent-mode-sessions/` |
| Cursor | `~/.cursor/` |
| Cline | VS Code extension logs |
| Roo Code | VS Code extension logs |
| GitHub Copilot | VS Code extension logs |
| Codex CLI | `~/.codex/` |
| Gemini CLI | `~/.gemini/` |
| OpenCode | `~/.opencode/` |
| Kimi | `~/.kimi/` |

---

## CLI Commands

```bash
# Launch web dashboard (default port 3737)
continuum web

# Print token stats in the terminal
continuum stats

# Generate a context capsule for a session
continuum capsule --session <sessionId>

# Show prompt recommendations
continuum recommend

# List all detected providers
continuum providers

# Filter by provider or date range
continuum stats --provider claude --days 7
```

---

## How Context Capsule Works

When a session hits 70%+ of its model's context window, Continuum flags it. Clicking **Generate Capsule** produces two files in `~/.continuum/capsules/`:

- **`<session>.capsule.md`** — human-readable summary with a continuation prompt
- **`<session>.capsule.json`** — structured data for tooling

Paste the continuation prompt into a new session to pick up exactly where you left off — even on a different model.

---

## Requirements

- Node.js >= 18
- At least one supported AI coding tool installed locally

---

## Install & Update

```bash
# Install
npm install -g @hashbyharsh/continuum

# Update to latest
npm install -g @hashbyharsh/continuum@latest

# Uninstall
npm uninstall -g @hashbyharsh/continuum
```

---

## License

MIT © [Harsh Singh](https://github.com/hashbyharsh)
    