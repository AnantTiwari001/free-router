import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONFIG_ENV_PATH } from "./paths.js";

const [, , promptArg = "", cwdArg = process.cwd()] = process.argv;
if (!promptArg.trim()) {
  console.error("imagegen: missing prompt");
  process.exit(1);
}

function findEnv(start) {
  let dir = resolve(start);
  while (true) {
    const file = join(dir, ".env");
    if (existsSync(file)) return file;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function apiKey() {
  if (process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_API_KEY;
  }
  const file = [CONFIG_ENV_PATH, findEnv(process.cwd()), findEnv(cwdArg), findEnv(dirname(resolve(process.argv[1])))]
    .filter((candidate) => candidate && existsSync(candidate))[0];
  if (!file) return null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(OPENROUTER_API_KEY|OPEN_ROUTER_API_KEY)\s*=\s*(.+?)\s*$/.exec(line);
    if (match) return match[2].replace(/^["']|["']$/g, "");
  }
  return null;
}

const key = apiKey();
if (!key) {
  console.error("imagegen: no OpenRouter key found (OPENROUTER_API_KEY / .env)");
  process.exit(1);
}

const body = {
  model: "recraft/recraft-v4.1-flash-v2:free",
  prompt: promptArg,
  output_format: "png"
};

const res = await fetch("https://openrouter.ai/api/v1/images", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`imagegen: HTTP ${res.status}: ${data?.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
  process.exit(1);
}

const image = data.data?.[0];
if (!image?.b64_json && !image?.url) {
  console.error("imagegen: no image returned");
  process.exit(1);
}

const folder = resolve(cwdArg);
mkdirSync(folder, { recursive: true });
const bytes = image.b64_json
  ? Buffer.from(image.b64_json, "base64")
  : Buffer.from(await (await fetch(image.url)).arrayBuffer());
const head = bytes.subarray(0, 4).toString("latin1");
const ext = head === "\x89PNG" ? "png" : head === "RIFF" ? "webp" : "bin";
const name = `image-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
const path = join(folder, name);
writeFileSync(path, bytes);
console.log(`Image saved: ${path}`);
