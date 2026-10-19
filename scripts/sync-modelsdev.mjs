#!/usr/bin/env node
/**
 * models.dev cross-check — candidate generator, NEVER an auto-writer.
 *
 * models.dev (https://models.dev, api.json ≈ 5 MB, 225 providers / 8k models)
 * publishes per-model cost (USD per 1M tokens), limits (context/output),
 * modalities and reasoning flags — the same facts this repo hand-maintains in
 * open-sse/providers/pricing.js and capabilities.js. This script downloads the
 * sheet once (cached under node_modules/.cache/), intersects it with OUR
 * registry, and reports where models.dev knows something we don't:
 *
 *   [A] pricing gaps   — registry LLM rows with NO price here (the audit-pricing
 *                        gate's list) that models.dev DOES price → candidates
 *   [B1] canonical drift — rows priced by an exact MODEL_PRICING entry where
 *                        models.dev's rate differs → our hand-maintained rate
 *                        may be STALE; a human reconciles with the official
 *                        sheet (models.dev can lag a price cut either way)
 *   [B2] channel drift   — rows priced only by a wildcard where the reseller's
 *                        own sheet rate differs → expected markup noise,
 *                        count + sample only
 *   [C] capability gaps— chat models that fall through to DEFAULT_CAPABILITIES
 *                        (the audit-capabilities floor list) where models.dev
 *                        carries context/output limits, vision or reasoning
 *   [D] coverage       — how much of our registry the sheet actually knows
 *
 * Nothing is written into pricing.js / capabilities.js: the output is a report
 * plus, with --out, a JSON candidate file for a human to turn into edits.
 * Hand-tuned values (1M-context overrides, per-modality exemptions) always win;
 * candidates only ever FILL holes, and the exemption tables in audit-pricing.mjs
 * are reused verbatim so a credit-plan channel never gets a USD proposal.
 *
 * Usage:
 *   node scripts/sync-modelsdev.mjs                 # report (downloads once)
 *   node scripts/sync-modelsdev.mjs --refresh       # ignore the cache
 *   node scripts/sync-modelsdev.mjs --out cand.json # + write candidates
 *   node scripts/sync-modelsdev.mjs --cache <path>  # custom cache location
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registryLlmRows, classify, EXEMPT_MODELS } from "./audit-pricing.mjs";
import { CHAT_MODELS, resolveStep } from "./audit-capabilities.mjs";
import { getPricingForModel } from "../open-sse/providers/pricing.js";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "https://models.dev/api.json";
const argv = process.argv.slice(2);
const cachePath = (() => {
  const i = argv.indexOf("--cache");
  if (i > -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return path.join(REPO, "node_modules", ".cache", "modelsdev-api.json");
})();

async function loadSheet() {
  if (!argv.includes("--refresh")) {
    try {
      return JSON.parse(readFileSync(cachePath, "utf8"));
    } catch {
      // first run or corrupt cache — fall through to the network
    }
  }
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`models.dev api.json: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, text);
  return JSON.parse(text);
}

/** lowercased model id (every spelling models.dev carries) -> candidate rows */
function buildIndex(sheet) {
  const byId = new Map();
  for (const [provKey, prov] of Object.entries(sheet)) {
    for (const [mid, m] of Object.entries(prov.models || {})) {
      const rec = { provider: provKey, providerName: prov.name || provKey, entry: m };
      const keys = new Set(
        [mid, m.id, m.canonical_model_id].filter(Boolean).map((k) => String(k).toLowerCase())
      );
      for (const k of keys) {
        if (!byId.has(k)) byId.set(k, []);
        byId.get(k).push(rec);
      }
    }
  }
  return byId;
}

