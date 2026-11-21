# Agent install prompt

Give this file, or the output of `fr install-prompt`, to an agent that has shell access to the target device.

## Generate a tailored prompt

From the repo on any machine:

```sh
node bin/fr.js install-prompt linux
node bin/fr.js install-prompt windows --repo 'C:\tools\free-router' --extra "Install only Kilo and OpenCode; skip Freebuff."
node bin/fr.js install-prompt macos --out install.md
```

Or after installing:

```sh
fr install-prompt --target linux --extra "Use the existing Node 22.18+ install."
```

## Copy-paste prompt

Replace `{{OS}}` and `{{REPO}}` before sending.

```text
Install the free-router CLI on this {{OS}} device.

Repository/source: {{REPO}}
Requirements: Node.js 22.18+, npm, internet.

1. Verify `node --version` is v22.18+ and npm works. If Node is missing, install Node 22.18+ LTS first.
2. Install the CLI:
   - Linux/macOS: `bash "{{REPO}}/scripts/install.sh"`
   - Windows: `powershell -ExecutionPolicy Bypass -File "{{REPO}}\scripts\install.ps1"`
   - Manual: `npm install -g "{{REPO}}"`
   If global install fails on Linux with permissions, use `npm install -g --prefix "$HOME/.local" "{{REPO}}"` and add `$HOME/.local/bin` to PATH.
3. Run setup:
   - `fr setup` captures the readiness report and creates config/state directories.
   - Use `fr setup --json` if machine-readable output is useful.
   - Use `fr setup --install-missing` to install missing provider CLIs for enabled providers.
   - Use `fr setup --install-missing --auth` for the combined managed install-and-check flow: install missing CLIs, then check auth for what is installed.
4. Install only missing providers the user wants:
   - Managed: `fr setup --install-missing` installs npm-based Kilo/OpenCode/Freebuff and the official Antigravity installer for enabled-but-missing providers.
   - Or run the manual commands:
     - Kilo: `npm install -g @kilocode/cli`
     - OpenCode: `npm install -g opencode-ai`
     - Freebuff: `npm install -g freebuff` (automated TUI use: Linux/macOS/WSL only)
     - Antigravity: install the official `agy` CLI, then sign in.
5. Run `fr doctor`. For providers that are installed but not logged in, run `fr login <provider>`; for a sequential run of available login flows, use `fr login all`. Pause and tell the user exactly what to do when a login needs a browser or human.
6. OpenRouter: put `OPENROUTER_API_KEY` in the environment or the config `.env`. Never echo or commit the key.
7. Verify with `fr --version`, `fr setup --install-missing --auth`, `fr doctor`, `fr status`, and `fr --dry "fix a null pointer bug"`.
8. Report: installed version, config path, provider readiness, warnings, and commands run.

Constraints: do not print secrets, do not enable paid billing, do not edit config files directly (use fr commands), and do not install large packages without asking.
```

## Device setup after install

```sh
fr setup
fr setup --install-missing --auth
fr doctor
fr login <provider>      # run a provider's login flow
fr login all            # run all available provider login flows
fr status                # budgets and cooldowns
fr --dry "..."           # show the route without calling a model
```

`fr setup` is idempotent. It writes the config only when something changed.
