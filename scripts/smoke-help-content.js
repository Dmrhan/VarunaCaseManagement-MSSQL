/**
 * smoke-help-content.js — Varuna in-product help freshness check.
 *
 * Loads `src/help/helpRegistry.ts` (Node native TS type-stripping; Node 22+),
 * iterates every HelpTopic, and validates:
 *
 *   1. Required structural fields (topic / audience / title / summary / sections).
 *   2. Every `requiredKeyword` appears in the topic's text (case-insensitive).
 *   3. No banned phrase appears anywhere in the topic
 *      (operator default banlist + topic-level additions, case-insensitive).
 *   4. `updatedAt`, when present, is a parseable ISO date.
 *
 * Exit codes:
 *   0 — every topic passes.
 *   1 — at least one rule violation (printed with topic + reason).
 *
 * Usage:
 *   node --check scripts/smoke-help-content.js
 *   node scripts/smoke-help-content.js
 *
 * See `docs/IN_PRODUCT_HELP_STANDARD.md` for the contract.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const REGISTRY_PATH = resolve(process.cwd(), 'src/help/helpRegistry.ts');
const REGISTRY_URL = pathToFileURL(REGISTRY_PATH).href;

let HELP_TOPICS;
let OPERATOR_DEFAULT_BANNED_PHRASES;
try {
  ({ HELP_TOPICS, OPERATOR_DEFAULT_BANNED_PHRASES } = await import(REGISTRY_URL));
} catch (err) {
  console.error(`[ABORT] Could not load help registry at ${REGISTRY_PATH}.`);
  console.error('Hint: Node 22+ supports .ts imports via type-stripping; older runtimes do not.');
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

let totalTopics = 0;
let totalViolations = 0;
const violationsByTopic = new Map();

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

  // 4) updatedAt parseable when present (checked early so we surface invalids
  //    alongside structural problems).
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

  // 3) Banned phrases absent. Operator topics inherit default banlist.
  const banSet = new Set();
  if (topic.audience === 'operator') {
    for (const b of OPERATOR_DEFAULT_BANNED_PHRASES) banSet.add(String(b).toLowerCase());
  }
  if (Array.isArray(topic.bannedPhrases)) {
    for (const b of topic.bannedPhrases) banSet.add(String(b).toLowerCase());
  }
  for (const phrase of banSet) {
    if (haystack.includes(phrase)) {
      record(id, `banned phrase present: ${JSON.stringify(phrase)}`);
    }
  }
}

header('Help registry smoke');
console.log(`  Topics checked  ${fmt(totalTopics)}`);
console.log(`  Violations      ${fmt(totalViolations)}`);

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