/** Our registry id → the models.dev row for it, preferring a same-slug provider. */
function match(byId, provider, model) {
  const wanted = [model, model.includes("/") ? model.split("/").pop() : model]
    .map((s) => s.toLowerCase());
  for (const key of wanted) {
    const cands = byId.get(key);
    if (!cands?.length) continue;
    return cands.find((c) => c.provider === provider) || cands[0];
  }
  return null;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** models.dev cost → our {input,output,cached,cache_creation} shape. */
function toOurPricing(cost) {
  if (!cost) return null;
  const input = num(cost.input);
  const output = num(cost.output);
  if (input === null && output === null) return null;
  const out = { input: input ?? 0, output: output ?? 0 };
  if (num(cost.cache_read) !== null) out.cached = cost.cache_read;
  if (num(cost.cache_write) !== null) out.cache_creation = cost.cache_write;
  return out;
}

function fmtPrice(p) {
  return p ? `in $${p.input} / out $${p.output}${p.cached !== undefined ? ` / cache $${p.cached}` : ""}` : "no price";
}

async function main() {
  const sheet = await loadSheet();
  const byId = buildIndex(sheet);
  const sheetModels = new Set();
  for (const cands of byId.values()) for (const c of cands) sheetModels.add(`${c.provider}/${c.entry.id}`);

  // ── [A] pricing gaps we could fill ─────────────────────────────
  // A $0/$0 sheet row is "the sheet has no real rate" (free tier, credit plan),
  // not a candidate — proposing it would just move a $0 hole sideways.
  const priced = (p) => p && (p.input > 0 || p.output > 0);
  const pricingCandidates = [];
  const llmRows = registryLlmRows();
  for (const r of llmRows) {
    if (EXEMPT_MODELS.has(r.model)) continue;
    if (classify(r.provider, r.model).kind !== "none") continue;
    const hit = match(byId, r.provider, r.model);
    const ours = toOurPricing(hit?.entry?.cost);
    if (hit && priced(ours)) pricingCandidates.push({ provider: r.provider, model: r.model, source: `${hit.provider}/${hit.entry.id}`, pricing: ours });
  }

  // ── [B] drift between our rate and the sheet's ─────────────────
  // Two noise filters. (1) A $0 sheet row means "no real rate here", not a
  // disagreement — our channel prices come from the vendors' official sheets.
  // (2) Our rates resolve per CANONICAL model, so one drift would otherwise
  // print once per reseller channel carrying that id — dedupe by model id.
  // Split by HOW we price it: an `exact` hit means the disagreement is with a
  // hand-maintained MODEL_PRICING row (our canonical rate may be stale — the
  // interesting half), while a `pattern` hit is a reseller channel whose own
  // markup differs from our generic wildcard — expected noise, count + sample.
  const driftExact = [];
  const driftPattern = [];
  const seenDrift = new Set();
  for (const r of llmRows) {
    const c = classify(r.provider, r.model);
    if (c.kind === "none") continue;
    const hit = match(byId, r.provider, r.model);
    const theirs = toOurPricing(hit?.entry?.cost);
    if (!priced(theirs)) continue;
    const ours = getPricingForModel(r.provider, r.model);
    if (!ours) continue;
    const dIn = Math.abs((ours.input ?? 0) - theirs.input);
    const dOut = Math.abs((ours.output ?? 0) - theirs.output);
    if (dIn <= 0.005 && dOut <= 0.005) continue;
    const row = { provider: r.provider, model: r.model, via: c.kind, ours: fmtPrice(ours), modelsDev: fmtPrice(theirs), source: `${hit.provider}/${hit.entry.id}` };
    if (c.kind === "exact") {
      if (!seenDrift.has(r.model)) {
        seenDrift.add(r.model);
        driftExact.push(row);
      }
    } else {
      driftPattern.push({ ...row, pattern: c.pattern });
    }
  }
  const drift = [...driftExact, ...driftPattern];

  // ── [C] capability floors the sheet can fill ───────────────────
  const capCandidates = [];
  for (const m of CHAT_MODELS) {
    if (resolveStep(m.provider, m.id).step !== "floor") continue;
    const hit = match(byId, m.provider, m.id);
    if (!hit) continue;
    const e = hit.entry;
    const caps = {};
    if (num(e.limit?.context)) caps.contextWindow = e.limit.context;
    if (num(e.limit?.output)) caps.maxOutput = e.limit.output;
    if (Array.isArray(e.modalities?.input) && e.modalities.input.includes("image")) caps.vision = true;
    if (e.reasoning === true) caps.reasoning = true;
    if (Object.keys(caps).length) capCandidates.push({ provider: m.provider, model: m.id, source: `${hit.provider}/${hit.entry.id}`, caps });
  }

  // ── [D] coverage ───────────────────────────────────────────────
  const uniq = [...new Map(llmRows.map((r) => [r.model, r])).values()];
  const matched = uniq.filter((r) => match(byId, r.provider, r.model));
  const unmatched = uniq.filter((r) => !match(byId, r.provider, r.model));

  console.log(`models.dev sheet: ${Object.keys(sheet).length} providers, ${sheetModels.size} provider/model rows`);
  console.log(`our registry LLM ids: ${uniq.length} — matched by the sheet: ${matched.length} (${Math.round((100 * matched.length) / uniq.length)}%), unmatched: ${unmatched.length}`);
  console.log(`\n[A] pricing gaps the sheet can fill: ${pricingCandidates.length}`);
  for (const c of pricingCandidates.slice(0, 25)) console.log(`  ${c.model}  [${c.provider}]  <- ${c.source}  ${fmtPrice(c.pricing)}`);
  if (pricingCandidates.length > 25) console.log(`  … ${pricingCandidates.length - 25} more (see --out)`);
  console.log(`\n[B1] our CANONICAL rate ≠ sheet rate: ${driftExact.length} — a hand-maintained MODEL_PRICING row may be stale; reconcile with the official sheet`);
  for (const d of driftExact.slice(0, 25)) console.log(`  ${d.model}  [${d.provider}]   ours ${d.ours}   sheet ${d.modelsDev}  (${d.source})`);
  if (driftExact.length > 25) console.log(`  … ${driftExact.length - 25} more (see --out)`);
  console.log(`\n[B2] channel markup ≠ our wildcard: ${driftPattern.length} — expected for resellers; sample:`);
  for (const d of driftPattern.slice(0, 10)) console.log(`  ${d.model}  [${d.provider}] <- ${d.pattern ?? d.via}   ours ${d.ours}   sheet ${d.modelsDev}`);
  if (driftPattern.length > 10) console.log(`  … ${driftPattern.length - 10} more (see --out)`);
  console.log(`\n[C] capability floors the sheet can fill: ${capCandidates.length}`);
  for (const c of capCandidates.slice(0, 25)) console.log(`  ${c.model}  [${c.provider}]  <- ${c.source}  ${JSON.stringify(c.caps)}`);
  if (capCandidates.length > 25) console.log(`  … ${capCandidates.length - 25} more (see --out)`);
  if (unmatched.length) {
    console.log(`\n[D] sample of ids the sheet does not know (${unmatched.length} total):`);
    for (const u of unmatched.slice(0, 15)) console.log(`  ${u.model}  [${u.provider}]`);
  }

  const i = argv.indexOf("--out");
  if (i > -1 && argv[i + 1]) {
    const file = path.resolve(argv[i + 1]);
    writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), source: SOURCE, pricingCandidates, driftExact, driftPattern, capCandidates, unmatched }, null, 2));
    console.log(`\ncandidates written to ${file}`);
  }
  console.log("\n(nothing was applied — pricing.js / capabilities.js are edited by hand from these candidates)");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
