import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";
import { CONFIG_ENV_PATH, HOME, IS_WINDOWS } from "./paths.js";

const LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /\b429\b/,
  /quota/i,
  /usage limit/i,
  /limit reached|reached (?:the|your) limit/i,
  /out of (?:credits|hours|tokens)/i,
  /not enough (?:credits|hours|balance)/i,
  /session limit/i,
  /credits? exhausted/i,
  /resets? in \d/i,
  /\bip_capped\b/,
  /\bsuperseded\b/
];

const FAIL_PATTERNS = [/econnrefused/i, /enotfound/i, /network error/i, /connection refused/i, /unauthorized/i, /\b401\b/, /not logged in|not logged into|please log ?in|run .*login/i];

const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
let envPromise;

function proxyAlive(url) {
  let host;
  let port;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = Number(parsed.port || 80);
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(400, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function withConfigKey(env) {
  if (env.OPENROUTER_API_KEY || env.OPEN_ROUTER_API_KEY) return env;
  if (!existsSync(CONFIG_ENV_PATH)) return env;
  try {
    for (const line of readFileSync(CONFIG_ENV_PATH, "utf8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?(OPENROUTER_API_KEY|OPEN_ROUTER_API_KEY)\s*=\s*(.+?)\s*$/.exec(line);
      if (match) return { ...env, OPENROUTER_API_KEY: match[2].replace(/^["']|["']$/g, "") };
    }
  } catch {}
  return env;
}

/** Drops proxy env vars when the configured proxy is not accepting connections. */
export function childEnv(includeConfigKey = false) {
  envPromise ??= (async () => {
    const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.ALL_PROXY;
    if (!proxy) return process.env;
    if (await proxyAlive(proxy)) return process.env;
    const env = { ...process.env };
    for (const key of PROXY_KEYS) delete env[key];
    return env;
  })();
  return includeConfigKey ? envPromise.then(withConfigKey) : envPromise;
}

function withWindowsExts(file) {
  if (!IS_WINDOWS || extname(file)) return [file];
  const exts = (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
  return [file, ...exts.map((ext) => `${file}${ext.toLowerCase()}`), ...exts.map((ext) => `${file}${ext}`)];
}

export function commandExists(command, config, env = process.env) {
  if (!command) return false;
  const value = expand(command, { config });
  const explicit = value.includes("/") || value.includes("\\") || /^[A-Za-z]:/.test(value) || isAbsolute(value);
  if (explicit) return withWindowsExts(resolve(value)).some((file) => existsSync(file));
  const path = env.PATH ?? env.Path ?? "";
  return path.split(delimiter).some((dir) => dir && withWindowsExts(join(dir, value)).some((file) => existsSync(file)));
}

export function expand(value, { config }) {
  return String(value)
    .replaceAll("{freeAgentPath}", config.freeAgentPath)
    .replaceAll("{imageGenScript}", config.imageGenScript)
    .replaceAll("{home}", HOME);
}

function quoteWindowsArg(value) {
  const text = String(value).replaceAll("%", "%%").replaceAll('"', '\\"').replace(/\r?\n/g, " ");
  return `"${text}"`;
}

/** Spawns a command on POSIX, or through cmd.exe on Windows so .cmd/.bat shims work. */
function spawnCompat(command, args, options) {
  if (!IS_WINDOWS) return spawn(command, args, options);
  const line = [command, ...args].map(quoteWindowsArg).join(" ");
  return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
    ...options,
    windowsVerbatimArguments: true
  });
}

function spawnSyncCompat(command, args, options) {
  if (!IS_WINDOWS) return spawnSync(command, args, options);
  const line = [command, ...args].map(quoteWindowsArg).join(" ");
  return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
    ...options,
    windowsVerbatimArguments: true
  });
}

export function providerCommand(provider, config) {
  return expand(provider.command, { config });
}

let currentCwd = process.cwd();
function optionsCwd() { return currentCwd; }

export function buildArgs(provider, config, { prompt, model, task, effort, cwd }) {
  if (cwd) currentCwd = cwd;
  const args = (provider.args ?? ["{prompt}"]).map((arg) =>
    expand(arg, { config })
      .replaceAll("{prompt}", prompt)
      .replaceAll("{model}", model ?? "")
      .replaceAll("{task}", task ?? "plan")
      .replaceAll("{cwd}", optionsCwd())
  );
  const commandName = String(provider.command ?? "");
  if (effort && provider.kind === "cli" && !/opencode|kilo|freebuff/.test(commandName)) {
    const idx = args.indexOf("--effort");
    if (idx !== -1) args.splice(idx + 1, 1, effort);
  }
  if (effort && /opencode|kilo/.test(commandName)) {
    args.push("--variant", effort);
  }
  return args.filter((arg, i, all) => arg !== "" || all[i - 1] !== "-m");
}

function setSettings(provider, model) {
  if (!provider.settingsFile || !provider.settingsKey || !existsSync(provider.settingsFile)) return () => {};
  try {
    const original = readFileSync(provider.settingsFile, "utf8");
    const data = JSON.parse(original);
    if (data[provider.settingsKey] === model) return () => {};
    data[provider.settingsKey] = model;
    writeFileSync(provider.settingsFile, `${JSON.stringify(data, null, 2)}\n`);
    return () => writeFileSync(provider.settingsFile, original);
  } catch {
    return () => {};
  }
}

function extractText(raw) {
  let out = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const candidates = [event?.part?.text, event?.text, event?.content, event?.message?.content, event?.result, event?.response, event?.data?.text];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate && !candidate.includes('"type"')) out += candidate;
    }
  }
  return out.trim();
}

