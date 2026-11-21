import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { loadConfig, saveConfig, TASKS } from "./config.js";
import { CONFIG_ENV_PATH, CONFIG_PATH, PACKAGE_ROOT, STATE_PATH } from "./paths.js";
import { printSetup, runSetup } from "./setup.js";
import { buildAgentPrompt } from "./agentPrompt.js";
import { clearProvider, loadState, remaining, stats, summary, isCooling } from "./ledger.js";
import { chooseTask } from "./decide.js";
import { checkProvider, commandExists, providerCommand, runLogin } from "./providers.js";
import { dispatch, preview } from "./router.js";

const HELP = `free-router — pool the free tiers of your coding CLIs

Usage:
  fr                          interactive session
  fr "prompt"                 one-shot, task auto-detected
  fr run [-t task] [-p provider] [-w] "prompt"
  fr status                   today's budget, cooldowns and health
  fr providers                configured providers and readiness
  fr models                   task -> provider/model routing table
  fr doctor                   check binaries and logins
  fr login <provider|all>     run a provider's login flow
  fr use <provider|auto>      pin all work to one provider (this session in REPL)
  fr task <task|auto>         set the task for the session
  fr effort <level|none>      low | medium | high | none
  fr reset [provider|all]     clear today's counters and cooldowns
  fr cap <provider> <n|default>
  fr enable|disable <provider>
  fr router [on|off|status]   semantic task router settings
  fr setup [--json] [--install-missing] [--auth]  configure this device and check providers
  fr install-prompt [os] [--repo PATH] [--extra "..."]  print an install prompt for an agent
  fr config                   print config/state paths
  fr --version                print version

REPL commands start with "/", e.g. /task code, /status, /use kilo, /reset, /exit.
Tasks: ${TASKS.join(", ")}`;

const BAR = (used, cap) => {
  const filled = Math.round((used / Math.max(1, cap)) * 12);
  return `${"█".repeat(filled)}${"░".repeat(12 - filled)}`;
};

function parseArgs(argv) {
  const options = { task: null, provider: null, write: false, cwd: process.cwd(), dry: false, json: false, extra: "", target: null, out: null, version: false, installMissing: false, repo: null, auth: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-t" || arg === "--task") options.task = argv[++i];
    else if (arg === "-p" || arg === "--provider" || arg === "--use") options.provider = argv[++i];
    else if (arg === "-w" || arg === "--write") options.write = true;
    else if (arg === "-c" || arg === "--cwd") options.cwd = argv[++i];
    else if (arg === "--dry") options.dry = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--install-missing") options.installMissing = true;
    else if (arg === "--auth") options.auth = true;
    else if (arg === "--extra" || arg === "--custom") options.extra = argv[++i] ?? "";
    else if (arg === "--target" || arg === "--os") options.target = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--repo") options.repo = argv[++i];
    else if (arg === "-v" || arg === "--version") options.version = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else rest.push(arg);
  }
  return { options, rest };
}

function printStatus(config) {
  const state = loadState();
  const rows = summary(state, config.providers);
  console.log("budgets (UTC) — cap is a self-imposed soft limit, not a server limit\n");
  for (const row of rows) {
    const flags = [row.enabled ? "on" : "off"];
    if (row.cooling) flags.push(`cooldown ${row.cooling}m`);
    const line = `${row.name.padEnd(12)} ${BAR(row.used, row.cap)} ${String(row.used).padStart(4)}/${String(row.cap).padEnd(4)} left ${String(row.remaining).padStart(4)}  [${flags.join(", ")}]`;
    console.log(line);
    if (row.lastError && (row.cooling || row.failStreak)) console.log(`  └ ${row.lastError.split("\n")[0].slice(0, 110)}`);
  }
  if (config.router?.enabled) {
    const routeProvider = config.providers[config.router.provider];
    const used = stats(state, "__router", routeProvider?.capPeriod ?? "day").used;
    console.log(`\nrouter        ░ ${String(used).padStart(3)}/${String(config.router.dailyCap).padEnd(3)} ${config.router.provider} · ${config.router.model}`);
  }
  console.log("\ncap per provider: fr cap <provider> <n>");
}

function printProviders(config) {
  for (const [name, provider] of Object.entries(config.providers)) {
    let ready = commandExists(providerCommand(provider, config), config);
    if (name === "openrouter") ready = commandExists(config.freeAgentPath, config);
    console.log(`${name.padEnd(12)} ${ready ? "installed" : "MISSING"}  ${provider.enabled ? "on " : "off"}  ${provider.label}`);
    console.log(`  ${provider.notes ?? ""}`);
  }
}

