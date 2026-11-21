import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { STATE_PATH, ensureDirs } from "./config.js";

const today = () => new Date().toISOString().slice(0, 10);
export const windowKey = (period = "day") => period === "hour" ? `${today()}T${new Date().toISOString().slice(11, 13)}` : today();

function emptyState() {
  return { date: today(), providers: {} };
}

export function loadState() {
  ensureDirs();
  if (!existsSync(STATE_PATH)) return emptyState();
  try {
    const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    state.providers ??= {};
    return state;
  } catch {
    return emptyState();
  }
}

function save(state) {
  ensureDirs();
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function slot(state, provider, period = "day") {
  const key = windowKey(period);
  const known = state.providers[provider];
  if (!known || known.window !== key) {
    state.providers[provider] = { window: key, used: 0, failStreak: 0, limitedUntil: 0, lastError: null };
  }
  return state.providers[provider];
}

export function stats(state, provider, period = "day") {
  const known = state.providers[provider];
  if (!known || known.window !== windowKey(period)) return { used: 0, failStreak: 0, limitedUntil: 0, lastError: null };
  return { used: known.used ?? 0, failStreak: known.failStreak ?? 0, limitedUntil: known.limitedUntil ?? 0, lastError: known.lastError ?? null };
}

export function remaining(state, provider, cap, period = "day") {
  return Math.max(0, cap - stats(state, provider, period).used);
}

export function isCooling(statsValue) {
  return statsValue.limitedUntil > Date.now();
}

export function recordUse(provider, period = "day") {
  const state = loadState();
  const entry = slot(state, provider, period);
  entry.used += 1;
  entry.lastUsed = new Date().toISOString();
  save(state);
  return state;
}

export function recordSuccess(provider, period = "day") {
  const state = loadState();
  const entry = slot(state, provider, period);
  entry.failStreak = 0;
  entry.lastError = null;
  entry.lastOk = new Date().toISOString();
  save(state);
}

export function recordFailure(provider, { cooldownMinutes, message, limited = false, period = "day" }) {
  const state = loadState();
  const entry = slot(state, provider, period);
  entry.failStreak += 1;
  entry.lastError = String(message ?? "").slice(0, 500);
  entry.lastFailure = new Date().toISOString();
  const backoff = limited
    ? cooldownMinutes
    : Math.min(60, cooldownMinutes * Math.max(1, entry.failStreak));
  entry.limitedUntil = Date.now() + backoff * 60_000;
  if (limited) entry.limitedAt = new Date().toISOString();
  save(state);
}

export function clearProvider(provider) {
  const state = loadState();
  if (provider === "all") state.providers = {};
  else delete state.providers[provider];
  save(state);
}

export function summary(state, providers) {
  return Object.entries(providers).map(([name, provider]) => {
    const period = provider.capPeriod ?? "day";
    const s = stats(state, name, period);
    return {
      name,
      label: provider.label,
      enabled: provider.enabled,
      period,
      cap: provider.dailyCap,
      used: s.used,
      remaining: remaining(state, name, provider.dailyCap, period),
      cooling: isCooling(s) ? Math.ceil((s.limitedUntil - Date.now()) / 60000) : 0,
      failStreak: s.failStreak,
      lastError: s.lastError
    };
  });
}
