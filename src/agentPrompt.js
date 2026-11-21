import { arch, platform } from "node:os";
import { PACKAGE_ROOT } from "./paths.js";

const OS_LABEL = { win32: "Windows", linux: "Linux", darwin: "macOS" };

export function buildAgentPrompt({ target = platform(), installDir = PACKAGE_ROOT, extra = "" } = {}) {
  const normalized = { windows: "win32", win: "win32", win32: "win32", linux: "linux", macos: "darwin", mac: "darwin", darwin: "darwin" }[String(target).toLowerCase()] ?? target;
  const os = OS_LABEL[normalized] ?? normalized;
  const dir = normalized === "win32" && /^[A-Za-z]:/.test(installDir) ? installDir.replaceAll("/", "\\") : installDir;
  const install = normalized === "win32"
    ? `powershell -ExecutionPolicy Bypass -File "${dir}\\scripts\\install.ps1"`
    : `bash "${dir}/scripts/install.sh"`;
  const verify = normalized === "win32"
    ? `fr setup --install-missing --auth; fr doctor; fr --dry "fix a null pointer bug"`
    : `fr setup --install-missing --auth && fr doctor && fr --dry "fix a null pointer bug"`;
  const prefixNote = normalized === "win32"
    ? ""
    : `\n   - If global install fails with permissions on Linux, retry with \`npm install -g --prefix "$HOME/.local" "${dir}"\` and ensure \`$HOME/.local/bin\` is on PATH.`;

  return `# Install free-router on ${os}

You are installing the \`free-router\` CLI on a ${os}/${arch()} machine. Work non-interactively where possible, do not print secrets, and stop only for logins that require a human.

Repository: ${installDir}
Requirement: Node.js 22.18 or newer, npm, and an internet connection.

## Steps

1. Check prerequisites.
   - \`node --version\` must be v22.18+.
   - \`npm --version\` must work.
   - If Node is missing, install Node 22.18+ LTS using the official installer for ${os}, then continue.

2. Install the CLI from this repository.
   - Preferred: \`${install}\`
   - Equivalent manual install: \`npm install -g "${dir}"\`${prefixNote}
   - Verify: \`fr --version\` and \`fr --help\`.

3. Configure this device.
   - Run: \`fr setup\`
   - Use \`fr setup --json\` if you need machine-readable output.
   - Use \`fr setup --install-missing\` to install missing provider CLIs for enabled providers.
   - Use \`fr setup --install-missing --auth\` for the combined managed install-and-check flow. It installs missing CLIs, then checks auth for what is installed.
   - This creates the config/state directories, discovers free-agent, imports an OpenRouter key when one is available, and reports which provider CLIs are missing.

4. Install only the missing provider CLIs that the user wants.
   - Managed: \`fr setup --install-missing\` installs npm-based Kilo/OpenCode/Freebuff and the official Antigravity installer for enabled-but-missing providers.
   - Or run the manual commands:
     - Kilo: \`npm install -g @kilocode/cli\`
     - OpenCode: \`npm install -g opencode-ai\`
     - Freebuff: \`npm install -g freebuff\` (automated TUI use works on Linux/macOS/WSL, not native Windows)
     - Antigravity: install the official Antigravity CLI (\`agy\`) and sign in once.
   - Do not reinstall providers that already exist. Ask before installing large global packages.

5. Authenticate providers.
   - Run \`fr doctor\` first.
   - Run \`fr login <provider>\`; for a sequential run of available login flows, use \`fr login all\`.
   - Interactive login may require a browser or a human; pause and tell the user exactly what to do.

6. Configure OpenRouter (optional but recommended).
   - Put \`OPENROUTER_API_KEY=...\` in the environment or in \`fr setup\`'s reported env path.
   - Never echo the key or commit it. The setup command copies it with owner-only permissions when it finds one.
   - Chat routing uses \`free-agent\`; image generation calls OpenRouter directly.

7. Verify end to end.
   - \`${verify}\`
   - \`fr status\` should show provider budgets and no unexpected cooldowns.
   - \`fr doctor\` should be clean, or list only providers the user chose to skip.
   - Do not make a paid API call to test.

## Constraints

- Do not edit files under the user's config directory except through \`fr setup\`, \`fr cap\`, \`fr enable\`, \`fr disable\`, \`fr router\`, or \`fr reset\`.
- Do not print API keys, tokens, or full environment dumps.
- Do not install paid models or enable paid billing.
- If a provider is unsupported on this OS, leave it enabled but explain the limitation; free-router fails over cleanly.
- Report the final result as: installed version, config path, provider readiness, warnings, and the exact verification commands run.
${extra ? `\n## Additional instructions\n\n${extra}\n` : ""}`;
}
