import { recordFailure, recordSuccess, recordUse, isCooling, remaining, stats } from "./ledger.js";
import { runProvider } from "./providers.js";

export const TASK_HINTS = {
  image_gen: /\b(create|generate|make|draw|paint|render|produce|edit|design)\b[^.!?]{0,60}\b(image|photo|picture|artwork|illustration|wallpaper|poster|logo)\b|\b(image|photo|picture)\s+of\b/i,
  code: /\b(code|function|bug|fix|refactor|implement|script|test|api|component|build|compile|typescript|python|javascript|rust|go|sql|docker|cli)\b/i,
  code_search: /\b(find (?:where|the)|search (?:for|the)|where is|where are|locate|in this (?:repo|codebase)|across the codebase|callers?|references)\b/i,
  content: /\b(write|draft|blog|post|copy|email|essay|article|tweet|caption|hook|newsletter|landing page|marketing)\b/i,
  documents: /\b(pdf|scan|screenshot|ocr|document|report|invoice|contract|extract from)\b/i,
  vision: /\b(image|photo|picture|diagram|ui mockup|video)\b/i,
  audio: /\b(audio|transcribe|transcription|recording|voice ?note|podcast)\b/i,
  fast: /\b(classify|tag|label|rename|route|translate|one line|shorten|summar(?:y|ize))\b/i
};

export function classify(prompt) {
  const text = prompt.toLowerCase();
  for (const [task, pattern] of Object.entries(TASK_HINTS)) if (pattern.test(text)) return task;
  if (prompt.length < 90) return "fast";
  return "plan";
}

function routeModels(provider, task) {
  if (provider.passthroughTask) return [{ model: null, effort: null }];
  return (provider.models?.[task] ?? []).map((entry) =>
    typeof entry === "string" ? { model: entry, effort: null } : entry
  );
}

function candidates(config, state, task, { onlyProvider } = {}) {
  const routes = config.routes?.[task] ?? [];
  const list = [];
  routes.forEach((route, routeIndex) => {
    if (onlyProvider && route.provider !== onlyProvider) return;
    const provider = config.providers[route.provider];
    if (!provider?.enabled) return;
    const period = provider.capPeriod ?? "day";
    const s = stats(state, route.provider, period);
    if (isCooling(s)) return;
    if (remaining(state, route.provider, provider.dailyCap, period) <= 0) return;
    for (const { model, effort } of routeModels(provider, task)) {
      if (!provider.passthroughTask && !model) continue;
      const utilization = provider.dailyCap ? s.used / provider.dailyCap : 0;
      list.push({
        provider: route.provider,
        providerLabel: provider.label,
        model: model ?? (route.model ? route.model : null),
        effort: effort ?? route.effort ?? config.effort ?? null,
        routeIndex,
        score: routeIndex + utilization * 3
      });
    }
  });
  return list.sort((a, b) => a.score - b.score || a.routeIndex - b.routeIndex);
}

export function preview(config, state, task, opts) {
  return candidates(config, state, task, opts);
}

export async function dispatch(config, state, { prompt, task, cwd, onlyProvider, dryRun }) {
  const list = candidates(config, state, task, { onlyProvider });
  if (!list.length) {
    if (task === "image_gen") {
      throw new Error("No free image-generation provider is configured. These free tiers can understand images but cannot create them. Add a generator to config.providers and config.routes.image_gen, or use a paid image model.");
    }
    throw new Error(`No ${task} provider has budget or health left. Try "fr status" and "fr reset".`);
  }
  const limit = Math.min(list.length, config.failoverRetries ?? 6);
  const errors = [];

  for (const candidate of list.slice(0, limit)) {
    if (dryRun) {
      return { ok: true, ...candidate, dryRun: true };
    }
    const provider = config.providers[candidate.provider];
    console.error(`\x1b[2m→ ${candidate.providerLabel}${candidate.model ? ` · ${candidate.model}` : ""}${candidate.effort ? ` · ${candidate.effort}` : ""}\x1b[0m`);
    recordUse(candidate.provider, provider.capPeriod ?? "day");
    const result = await runProvider(provider, config, {
      prompt,
      model: candidate.model ?? "",
      task,
      effort: candidate.effort,
      cwd
    });

    if (result.ok) {
      recordSuccess(candidate.provider, provider.capPeriod ?? "day");
      return { ok: true, ...candidate, result };
    }

    const message = result.timedOut
      ? `timed out after ${Math.round((provider.timeoutMs ?? 900000) / 1000)}s`
      : result.stderr.trim().split("\n").slice(-4).join("\n") || `exit ${result.code}`;
    recordFailure(candidate.provider, {
      cooldownMinutes: config.cooldownMinutes ?? 15,
      message,
      limited: result.limited,
      period: provider.capPeriod ?? "day"
    });
    errors.push(`${candidate.provider}: ${message.split("\n").pop()}`);
    if (result.limited) {
      console.error(`\x1b[2m  ${candidate.provider} hit a limit, cooling down and failing over.\x1b[0m`);
    } else {
      console.error(`\x1b[2m  ${candidate.provider} failed, failing over.\x1b[0m`);
    }
  }

  throw new Error(`Every candidate failed:\n  ${errors.join("\n  ")}`);
}