/**
 * Runs a provider non-interactively, streaming output and collecting a tail.
 * Never throws for a non-zero exit: callers decide whether to fail over.
 */
export function runProvider(provider, config, options) {
  const command = providerCommand(provider, config);
  const args = buildArgs(provider, config, options);
  if (options.write && args.includes(config.freeAgentPath)) args.splice(args.length - 1, 0, "-w");
  const restore = setSettings(provider, options.model);
  const timeoutMs = provider.timeoutMs ?? 900000;
  const json = provider.jsonOutput ?? provider.args?.includes("--format") ?? false;
  if (provider.interactive) return runInteractive(command, args, provider, options, timeoutMs);

  return childEnv(Boolean(provider.passthroughTask)).then((env) => new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawnCompat(command, args, {
        cwd: options.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      restore();
      resolve({ ok: false, code: 1, stdout: "", stderr: String(err), limited: false, timedOut: false, text: "" });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!json && !options.quiet) process.stdout.write(text);
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!options.quiet) process.stderr.write(text);
      if (stderr.length > 500_000) stderr = stderr.slice(-250_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      stderr += `\n${err.message}`;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      restore();
      const combined = `${stdout}\n${stderr}`;
      const limited = LIMIT_PATTERNS.some((re) => re.test(combined));
      const failed = code !== 0 || signal !== null;
      if (json && !failed) {
        const extracted = extractText(stdout);
        if (extracted && !options.quiet) process.stdout.write(extracted.endsWith("\n") ? extracted : `${extracted}\n`);
      }
      const tail = combined.trim().slice(-1200);
      resolve({ ok: !failed, code: code ?? 1, stdout, stderr, limited: limited && failed, network: FAIL_PATTERNS.some((re) => re.test(combined)), timedOut, text: extractText(stdout) || stdout });
    });
  }));
}

const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;

function runInteractive(command, args, provider, options, timeoutMs) {
  if (IS_WINDOWS) {
    return Promise.resolve({
      ok: false,
      code: 1,
      stdout: "",
      stderr: "Freebuff is a TUI and needs a POSIX pty. Run it manually on Windows, or use WSL.",
      limited: false,
      timedOut: false,
      text: ""
    });
  }
  if (!commandExists("script", { freeAgentPath: "", imageGenScript: "" }, process.env)) {
    return Promise.resolve({
      ok: false,
      code: 1,
      stdout: "",
      stderr: "The `script` command is required for the Freebuff TUI.",
      limited: false,
      timedOut: false,
      text: ""
    });
  }
  return childEnv(Boolean(provider.passthroughTask)).then((env) => new Promise((resolve) => {
    let visible = "";
    let idleTimer;
    let lastAt = Date.now();
    let sentExit = false;
    let killTimer;
    const child = spawn("script", ["-q", "/dev/null", command, ...args], { env, stdio: ["pipe", "pipe", "pipe"], cwd: options.cwd });

    const finish = (code) => {
      clearInterval(idleTimer);
      clearTimeout(killTimer);
      resolve({ ok: code === 0 || visible.length > 0, code: code ?? 0, stdout: visible, stderr: "", limited: false, timedOut: false, text: visible });
    };

    child.on("error", (err) => {
      clearInterval(idleTimer);
      clearTimeout(killTimer);
      resolve({ ok: false, code: 1, stdout: visible, stderr: String(err), limited: false, timedOut: false, text: visible });
    });
    child.stdout.on("data", (chunk) => {
      const clean = chunk.toString().replace(ANSI, "");
      visible += clean;
      lastAt = Date.now();
      process.stdout.write(clean);
      if (visible.length > 400_000) visible = visible.slice(-200_000);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", finish);

    try {
      child.stdin.write(`${options.prompt}\n`);
    } catch (err) {
      child.kill("SIGTERM");
      return finish(1);
    }
    idleTimer = setInterval(() => {
      if (Date.now() - lastAt < 12000) return;
      if (!sentExit) {
        sentExit = true;
        try { child.stdin.write("/exit\n"); } catch {}
        setTimeout(() => { try { child.stdin.write("\u0004"); } catch {} }, 800);
      } else {
        setTimeout(() => child.kill("SIGTERM"), 1500);
      }
    }, 2000);
    killTimer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
  }));
}

export function checkProvider(provider, config, name = provider.label ?? provider.command ?? "provider") {
  const command = providerCommand(provider, config);
  if (!commandExists(command, config)) {
    return { ok: false, detail: `missing binary: ${command}` };
  }
  const auth = provider.authCheck ?? [];
  if (auth.length) {
    const probe = auth.map((arg) => expand(arg, { config }));
    if (!commandExists(probe[0], config)) return { ok: true, detail: "installed" };
    const result = spawnSyncCompat(probe[0], probe.slice(1), { encoding: "utf8", timeout: 25000, env: withConfigKey(process.env) });
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (/not logged in|not logged into|0 credentials|no credentials|not authenticated|sign in to continue|login required/i.test(text) && !/logged in/i.test(text)) {
      if (provider.authOptional) return { ok: true, detail: "installed (free gateway, login optional)" };
      return { ok: false, detail: `not logged in (run \`fr login ${name}\`)` };
    }
  }
  return { ok: true, detail: "installed" };
}

export function runLogin(provider, config) {
  const [command, ...args] = provider.login ?? [];
  if (!command) return { ok: true, detail: "no login needed" };
  const result = spawnSyncCompat(command, args, { stdio: "inherit" });
  return { ok: result.status === 0, detail: `exit ${result.status}` };
}