function printModels(config) {
  for (const task of TASKS.filter((t) => t !== "auto")) {
    console.log(`\n${task}`);
    for (const route of config.routes[task] ?? []) {
      const provider = config.providers[route.provider];
      if (!provider?.enabled) continue;
      const models = provider.passthroughTask
        ? ["(free-agent task router)"]
        : (provider.models[task] ?? []).map((m) => (typeof m === "string" ? m : m.model));
      if (!models.length) continue;
      console.log(`  ${route.provider.padEnd(12)} ${models.join(", ")}`);
    }
  }
}

function printDoctor(config) {
  let bad = 0;
  for (const [name, provider] of Object.entries(config.providers)) {
    const result = checkProvider(provider, config, name);
    if (!result.ok) bad++;
    console.log(`${result.ok ? "ok     " : "problem"}  ${name.padEnd(12)} ${result.detail}`);
  }
  if (!Object.prototype.hasOwnProperty.call(config.providers, "antigravity")) bad++;
  console.log(bad ? "\nRun the matching `fr login <provider>` or install what is missing." : "\nAll good.");
}

async function repl(config, session) {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`free-router · task: ${session.task} · provider: ${session.provider ?? "auto"} · /help for commands`);
  for (;;) {
    let line;
    try {
      line = (await rl.question(`${session.task}> `)).trim();
    } catch {
      break;
    }
    if (!line) continue;
    if (line === "/exit" || line === "/quit") break;
    if (line === "/help") { console.log(HELP); continue; }
    if (line === "/status") { printStatus(config); continue; }
    if (line === "/providers") { printProviders(config); continue; }
    if (line === "/models") { printModels(config); continue; }
    if (line === "/doctor") { printDoctor(config); continue; }
    if (line === "/config") { printConfig(config); continue; }
    if (line === "/setup") { printSetup(runSetup(config)); continue; }
    if (line.startsWith("/router")) {
      const next = line.split(/\s+/)[1];
      if (next === "on" || next === "off") { config.router.enabled = next === "on"; saveConfig(config); }
      console.log(`semantic router: ${config.router.enabled ? "on" : "off"} (${config.router.provider})`);
      continue;
    }
    if (line.startsWith("/task")) {
      const next = line.split(/\s+/)[1];
      if (!TASKS.includes(next)) { console.log(`Tasks: ${TASKS.join(", ")}`); continue; }
      session.task = next;
      console.log(`Task: ${next}`);
      continue;
    }
    if (line.startsWith("/use")) {
      const next = line.split(/\s+/)[1];
      if (next === "auto") session.provider = null;
      else if (config.providers[next]) session.provider = next;
      else { console.log(`Providers: ${Object.keys(config.providers).join(", ")}`); continue; }
      console.log(`Provider: ${session.provider ?? "auto"}`);
      continue;
    }
    if (line.startsWith("/effort")) {
      const next = line.split(/\s+/)[1];
      session.effort = next === "none" ? null : next;
      console.log(`Effort: ${session.effort ?? "provider default"}`);
      continue;
    }
    if (line.startsWith("/reset")) {
      clearProvider(line.split(/\s+/)[1] ?? "all");
      console.log("Counters reset.");
      continue;
    }
    if (line.startsWith("/cap")) {
      const [, name, value] = line.split(/\s+/);
      if (config.providers[name] && value) {
        config.providers[name].dailyCap = value === "default" ? 100 : Number(value);
        saveConfig(config);
        console.log(`${name} cap: ${config.providers[name].dailyCap}`);
      }
      continue;
    }
    if (line.startsWith("/")) { console.log("Unknown command. /help."); continue; }

    await handlePrompt(config, session, line, session.write);
  }
  rl.close();
}

function printConfig(config) {
  console.log(`config: ${CONFIG_PATH}`);
  console.log(`state:  ${STATE_PATH}`);
  console.log(`env:    ${CONFIG_ENV_PATH}`);
  console.log(`cwd:    ${config.cwd ?? process.cwd()}`);
}

async function handlePrompt(config, session, prompt, write) {
  const task = session.task === "auto" ? await chooseTask(config, loadState(), prompt, session.cwd) : session.task;
  const withContext = session.history?.length
    ? `Conversation so far:\n${session.history.join("\n")}\n\nUser: ${prompt}`
    : prompt;
  const savedEffort = config.effort;
  if (session.effort !== undefined) config.effort = session.effort;
  try {
    const outcome = await dispatch(config, loadState(), {
      prompt: withContext,
      task,
      cwd: session.cwd,
      onlyProvider: session.provider,
      dryRun: session.dry,
      write
    });
    if (outcome.dryRun) {
      console.log(`would use ${outcome.provider}${outcome.model ? ` · ${outcome.model}` : ""}`);
      return;
    }
    const text = outcome.result?.text?.trim();
    if (text && session.history) {
      session.history.push(`User: ${prompt}`, `Assistant: ${text.slice(0, 1500)}`);
      session.history = session.history.slice(-(config.keepContext ?? 6) * 2);
    }
  } catch (err) {
    console.error(err.message);
  } finally {
    config.effort = savedEffort;
  }
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}

