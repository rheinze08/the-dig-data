// The vision pass: READ a sale's photos with a vision model and name what
// is in them, as extra photoKeywords. Photos are never copied or republished
// — only their source URLs are sent to the model, and only the words come back.
//
// ══ READY TO ENABLE — waiting on one thing ══════════════════════════════
// This pass runs only when a vision key is in the environment:
// OPENAI_API_KEY or ANTHROPIC_API_KEY (the model can be overridden with
// DIG_VISION_MODEL). As of 2026-11-21 the the-dig-data repo has NO Actions
// secrets at all, so the daily Action runs exactly as before and this module
// is inert. To switch it on:
//   1. Add OPENAI_API_KEY or ANTHROPIC_API_KEY as an Actions secret on
//      rheinze08/the-dig-data (Roland's open Phase 9 decision), and
//   2. install the ci/daily-refresh.yml change that passes the secret into
//      the refresh step (staged under ci/; Sonic installs workflow files —
//      see AGENTS.md in the-dig).
// Caps: at most 12 photos scanned per sale, at most DIG_VISION_MAX_PER_RUN
// (default 120) NEW photos per city run. Results are cached by photo URL
// hash in collector/state/<city>/photo-scan.json, so a daily run only ever
// scans photos it has not seen. A failing API adds nothing and never breaks
// a collection. Keywords from photos merge into photoKeywords and can fill
// an empty contentsLine; they never overwrite what the listing itself said.
import {createHash} from 'node:crypto';
import {buildContentsLine} from './signals.mjs';

const PROMPT = 'You are describing an estate-sale photo for a listing index. '
  + 'Reply with JSON only, in exactly this shape: {"keywords":["..."]} '
  + 'List up to 8 short, concrete keywords naming kinds of items clearly visible '
  + '(for example "figurines", "vinyl records", "oak dresser", "power tools"). '
  + 'Name only what is clearly visible. No sentences, no prices, no guesses.';

export function visionFromEnv(env = process.env) {
  const model = env.DIG_VISION_MODEL?.trim() || null;
  const openAiKey = env.OPENAI_API_KEY?.trim();
  if (openAiKey) return {provider: 'openai', apiKey: openAiKey, model: model || 'gpt-4o-mini'};
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) return {provider: 'anthropic', apiKey: anthropicKey, model: model || 'claude-haiku-4-5-20251001'};
  return null;
}

export function photoCacheKey(url) {
  return createHash('sha256').update(url).digest('hex');
}

function parseKeywords(text) {
  try {
    const value = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!Array.isArray(value.keywords)) return [];
    return [...new Set(value.keywords.filter(word => typeof word === 'string')
      .map(word => word.trim().toLowerCase()).filter(word => word && word.length <= 40))].slice(0, 8);
  } catch {
    return [];
  }
}

// One photo in, its keywords out. null when the API could not be used, so
// the caller can tell a failed scan (retry another day) from an empty room.
export async function scanPhoto(url, config, fetchImpl = fetch) {
  const timeout = AbortSignal.timeout(30000);
  try {
    if (config.provider === 'openai') {
      const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: timeout,
        headers: {'Authorization': 'Bearer ' + config.apiKey, 'Content-Type': 'application/json'},
        body: JSON.stringify({
          model: config.model, max_tokens: 200,
          messages: [{role: 'user', content: [
            {type: 'text', text: PROMPT},
            {type: 'image_url', image_url: {url}},
          ]}],
        }),
      });
      if (!response.ok) return null;
      const body = await response.json();
      return parseKeywords(body.choices?.[0]?.message?.content ?? '');
    }
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: timeout,
      headers: {'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: config.model, max_tokens: 200,
        messages: [{role: 'user', content: [
          {type: 'image', source: {type: 'url', url}},
          {type: 'text', text: PROMPT},
        ]}],
      }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return parseKeywords(body.content?.find(block => block.type === 'text')?.text ?? '');
  } catch {
    return null;
  }
}

// Mutates each sale's photoKeywords (and an empty contentsLine) in place.
// `cache` is the photo-scan.json object; new entries are added to it for the
// caller to persist. Never throws for API trouble.
export async function enrichSalesWithVision(sales, {
  config, cache = {}, fetchImpl = fetch, maxPerSale = 12, maxNewPerRun = 120,
  now = () => new Date(),
} = {}) {
  const stats = {scanned: 0, cached: 0, failed: 0, salesTouched: 0};
  if (!config) return stats;
  for (const sale of sales) {
    const found = [];
    for (const url of (sale.photoUrls ?? []).slice(0, maxPerSale)) {
      const key = photoCacheKey(url);
      if (cache[key]?.keywords) {
        stats.cached++;
        found.push(...cache[key].keywords);
        continue;
      }
      if (stats.scanned + stats.failed >= maxNewPerRun) break;
      const keywords = await scanPhoto(url, config, fetchImpl);
      if (keywords === null) {
        stats.failed++;
        continue;
      }
      stats.scanned++;
      cache[key] = {keywords, provider: config.provider, scannedAt: now().toISOString()};
      found.push(...keywords);
    }
    const merged = [...new Set([...(sale.photoKeywords ?? []), ...found])];
    if (merged.length !== (sale.photoKeywords ?? []).length) stats.salesTouched++;
    sale.photoKeywords = merged.slice(0, 12);
    if (!sale.contentsLine) sale.contentsLine = buildContentsLine(sale.photoKeywords);
  }
  return stats;
}
