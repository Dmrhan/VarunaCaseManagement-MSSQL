/**
 * smoke-help-content.js — Varuna in-product help freshness check.
 *
 * Loads `src/help/helpRegistry.ts` and validates every HelpTopic:
 *
 *   1. Required structural fields (topic / audience / title / summary / sections).
 *   2. Every `requiredKeyword` appears in the topic's text (case-insensitive).
 *   3. No banned phrase appears anywhere in the topic
 *      (operator default banlist + topic-level additions, case-insensitive).
 *   4. `updatedAt`, when present, is a parseable ISO date.
 *
 * Loader: prefers Node 22+ native TypeScript type-stripping; falls back to
 * the project's `typescript` devDependency (`transpileModule`) on older
 * runtimes (CI is pinned to Node 20).
 *
 * Banned-phrase exceptions: a banned phrase that appears in user-visible
 * topic text is exempted ONLY when the same line in the .ts source carries
 * an `// allowed: <reason>` annotation. There is no silent allowlist.
 *
 * Exit codes:
 *   0 — every topic passes.
 *   1 — at least one rule violation (printed with topic + reason).
 *
 * Usage:
 *   node --check scripts/smoke-help-content.js
 *   node scripts/smoke-help-content.js
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY_PATH = resolve(process.cwd(), 'src/help/helpRegistry.ts');
const REGISTRY_URL = pathToFileURL(REGISTRY_PATH).href;
const REGISTRY_SRC = readFileSync(REGISTRY_PATH, 'utf8');

const NODE_MAJOR = Number.parseInt(process.versions.node.split('.')[0], 10);

// ─────────────────────────────────────────────────────────────────────
// Loader: Node 22+ native TS strip → fallback to typescript devDep.
// ─────────────────────────────────────────────────────────────────────

async function loadRegistry() {
  // Try native TypeScript type-stripping first (Node 22+).
  if (NODE_MAJOR >= 22) {
    try {
      return await import(REGISTRY_URL);
    } catch {
      /* fall through to TS API compile */
    }
  }
  // Fallback: compile via the project's TypeScript devDependency.
  let ts;
  try {
    ts = (await import('typescript')).default;
  } catch (err) {
    console.error('[ABORT] Cannot load `typescript` devDependency for fallback compile.');
    console.error(`  ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
  const out = ts.transpileModule(REGISTRY_SRC, {
    fileName: REGISTRY_PATH,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
      esModuleInterop: true,
    },
  });
  if (out.diagnostics && out.diagnostics.length > 0) {
    for (const d of out.diagnostics) {
      const text = typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText;
      console.error(`[ts] ${text}`);
    }
  }
  const tmpDir = mkdtempSync(join(tmpdir(), 'varuna-help-smoke-'));
  const tmpFile = join(tmpDir, 'helpRegistry.mjs');
  writeFileSync(tmpFile, out.outputText, 'utf8');
  try {
    return await import(pathToFileURL(tmpFile).href);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

let HELP_TOPICS;
let OPERATOR_DEFAULT_BANNED_PHRASES;
try {
  ({ HELP_TOPICS, OPERATOR_DEFAULT_BANNED_PHRASES } = await loadRegistry());
} catch (err) {
  console.error(`[ABORT] Could not load help registry at ${REGISTRY_PATH}.`);
  console.error(`  ${err && err.message ? err.message : err}`);
  process.exit(1);
}

if (!Array.isArray(HELP_TOPICS)) {
  console.error('[ABORT] HELP_TOPICS export missing or not an array.');
  process.exit(1);
}
if (!Array.isArray(OPERATOR_DEFAULT_BANNED_PHRASES)) {
  console.error('[ABORT] OPERATOR_DEFAULT_BANNED_PHRASES export missing or not an array.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────
// Source-line parsing for `// allowed:` exceptions.
//
// We slice the .ts source into per-topic line ranges (anchored on the
// `topic: '<id>'` literal) so a banned phrase can be exempted ONLY for
// the topic whose source carries the annotation. Cross-topic leakage
// of allowances is not possible.
// ─────────────────────────────────────────────────────────────────────

function sliceTopicSourceLines(srcText, topicIds) {
  const lines = srcText.split('\n');
  /** @type {Array<{ id: string; line: number }>} */
  const anchors = [];
  for (let i = 0; i < lines.length; i++) {
    for (const id of topicIds) {
      // Match: topic: 'data-import-studio'   (single or double quote)
      if (lines[i].includes(`topic: '${id}'`) || lines[i].includes(`topic: "${id}"`)) {
        anchors.push({ id, line: i });
        break;
      }
    }
  }
  /** @type {Map<string, string[]>} */
  const blocks = new Map();
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].line;
    const end = i + 1 < anchors.length ? anchors[i + 1].line : lines.length;
    blocks.set(anchors[i].id, lines.slice(start, end));
  }
  return blocks;
}

/**
 * For a topic, given the set of banned phrases that fired on its runtime
 * text, return the subset that is exempted via `// allowed: <reason>`
 * annotations in the topic's source lines.
 */
function exemptedByAllowed(topicLines, firedPhrases) {
  const exempted = new Set();
  for (const phrase of firedPhrases) {
    const phraseLc = phrase.toLowerCase();
    for (const line of topicLines) {
      if (!line.toLowerCase().includes(phraseLc)) continue;
      if (/\/\/\s*allowed:/i.test(line)) {
        exempted.add(phrase);
        break;
      }
    }
  }
  return exempted;
}

// ─────────────────────────────────────────────────────────────────────
// Validation core
// ─────────────────────────────────────────────────────────────────────

function fmt(n) { return String(n).padStart(3, ' '); }
function header(title) {
  console.log(`\n${'─'.repeat(64)}\n  ${title}\n${'─'.repeat(64)}`);
}