export async function main(argv) {
  const config = loadConfig();
  const { options, rest } = parseArgs(argv);
  const [command, ...tail] = rest;

  if (options.version) { console.log(packageVersion()); return; }
  if (options.help || command === "help") { console.log(HELP); return; }

  if (command === "setup") {
    const report = runSetup(config, { installMissing: options.installMissing, checkAuth: options.auth, quiet: options.json });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printSetup(report);
    return;
  }

  if (command === "install-prompt" || command === "agent-prompt") {
    const target = options.target ?? tail[0] ?? process.platform;
    const prompt = buildAgentPrompt({ target, installDir: options.repo ?? PACKAGE_ROOT, extra: options.extra });
    if (options.out) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(options.out, `${prompt}\n`);
      console.log(`wrote ${options.out}`);
    } else {
      console.log(prompt);
    }
    return;
  }

  if (command === "status") return printStatus(config);
  if (command === "providers") return printProviders(config);
  if (command === "models") return printModels(config);
  if (command === "doctor") return printDoctor(config);
  if (command === "config") return printConfig(config);
  if (command === "router") {
    const action = tail[0];
    if (action === "on" || action === "off") { config.router.enabled = action === "on"; saveConfig(config); }
    console.log(`semantic router: ${config.router.enabled ? "on" : "off"} · ${config.router.provider} · ${config.router.model} · cap ${config.router.dailyCap}`);
    return;
  }

  if (command === "login") {
    if (tail[0] === "all") {
      for (const [name, provider] of Object.entries(config.providers)) {
        if (!provider.login?.length) continue;
        console.log(`\n→ ${name}`);
        const result = runLogin(provider, config);
        console.log(`${name}: ${result.detail}`);
      }
      return;
    }
    const provider = config.providers[tail[0]];
    if (!provider) throw new Error(`Unknown provider. Use: ${Object.keys(config.providers).join(", ")}`);
    const result = runLogin(provider, config);
    console.log(`${tail[0]}: ${result.detail}`);
    return;
  }

  if (command === "reset") {
    clearProvider(tail[0] ?? "all");
    console.log("Counters reset.");
    return;
  }

  if (command === "cap") {
    const [name, value] = tail;
    if (!config.providers[name] || !value) throw new Error("Usage: fr cap <provider> <n|default>");
    config.providers[name].dailyCap = value === "default" ? 100 : Number(value);
    saveConfig(config);
    console.log(`${name} cap: ${config.providers[name].dailyCap}`);
    return;
  }

  if (command === "enable" || command === "disable") {
    const name = tail[0];
    if (!config.providers[name]) throw new Error(`Unknown provider: ${name}`);
    config.providers[name].enabled = command === "enable";
    saveConfig(config);
    console.log(`${name} ${command}d.`);
    return;
  }

  if (command === "use" || command === "task" || command === "effort") {
    const value = tail[0];
    if (command === "use") {
      if (value === "auto") delete config.forcedProvider;
      else if (config.providers[value]) config.forcedProvider = value;
      else throw new Error(`Unknown provider: ${value}`);
    } else if (command === "task") {
      if (!TASKS.includes(value)) throw new Error(`Tasks: ${TASKS.join(", ")}`);
      config.defaultTask = value;
    } else {
      config.effort = value === "none" ? null : value;
    }
    saveConfig(config);
    console.log(`saved ${command}: ${value}`);
    return;
  }

  const session = {
    task: options.task ?? (config.defaultTask ?? "auto"),
    provider: options.provider ?? config.forcedProvider ?? null,
    effort: undefined,
    cwd: options.cwd,
    write: options.write,
    dry: options.dry,
    history: []
  };

  const promptWords = command === "run" ? tail : rest;
  const prompt = promptWords.join(" ").trim();

  if (prompt) {
    await handlePrompt(config, session, prompt, options.write);
    return;
  }

  if (options.dry) {
    const task = session.task === "auto" ? "plan" : session.task;
    const list = preview(config, loadState(), task, { onlyProvider: session.provider });
    for (const item of list) console.log(`${item.provider}${item.model ? ` · ${item.model}` : ""}`);
    return;
  }

  await repl(config, session);
}
