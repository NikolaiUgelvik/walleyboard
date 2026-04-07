# Configuration

Walleyboard reads an optional configuration file to customize agent behavior without UI changes.

## File Location

The configuration file lives at `~/.walleyboard/walleyboard.conf`. If the `WALLEYBOARD_HOME` environment variable is set, the file is read from `$WALLEYBOARD_HOME/walleyboard.conf` instead.

The file is optional. When it is missing or empty, Walleyboard falls back to its default behavior.

## Format

The file uses [TOML](https://toml.io/) syntax. Each top-level section corresponds to an agent adapter.

### Agent Environment Variables

Define environment variables that are merged into the agent's process environment at launch. Each section name must match a recognized agent adapter: `claude-code` or `codex`.

```toml
[claude-code]
ANTHROPIC_API_KEY = "sk-ant-..."
CLAUDE_CODE_MAX_TURNS = "50"

[codex]
OPENAI_API_KEY = "sk-..."
```

Variables defined under `[claude-code]` are only applied when launching Claude Code agents. Variables under `[codex]` are only applied when launching Codex agents.

### Merging Behavior

- Config variables are merged on top of the server's own `process.env`.
- If a variable appears in both `process.env` and the config file, the config file value wins.
- Variables from one agent section are never applied to the other agent.
- All values must be TOML strings. Non-string values (numbers, booleans) are silently ignored.

### Error Handling

- If the file cannot be parsed as valid TOML, an error is logged and the config is ignored entirely (agents launch with the default environment).
- Unrecognized section names (for example `[claude_code]` instead of `[claude-code]`) produce a warning in the server log and are skipped.

### Caching

The config file is read asynchronously and cached in memory for 30 seconds. Changes to the file take effect within 30 seconds without restarting the server.
