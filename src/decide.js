import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR, TASKS } from "./config.js";
import { recordFailure, recordSuccess, recordUse, remaining } from "./ledger.js";
import { runProvider } from "./providers.js";
import { TASK_HINTS } from "./router.js";

const CACHE_PATH = join(STATE_DIR, "router-cache.json");
const ROUTER_SLOT = "__router";

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

export function taskSignals(prompt) {
  return Object.entries(TASK_HINTS).filter(([, pattern]) => pattern.test(prompt)).map(([task]) => task);
}

function fallback(prompt) {
  const signals = taskSignals(prompt);
  return signals[0] ?? (prompt.length < 90 ? "fast" : "plan");
}

export async function chooseTask(config, state, prompt, cwd) {
  const settings = config.router;
  const signals = taskSignals(prompt);
  if (!settings?.enabled) return fallback(prompt);
  if (settings.onlyWhenAmbiguous && signals.length === 1) return signals[0];
  if (signals.length === 0 && prompt.trim().length < 40) return "fast";

  const key = createHash("sha256").update(prompt.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
  const cache = loadCache();
  if (cache[key]) return cache[key];

  const provider = config.providers[settings.provider];
  if (!provider?.enabled) return fallback(prompt);
  const period = provider.capPeriod ?? "day";
  if (remaining(state, ROUTER_SLOT, settings.dailyCap) <= 0) return fallback(prompt);

  recordUse(ROUTER_SLOT, period);
  const result = await runProvider(provider, config, {
    prompt: (settings.prompt ?? "{prompt}").replaceAll("{prompt}", prompt),
    model: settings.model ?? "",
    task: "plan",
    effort: null,
    cwd,
    quiet: true
  });

  if (!result.ok) {
    recordFailure(ROUTER_SLOT, {
      cooldownMinutes: config.cooldownMinutes ?? 15,
      message: result.stderr.trim().split("\n").slice(-2).join("\n") || `exit ${result.code}`,
      limited: result.limited,
      period
    });
    return fallback(prompt);
  }

  recordSuccess(ROUTER_SLOT, period);
  const answer = String(result.text ?? "").trim().toLowerCase();
  const match = TASKS.find((task) => task !== "auto" && new RegExp(`\\b${task}\\b`).test(answer));
  const chosen = match ?? fallback(prompt);
  cache[key] = chosen;
  saveCache(cache);
  return chosen;
}
