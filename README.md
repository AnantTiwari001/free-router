# free-router

Pools the free tiers already on this machine and sends each task to the best model for it.
It reuses the installed CLIs instead of reimplementing them.

## Install

Requires **Node.js 22.18+** and npm.

Linux / macOS, from a checkout or unpacked tarball:

```sh
bash scripts/install.sh
# or: npm install -g .
fr setup
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
# or: npm install -g .
fr setup
```

Build a portable tarball for another device:

```sh
npm pack
# copy free-router-0.2.0.tgz to the other machine, then:
npm install -g free-router-0.2.0.tgz
fr setup
```

If global install needs a user prefix on Linux:

```sh
FR_PREFIX="$HOME/.local" bash scripts/install.sh
# ensure $HOME/.local/bin is on PATH
```

`fr setup` creates config/state directories, discovers `free-agent`, imports an OpenRouter key when it can find one, and reports which provider CLIs are missing. Use `fr setup --json` for machine-readable output, or `fr setup --install-missing` to install the npm-based providers it can (Kilo, OpenCode, Freebuff).

## Install with another agent

Generate a copy-paste prompt tailored to the target OS:

```sh
node bin/fr.js install-prompt linux --extra "Use WSL and do not install Freebuff"
node bin/fr.js install-prompt windows --repo 'C:\tools\free-router' --out install.md
fr install-prompt macos --extra "Use the existing Node install"
```

The prompt is also documented in [AGENT_INSTALL.md](AGENT_INSTALL.md). It tells an agent to check Node, install the CLI, run `fr setup`, install missing provider CLIs when requested, pause for interactive logins, protect the API key, and verify with `fr doctor` and `fr --dry`.

## Providers

| Provider | How it is used | Real published limit |
|---|---|---|
| Antigravity CLI (`agy`) | `agy -p … --model …` | No published request count. Quota is capacity/work-based: weekly refresh on free, 5-hour on Pro/Ultra. `/usage` in agy shows real remaining quota. |
| OpenCode | `opencode run -m …` | No published daily cap for most free models; LongCat is 100/day. |
| Kilo Code | `kilo run -m …` | 200 requests/hour per IP for free models. |
| Freebuff | TUI driven through `script` | Hours/day: 30 US, 21/12 in several countries, 5 elsewhere, 4 over VPN. Unlimited messages in each 1-hour session. |
| OpenRouter chat | delegates to `free-agent` | 1000 free requests/day if >= $10 credits ever purchased, otherwise 50/day; 20/minute. |
| OpenRouter images | `POST /api/v1/images` | `recraft/recraft-v4.1-flash-v2:free` is a live free image-output model; generation has not consumed the 1000/day chat-request bucket in testing. |

Install/login the providers you want:

```sh
# Managed dependency setup (only providers that are enabled and missing)
fr setup --install-missing --auth

# Individual steps
fr setup            # discover paths, import key, report missing providers
fr setup --install-missing
fr setup --auth     # check auth for installed providers
fr doctor
fr login <provider>
fr login all

npm install -g @kilocode/cli && fr login kilo
npm install -g opencode-ai && fr login opencode
npm install -g freebuff && fr login freebuff
curl -fsSL https://antigravity.google/cli/install.sh | bash   # Linux/macOS
# Windows PowerShell: irm https://antigravity.google/cli/install.ps1 | iex
fr login antigravity
```

Notes:
- Antigravity installs the official `agy` CLI and authenticates through the OS browser/keyring flow; `fr login antigravity` runs `agy` for the first-time interactive sign-in.
- OpenCode uses the npm install line above for the free-model build tested here; OpenCode 2 may use `@opencode/cli`.
- Kilo can use its free gateway without login, but the login flow is available.
- Freebuff automation needs a POSIX pty and therefore Linux/macOS/WSL; native Windows is not supported for automated TUI runs.

The caps shown by `fr status` are soft, local guards, not vendor numbers. Tune with `fr cap`.

## Task choice

- `-t`/`/task` pins a task; otherwise `auto` runs per prompt.
- Obvious regex matches (one signal) are classified locally with zero requests.
- Ambiguous prompts are classified by a cheap decision model — by default Kilo's Lightning free model — using a JSON-ish "one label" reply. This does **not** use the OpenRouter 1000/day bucket.
- Decisions are cached by normalized prompt hash; repeat prompts cost 0 routing requests.
- `fr router off` falls back to regex + length only. `fr router` shows settings.

## Limits and failover

- Each provider has a soft cap and period (`day` or `hour`); Kilo is tracked hourly at its real 200/hour.
- Utilization is part of the score (`routeIndex + used/cap * 3`), so load spreads before a cap is hit.
- Failed calls cool down (default 5 min; rate-limit failures longer). This avoids hammering a provider that is already throttling you and gives other providers a turn.
- Counters reset at UTC midnight/day or hourly boundary. `fr reset <provider|all>` clears a wrong cooldown.

## Use

```sh
fr                                   # interactive session
fr "fix the null check in auth.ts"   # one-shot, task auto-detected
fr -t code -w "add tests for parser" # explicit task, allow file writes
fr -p kilo -t plan "design X"        # pin provider
fr -t image_gen "create a sunrise image"  # saves an image in cwd
fr status                            # budgets, cooldowns, last errors
fr models                            # routing table
fr doctor                            # binaries / logins
fr setup                             # configure this device
fr router [on|off]                   # semantic router
fr login <provider>
fr reset <provider|all>
fr cap <provider> <n>
```

REPL commands: `/task`, `/use`, `/effort`, `/router`, `/status`, `/models`, `/doctor`, `/reset`, `/exit`.

Tasks: `auto`, `plan`, `code`, `code_search`, `content`, `documents`, `vision`, `audio`, `fast`, `image_gen`.

## OpenRouter

- Chat uses `free-agent`; set `FREE_AGENT_PATH` if it is not in a discovered location.
- Put `OPENROUTER_API_KEY` in the environment, or let `fr setup` copy it to the config `.env` with owner-only permissions.
- Never commit the key. Image generation uses the same key and a free image model.

## Platform notes

- Windows: npm `.cmd`/`.bat` shims are handled through `cmd.exe`; config lives under `%APPDATA%\free-router`, state under `%LOCALAPPDATA%\free-router\state`.
- Linux: XDG paths are respected (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`); defaults are `~/.config/free-router` and `~/.local/state/free-router`.
- macOS uses `~/.config/free-router` and `~/.local/state/free-router`.
- Freebuff is TUI-only and needs a POSIX pty. Automated runs work on Linux/macOS/WSL, not native Windows; free-router reports the limitation and fails over.
- Dead HTTP proxies are detected and dropped for child processes.
