import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const home = homedir();
const windows = process.platform === "win32";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const IMAGE_GEN_SCRIPT = join(PACKAGE_ROOT, "src", "imagegen.js");

export const CONFIG_DIR = windows
  ? join(process.env.APPDATA || join(home, "AppData", "Roaming"), "free-router")
  : join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "free-router");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const CONFIG_ENV_PATH = join(CONFIG_DIR, ".env");

export const STATE_DIR = windows
  ? join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "free-router", "state")
  : join(process.env.XDG_STATE_HOME || join(home, ".local", "state"), "free-router");
export const STATE_PATH = join(STATE_DIR, "usage.json");

export const DEFAULT_FREE_AGENT_PATH = process.env.FREE_AGENT_PATH
  ? resolve(process.env.FREE_AGENT_PATH)
  : join(home, "personal", "free-agent", "src", "cli.ts");

export const HOME = home;
export const IS_WINDOWS = windows;
