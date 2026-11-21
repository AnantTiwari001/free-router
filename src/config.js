import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CONFIG_DIR,
  CONFIG_PATH,
  DEFAULT_FREE_AGENT_PATH,
  HOME,
  IMAGE_GEN_SCRIPT,
  STATE_DIR,
  STATE_PATH
} from "./paths.js";

export { CONFIG_DIR, CONFIG_PATH, STATE_DIR, STATE_PATH } from "./paths.js";

/** Models offered per task by each provider, best first. */
const DEFAULTS = {
  version: 3,
  defaultTask: "auto",
  failoverRetries: 6,
  cooldownMinutes: 5,
  keepContext: 6,
  effort: null,
  freeAgentPath: DEFAULT_FREE_AGENT_PATH,
  imageGenScript: IMAGE_GEN_SCRIPT,
  router: {
    enabled: true,
    provider: "kilo",
    model: "kilo/nvidia/nemotron-3.5-lightning:free",
    dailyCap: 60,
    onlyWhenAmbiguous: true,
    prompt: "You are a task router. Pick exactly one label for the user's request: plan, code, code_search, content, documents, vision, audio, fast, image_gen. Reply with only the label, no punctuation or explanation.\n\nUser request: {prompt}"
  },
  providers: {
    antigravity: {
      enabled: true,
      kind: "cli",
      label: "Antigravity CLI (agy)",
      command: "agy",
      capPeriod: "day",
      dailyCap: 200,
      timeoutMs: 900000,
      login: ["agy"],
      authCheck: ["agy", "models"],
      jsonOutput: true,
      args: ["-p", "{prompt}", "--model", "{model}", "--output-format", "json", "--dangerously-skip-permissions"],
      notes: "No published request number: quota is capacity/work-based, refreshed weekly (Free) or every 5h (Pro/Ultra). The 200/day here is only a local guard.",
      models: {
        plan: [{ model: "Claude Sonnet 4.6 (Thinking)" }, { model: "Gemini 3.8 Flash (High)" }],
        code: [{ model: "Claude Sonnet 4.6 (Thinking)" }, { model: "Gemini 3.8 Flash (Medium)" }],
        code_search: [{ model: "Gemini 3.8 Flash (Low)" }],
        content: [{ model: "Gemini 3.8 Flash (Medium)" }],
        documents: [{ model: "Gemini 3.8 Flash (High)" }],
        vision: [{ model: "Gemini 3.8 Flash (High)" }],
        fast: [{ model: "Gemini 3.8 Flash (Low)" }],
        audio: [],
        image_gen: []
      }
    },
    opencode: {
      enabled: true,
      kind: "cli",
      label: "OpenCode (free zen models)",
      command: "opencode",
      capPeriod: "day",
      dailyCap: 500,
      timeoutMs: 900000,
      login: ["opencode", "auth", "login"],
      authCheck: ["opencode", "auth", "list"],
      args: ["run", "--format", "json", "--auto", "-m", "{model}", "{prompt}"],
      notes: "No published daily cap for most free models; LongCat is 100/day. 500/day here is a local guard.",
      models: {
        plan: [{ model: "opencode/big-pickle" }, { model: "opencode/deepseek-v4.1-flash-free" }],
        code: [{ model: "opencode/deepseek-v4.1-flash-free" }, { model: "opencode/big-pickle" }],
        code_search: [{ model: "opencode/flint-40b-free" }, { model: "opencode/mimo-v2.6-flash-free" }],
        content: [{ model: "opencode/longcat-2.5-free" }, { model: "opencode/hy4-flash-free" }],
        documents: [{ model: "opencode/nemotron-3.5-super-vl-free" }],
        vision: [{ model: "opencode/nemotron-3.5-super-vl-free" }],
        fast: [{ model: "opencode/nemotron-3.5-lightning-free" }, { model: "opencode/mimo-v2.6-flash-free" }],
        audio: [],
        image_gen: []
      }
    },
    kilo: {
      enabled: true,
      kind: "cli",
      label: "Kilo Code (free models)",
      command: "kilo",
      capPeriod: "hour",
      dailyCap: 200,
      timeoutMs: 900000,
      login: ["kilo", "auth", "login"],
      authCheck: ["kilo", "auth", "list"],
      authOptional: true,
      args: ["run", "--format", "json", "--auto", "-m", "{model}", "{prompt}"],
      notes: "Real published limit: 200 requests/hour per IP for free models (signed-in limits unpublished).",
      models: {
        plan: [{ model: "kilo/nvidia/nemotron-3-ultra-550b-a55b:free" }],
        code: [{ model: "kilo/particle-ai/particle-1:free" }, { model: "kilo/dots-studio/dots-3-note-preview:free" }],
        code_search: [{ model: "kilo/recursive/flint-v1.0:free" }, { model: "kilo/particle-ai/particle-1:free" }],
        content: [{ model: "kilo/dots-studio/dots-3-note-preview:free" }, { model: "kilo/baidu/ernie-5.5-flash-preview:free" }],
        documents: [{ model: "kilo/inclusionai/ling-3.2-flash:free" }],
        vision: [{ model: "kilo/nvidia/nemotron-3.5-super-vl:free" }],
        fast: [{ model: "kilo/nvidia/nemotron-3.5-lightning:free" }, { model: "kilo/liquid/lfm-3-1.7b:free" }],
        audio: [{ model: "kilo/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free" }],
        image_gen: []
      }
    },
    freebuff: {
      enabled: true,
      kind: "cli",
      interactive: true,
      label: "Freebuff",
      command: "freebuff",
      capPeriod: "day",
      dailyCap: 30,
      timeoutMs: 300000,
      login: ["freebuff", "login"],
      authCheck: ["freebuff", "doctor"],
      args: ["--cwd", "{cwd}"],
      notes: "Real limit is hours/day: 30 US, 21/12 in several countries, 5 elsewhere, 4 over VPN; unlimited messages in each 1h session. Counter below tracks sessions.",
      settingsFile: join(HOME, ".config", "manicode", "settings.json"),
      settingsKey: "freebuffModelKey",
      models: {
        plan: [{ model: "m-61c26317cc" }],
        code: [{ model: "m-61c26317cc" }],
        code_search: [{ model: "m-61c26317cc" }],
        content: [{ model: "m-61c26317cc" }],
        documents: [{ model: "m-61c26317cc" }],
        vision: [{ model: "m-61c26317cc" }],
        fast: [{ model: "m-61c26317cc" }],
        audio: [],
        image_gen: []
      }
    },
    openrouter_image: {
      enabled: true,
      kind: "cli",
      label: "OpenRouter free image generation",
      command: "node",
      dailyCap: 50,
      capPeriod: "day",
      timeoutMs: 300000,
      args: ["{imageGenScript}", "{prompt}", "{cwd}"],
      notes: "Live OpenRouter catalog has recraft/recraft-v4.1-flash-v2:free (image output, $0). Testing showed it did not consume the chat-request bucket.",
      models: { image_gen: [{ model: "recraft/recraft-v4.1-flash-v2:free" }] }
    },
    openrouter: {
      enabled: true,
      kind: "cli",
      label: "OpenRouter free models (via free-agent)",
      command: "node",
      capPeriod: "day",
      dailyCap: 1000,
      timeoutMs: 900000,
      login: [],
      authCheck: ["node", "{freeAgentPath}", "usage"],
      passthroughTask: true,
      args: ["{freeAgentPath}", "-t", "{task}", "{prompt}"],
      notes: "Real limit: 1000 free requests/day if >=$10 credits ever purchased, otherwise 50/day; 20/minute.",
      models: {
        plan: [], code: [], code_search: [], content: [], documents: [], vision: [], audio: [], fast: [], image_gen: []
      }
    }
  },
  routes: {
    image_gen: [{ provider: "openrouter_image" }],
    plan: [
      { provider: "antigravity" },
      { provider: "kilo" },
      { provider: "opencode" },
      { provider: "openrouter" },
      { provider: "freebuff" }
    ],
    code: [
      { provider: "opencode" },
      { provider: "antigravity" },
      { provider: "kilo" },
      { provider: "freebuff" },
      { provider: "openrouter" }
    ],
    code_search: [
      { provider: "opencode" },
      { provider: "kilo" },
      { provider: "openrouter" },
      { provider: "antigravity" }
    ],
    content: [
      { provider: "freebuff" },
      { provider: "openrouter" },
      { provider: "antigravity" },
      { provider: "opencode" },
      { provider: "kilo" }
    ],
    documents: [
      { provider: "kilo" },
      { provider: "opencode" },
      { provider: "openrouter" },
      { provider: "antigravity" }
    ],
    vision: [
      { provider: "opencode" },
      { provider: "kilo" },
      { provider: "openrouter" },
      { provider: "antigravity" }
    ],
    audio: [
      { provider: "kilo" },
      { provider: "openrouter" }
    ],
    fast: [
      { provider: "opencode" },
      { provider: "kilo" },
      { provider: "freebuff" },
      { provider: "antigravity" },
      { provider: "openrouter" }
    ]
  }
};