/** Flatten a topic into a single lowercased searchable string. */
function topicText(topic) {
  const parts = [topic.title ?? '', topic.summary ?? ''];
  for (const s of topic.sections ?? []) {
    parts.push(s.title ?? '');
    if (typeof s.body === 'string') parts.push(s.body);
    else if (Array.isArray(s.body)) parts.push(s.body.join('\n'));
  }
  return parts.join('\n').toLowerCase();
}

const topicIds = HELP_TOPICS
  .map((t) => (t && typeof t.topic === 'string' ? t.topic : null))
  .filter((x) => !!x);
const sourceBlocks = sliceTopicSourceLines(REGISTRY_SRC, topicIds);

let totalTopics = 0;
let totalViolations = 0;
let totalExempted = 0;
/** @type {Map<string, string[]>} */
const violationsByTopic = new Map();
/** @type {Array<{ id: string; phrase: string }>} */
const exemptionLog = [];

function record(topicId, line) {
  totalViolations += 1;
  const list = violationsByTopic.get(topicId) ?? [];
  list.push(line);
  violationsByTopic.set(topicId, list);
}

for (const topic of HELP_TOPICS) {
  totalTopics += 1;
  const id = topic && typeof topic.topic === 'string' ? topic.topic : '(no-id)';

  // 1) Structural fields.
  if (!topic || typeof topic !== 'object') {
    record(id, 'topic entry is not an object');
    continue;
  }
  if (!topic.topic || typeof topic.topic !== 'string') record(id, 'topic.topic missing or not a string');
  if (!topic.audience || !['operator', 'admin', 'technical-admin'].includes(topic.audience)) {
    record(id, `topic.audience invalid (got ${JSON.stringify(topic.audience)})`);
  }
  if (!topic.title || typeof topic.title !== 'string') record(id, 'topic.title missing');
  if (!topic.summary || typeof topic.summary !== 'string') record(id, 'topic.summary missing');
  if (!Array.isArray(topic.sections) || topic.sections.length === 0) {
    record(id, 'topic.sections missing or empty');
  } else {
    topic.sections.forEach((sec, i) => {
      if (!sec || typeof sec !== 'object') return record(id, `sections[${i}] not an object`);
      if (!sec.title || typeof sec.title !== 'string') record(id, `sections[${i}].title missing`);
      if (!('body' in sec)) record(id, `sections[${i}].body missing`);
      if (sec.body !== undefined && typeof sec.body !== 'string' && !Array.isArray(sec.body)) {
        record(id, `sections[${i}].body must be string or string[]`);
      }
      if (sec.tone && !['info', 'warning', 'success'].includes(sec.tone)) {
        record(id, `sections[${i}].tone invalid (got ${JSON.stringify(sec.tone)})`);
      }
    });
  }

  if (topic.updatedAt !== undefined) {
    if (typeof topic.updatedAt !== 'string' || Number.isNaN(Date.parse(topic.updatedAt))) {
      record(id, `topic.updatedAt is not a parseable ISO date (got ${JSON.stringify(topic.updatedAt)})`);
    }
  }

  const haystack = topicText(topic);

  // 2) Required keywords present.
  if (Array.isArray(topic.requiredKeywords)) {
    for (const kw of topic.requiredKeywords) {
      if (!kw || typeof kw !== 'string') {
        record(id, `requiredKeywords contains a non-string entry: ${JSON.stringify(kw)}`);
        continue;
      }
      if (!haystack.includes(kw.toLowerCase())) {
        record(id, `required keyword missing: ${JSON.stringify(kw)}`);
      }
    }
  }

  // 3) Banned phrases absent (with `// allowed:` exceptions).
  const banSet = new Set();
  if (topic.audience === 'operator') {
    for (const b of OPERATOR_DEFAULT_BANNED_PHRASES) banSet.add(String(b).toLowerCase());
  }
  if (Array.isArray(topic.bannedPhrases)) {
    for (const b of topic.bannedPhrases) banSet.add(String(b).toLowerCase());
  }
  /** @type {Set<string>} */
  const firedPhrases = new Set();
  for (const phrase of banSet) {
    if (haystack.includes(phrase)) firedPhrases.add(phrase);
  }
  const topicLines = sourceBlocks.get(id) ?? [];
  const exempted = exemptedByAllowed(topicLines, firedPhrases);
  for (const phrase of firedPhrases) {
    if (exempted.has(phrase)) {
      totalExempted += 1;
      exemptionLog.push({ id, phrase });
      continue;
    }
    record(id, `banned phrase present: ${JSON.stringify(phrase)}`);
  }
}

header('Help registry smoke');
console.log(`  Topics checked       ${fmt(totalTopics)}`);
console.log(`  Loader               ${NODE_MAJOR >= 22 ? 'native TS strip' : 'typescript.transpileModule fallback'}`);
console.log(`  Banned exemptions    ${fmt(totalExempted)} (via // allowed:)`);
console.log(`  Violations           ${fmt(totalViolations)}`);

if (exemptionLog.length > 0) {
  console.log('\n  Exempted banned phrases (allowed by topic):');
  for (const e of exemptionLog) console.log(`    · ${e.id}: ${JSON.stringify(e.phrase)}`);
}

if (totalViolations === 0) {
  console.log('\n[PASS] All help topics satisfy the standard.');
  process.exit(0);
}

for (const [id, lines] of violationsByTopic) {
  console.log(`\n  Topic: ${id}`);
  for (const ln of lines) console.log(`    ✗ ${ln}`);
}
console.error(`\n[FAIL] ${totalViolations} violation(s) across ${violationsByTopic.size} topic(s).`);
process.exit(1);
