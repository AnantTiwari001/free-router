import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR, CONFIG_ENV_PATH, CONFIG_PATH, DEFAULT_FREE_AGENT_PATH, HOME, PACKAGE_ROOT, STATE_PATH } from "./paths.js";
import { checkProvider, commandExists } from "./providers.js";
import { saveConfig } from "./config.js";

const DISCOVERY = {
  antigravity: [
    join(HOME, ".local", "bin", process.platform === "win32" ? "agy.exe" : "agy"),
    join(HOME, ".antigravity", "bin", process.platform === "win32" ? "agy.exe" : "agy"),
    join(HOME, "AppData", "Local", "agy", "bin", "agy.exe")
  ],
  opencode: [join(HOME, ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode")],
  kilo: [join(process.env.APPDATA || join(HOME, "AppData", "Roaming"), "npm", process.platform === "win32" ? "kilo.cmd" : "kilo")],
  freebuff: [join(process.env.APPDATA || join(HOME, "AppData", "Roaming"), "npm", process.platform === "win32" ? "freebuff.cmd" : "freebuff")]
};

const NPM_PACKAGES = {
  opencode: "opencode-ai",
  kilo: "@kilocode/cli",
  freebuff: "freebuff"
};

const OFFICIAL_INSTALLERS = {
  antigravity: process.platform === "win32"
    ? ["powershell.exe", ["-NoProfile", "-Command", "irm antigravity.google/cli/install.ps1 | iex"]]
    : ["bash", ["-lc", "curl -fsSL antigravity.google/cli/install.sh | bash"]]
};

const PROVIDER_HINTS = {
  antigravity: "Install the Antigravity CLI (`curl -fsSL antigravity.google/cli/install.sh | bash`, or `irm antigravity.google/cli/install.ps1 | iex` on Windows), then run `agy` once to sign in.",
  opencode: "Install OpenCode (`npm install -g opencode-ai`), then `fr login opencode`.",
  kilo: "Install Kilo (`npm install -g @kilocode/cli`), then `fr login kilo`.",
  freebuff: "Install Freebuff (`npm install -g freebuff`), then `fr login freebuff`. Automated runs need a POSIX pty (Linux/macOS/WSL).",
  openrouter_image: "Needs an OpenRouter key; image generation uses the free Recraft model.",
  openrouter: "Install free-agent, or set FREE_AGENT_PATH, and set OPENROUTER_API_KEY."
};

function firstExisting(paths) {
  return paths.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

export function discoverFreeAgent(config) {
  return firstExisting([
    process.env.FREE_AGENT_PATH,
    config.freeAgentPath,
    join(HOME, "personal", "free-agent", "src", "cli.ts"),
    join(PACKAGE_ROOT, "..", "free-agent", "src", "cli.ts"),
    join(HOME, "free-agent", "src", "cli.ts"),
    DEFAULT_FREE_AGENT_PATH
  ]);
}

function parseEnvKey(file) {
  if (!file || !existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(OPENROUTER_API_KEY|OPEN_ROUTER_API_KEY)\s*=\s*(.+?)\s*$/.exec(line);
    if (match) return match[2].replace(/^["']|["']$/g, "");
  }
  return null;
}

export function discoverOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY) {
    return { key: process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_API_KEY, source: "environment" };
  }
  for (const file of [CONFIG_ENV_PATH, join(HOME, "personal", ".env"), join(process.cwd(), ".env"), join(PACKAGE_ROOT, "..", ".env")]) {
    const key = parseEnvKey(file);
    if (key) return { key, source: file };
  }
  return { key: null, source: null };
}

function installProvider(name, quiet) {
  const pkg = NPM_PACKAGES[name];
  const official = OFFICIAL_INSTALLERS[name];
  if (!pkg && !official) return { ok: false, label: null, output: "no installer mapping" };
  const [command, args] = official ?? [process.platform === "win32" ? "npm.cmd" : "npm", ["install", "-g", pkg]];
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: official ? false : process.platform === "win32",
    timeout: 600000
  });
  return {
    ok: result.status === 0,
    label: pkg ?? (process.platform === "win32" ? "official PowerShell installer" : "official shell installer"),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(-1000)
  };
}

function discoverProviderCommands(config) {
  let changed = false;
  for (const [name, provider] of Object.entries(config.providers)) {
    if (commandExists(provider.command, config)) continue;
    const found = DISCOVERY[name]?.find((candidate) => existsSync(candidate));
    if (found) {
      provider.command = found;
      changed = true;
    }
  }
  return changed;
}

export function runSetup(config, { installMissing = false, checkAuth = false, quiet = false } = {}) {
  const warnings = [];
  const installedPackages = [];
  let changed = false;

  const freeAgent = discoverFreeAgent(config);
  if (freeAgent && freeAgent !== config.freeAgentPath) {
    config.freeAgentPath = freeAgent;
    changed = true;
  }
  if (!freeAgent) warnings.push("free-agent not found; OpenRouter chat routing will be unavailable until FREE_AGENT_PATH is set.");

  const keyInfo = discoverOpenRouterKey();
  if (keyInfo.key && keyInfo.source !== "environment" && keyInfo.source !== CONFIG_ENV_PATH) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_ENV_PATH, `OPENROUTER_API_KEY=${keyInfo.key}\n`);
    try {
      chmodSync(CONFIG_ENV_PATH, 0o600);
    } catch {}
  }
  if (!keyInfo.key) warnings.push("No OpenRouter key found; set OPENROUTER_API_KEY or put it in the config .env.");
  if (existsSync(CONFIG_ENV_PATH)) {
    try { chmodSync(CONFIG_ENV_PATH, 0o600); } catch {}
  }

  if (discoverProviderCommands(config)) changed = true;

  if (installMissing) {
    for (const [name, provider] of Object.entries(config.providers)) {
      if (!provider.enabled || (!NPM_PACKAGES[name] && !OFFICIAL_INSTALLERS[name])) continue;
      if (commandExists(provider.command, config)) continue;
      const result = installProvider(name, quiet);
      installedPackages.push({ name, package: result.label, ok: result.ok });
      if (!result.ok) warnings.push(`Could not install ${name} (${result.label}). ${result.output.split("\n").pop() ?? ""}`);
    }
    if (discoverProviderCommands(config)) changed = true;
  }

  const providers = Object.entries(config.providers).map(([name, provider]) => {
    let installed = commandExists(provider.command, config);
    if (name === "openrouter") installed = Boolean(freeAgent);
    if (name === "openrouter_image") installed = Boolean(keyInfo.key);
    let auth = null;
    if (checkAuth && installed && name !== "openrouter_image") {
      auth = checkProvider(provider, config, name);
    }
    return {
      name,
      enabled: provider.enabled,
      installed,
      command: provider.command,
      auth: auth ? (auth.ok ? "ok" : auth.detail) : null,
      hint: installed ? null : PROVIDER_HINTS[name] ?? "Install this provider or disable it with `fr disable " + name + "`."
    };
  });

  if (changed) saveConfig(config);

  return {
    os: platform(),
    arch: arch(),
    node: process.version,
    packageRoot: PACKAGE_ROOT,
    configPath: CONFIG_PATH,
    statePath: STATE_PATH,
    envPath: CONFIG_ENV_PATH,
    freeAgentPath: freeAgent,
    openrouterKey: keyInfo.key ? "configured" : "missing",
    providers,
    installedPackages,
    warnings
  };
}

export function printSetup(report) {
  console.log(`free-router setup — ${report.os}/${report.arch} · node ${report.node}`);
  console.log(`config  ${report.configPath}`);
  console.log(`state   ${report.statePath}`);
  console.log(`env     ${report.envPath} (${report.openrouterKey})`);
  console.log(`free-agent ${report.freeAgentPath ?? "not found"}`);
  console.log("\nproviders:");
  for (const provider of report.providers) {
    const status = provider.installed ? "ready  " : "missing";
    const auth = provider.auth ? `  auth: ${provider.auth}` : "";
    console.log(`  ${status}  ${provider.name.padEnd(16)} ${provider.enabled ? "on " : "off"}${auth}`);
    if (provider.hint) console.log(`           ${provider.hint}`);
    if (provider.auth && provider.auth !== "ok") console.log(`           run: fr login ${provider.name}`);
  }
  if (report.warnings.length) {
    console.log("\nwarnings:");
    for (const warning of report.warnings) console.log(`  - ${warning}`);
  }
  console.log("\nNext: fr doctor  ·  fr --dry \"fix the login bug\"  ·  fr");
}