export const TASKS = ["auto", "plan", "code", "code_search", "content", "documents", "vision", "audio", "fast", "image_gen"];

function deepMerge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra ?? base;
  if (typeof base !== "object" || base === null) return extra ?? base;
  if (typeof extra !== "object" || extra === null) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) out[key] = deepMerge(base[key], value);
  return out;
}

export function ensureDirs() {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });
}

function migrate(config) {
  let changed = false;
  for (const task of TASKS) {
    if (!config.routes[task]) { config.routes[task] = structuredClone(DEFAULTS.routes[task] ?? []); changed = true; }
  }
  if ((config.version ?? 1) < 2) {
    for (const [name, fresh] of Object.entries(DEFAULTS.providers)) {
      const current = config.providers[name];
      if (!current) continue;
      current.capPeriod = fresh.capPeriod;
      current.dailyCap = fresh.dailyCap;
      current.notes = fresh.notes;
    }
    config.version = 2;
    changed = true;
  }
  if ((config.version ?? 1) < 3) {
    if ((!config.freeAgentPath || !existsSync(config.freeAgentPath)) && existsSync(DEFAULTS.freeAgentPath)) {
      config.freeAgentPath = DEFAULTS.freeAgentPath;
      changed = true;
    }
    config.version = 3;
    changed = true;
  }
  if (!config.imageGenScript || !existsSync(config.imageGenScript)) {
    config.imageGenScript = DEFAULTS.imageGenScript;
    changed = true;
  }
  if (config.cooldownMinutes === 15) { config.cooldownMinutes = DEFAULTS.cooldownMinutes; changed = true; }
  if (!config.imageGenScript) { config.imageGenScript = DEFAULTS.imageGenScript; changed = true; }
  if (!config.router) { config.router = structuredClone(DEFAULTS.router); changed = true; }
  if (!config.providers.openrouter_image) { config.providers.openrouter_image = structuredClone(DEFAULTS.providers.openrouter_image); changed = true; }
  else if (config.providers.openrouter_image.notes?.includes("same free-request bucket")) {
    config.providers.openrouter_image.notes = DEFAULTS.providers.openrouter_image.notes;
    changed = true;
  }
  for (const [name, provider] of Object.entries(config.providers)) {
    for (const task of TASKS) {
      if (!provider.models?.[task]) { provider.models ??= {}; provider.models[task] = structuredClone(DEFAULTS.providers[name]?.models?.[task] ?? []); changed = true; }
    }
  }
  if (changed) saveConfig(config);
  return config;
}

export function loadConfig() {
  ensureDirs();
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULTS, null, 2)}\n`);
    return structuredClone(DEFAULTS);
  }
  try {
    return migrate(deepMerge(structuredClone(DEFAULTS), JSON.parse(readFileSync(CONFIG_PATH, "utf8"))));
  } catch (err) {
    throw new Error(`Cannot parse ${CONFIG_PATH}: ${err.message}`);
  }
}

export function saveConfig(config) {
  ensureDirs();
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

export function paths(config) {
  return {
    configPath: CONFIG_PATH,
    statePath: STATE_PATH,
    freeAgentPath: resolve(config.freeAgentPath)
  };
}
