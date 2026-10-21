import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_CONTENT } from "./help-content";
import { TOOLS, TOOL_DOMAIN } from "./atlas/tool-loop";

// Sentences that attribute a search/lookup capability to Atlas.
// Both the bare and conjugated verb forms count: "Atlas will search hotels" is
// the same promise as "Atlas searches hotels", and the modal auxiliaries are
// where the claim usually hides.
const CLAIM_RE =
  /\bAtlas\s+(?:(?:can|will|automatically|also)\s+)?(?:search(?:es)?|find(?:s)?|look(?:s)? up|pull(?:s)?|fetch(?:es)?)\b[^.;!]*/gi;
// Nouns a claim can name. Anything here that is not a live tool domain fails.
const NOUN_RE = /\b(flights?|hotels?|activities|activity|restaurants?|deals?|guides?|articles?|destinations?|tours?|cars?|rentals?|prices?)\b/gi;

const NORMALIZE: Record<string, string> = {
  flights: "flight", hotels: "hotel", activities: "activity", restaurants: "restaurant",
  deals: "deal", guides: "guide", articles: "guide", article: "guide", destinations: "destination",
  tours: "activity", cars: "car", rentals: "rental", prices: "flight", price: "flight",
};

function liveDomains(): Set<string> {
  return new Set(TOOLS.map((t) => TOOL_DOMAIN[t.name]));
}

describe("help copy only claims capabilities in the live tool registry", () => {
  it("every registered tool has a domain label", () => {
    for (const t of TOOLS) expect(TOOL_DOMAIN[t.name], `TOOL_DOMAIN missing ${t.name}`).toBeTruthy();
  });

  it("no help sentence attributes a search to Atlas for a domain with no tool", () => {
    const live = liveDomains();
    const offenders: string[] = [];
    for (const [pageId, page] of Object.entries(HELP_CONTENT)) {
      const texts = [page.intro, ...page.sections.map((s) => s.text)];
      for (const text of texts) {
        for (const claim of text.match(CLAIM_RE) ?? []) {
          for (const raw of claim.match(NOUN_RE) ?? []) {
            const noun = NORMALIZE[raw.toLowerCase()] ?? raw.toLowerCase();
            if (!live.has(noun)) offenders.push(`${pageId}: "${claim.trim()}" names "${raw}"`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("regression pins for the 2026-09-11 finding", () => {
    const all = JSON.stringify(HELP_CONTENT);
    expect(all).not.toContain("tabs for Flights, Hotels");
    expect(all).not.toContain("searches for flights, hotels, and activities");
    // exact old string only — hot-deals legitimately says "partner sites show real current prices"
    expect(all).not.toContain("practical tips, current prices");
    // nothing in src/ or messages/ renders an "(estimated)" marker any more
    expect(all).not.toContain("(estimated)");
    const bubble = readFileSync(resolve(process.cwd(), "src/hooks/useAtlasBubble.ts"), "utf-8");
    expect(bubble).not.toContain("hotels, or activities");
  });
});

// ---------------------------------------------------------------------------
// Atlas approved-sentence guard (review #8/#9).
// Rule: every sentence in HELP_CONTENT (intro + section text, split on .!?;)
// that names "Atlas" must have its SHA-256 in
// src/lib/help-content.atlas-approved.json — a NEW or EDITED Atlas sentence
// fails these tests until a human regenerates (and reviews) the file. The
// tool-domain checks above stay in place as a second layer.
//
// Hash normalization (the exact string hashed, per plan amendment):
//   1. split the intro/section text on /[.!?;]/ (the plan's sentence set),
//   2. Unicode NFC-normalize,
//   3. collapse every whitespace run to a single space,
//   4. trim leading/trailing whitespace.
// The stored sha256 is the lowercase hex SHA-256 over those UTF-8 bytes.
//
// Regenerate src/lib/help-content.atlas-approved.json (AFTER human review of
// every printed sentence) from the repo root with:
//   node --experimental-strip-types --input-type=module -e "<script>"
// where <script> is:
//   const { HELP_CONTENT } = await import('./src/lib/help-content.ts');
//   const { createHash } = await import('node:crypto');
//   const { writeFileSync } = await import('node:fs');
//   const norm = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
//   const atlas = [...new Set(Object.values(HELP_CONTENT)
//     .flatMap((p) => [p.intro, ...p.sections.map((x) => x.text)])
//     .flatMap((t) => t.split(/[.!?;]/))
//     .map(norm)
//     .filter((s) => s.includes('Atlas')))];
//   const entries = atlas.map((text) => ({
//     sha256: createHash('sha256').update(text, 'utf-8').digest('hex'),
//     text,
//   }));
//   writeFileSync('src/lib/help-content.atlas-approved.json',
//     JSON.stringify(entries, null, 2) + '\n');
// The per-entry integrity check below recomputes each hash with THIS file's
// normalizer, so a generator that drifts from this normalization fails.
// ---------------------------------------------------------------------------

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function normalizeSentence(sentence: string): string {
  return sentence.normalize("NFC").replace(/\s+/g, " ").trim();
}

function atlasSentences(texts: string[]): string[] {
  return texts
    .flatMap((t) => t.split(/[.!?;]/))
    .map(normalizeSentence)
    .filter((s) => s.includes("Atlas"));
}

function approvedEntries(): Array<{ sha256: string; text: string }> {
  return JSON.parse(readFileSync(resolve(process.cwd(), "src/lib/help-content.atlas-approved.json"), "utf-8"));
}

describe("Atlas approved-sentence guard", () => {
  it("every Atlas sentence is on the approved list", () => {
    const entries = approvedEntries();
    const approved = new Set(entries.map((e) => e.sha256));
    const offenders: string[] = [];
    for (const [pageId, page] of Object.entries(HELP_CONTENT)) {
      const texts = [page.intro, ...page.sections.map((s) => s.text)];
      for (const sentence of atlasSentences(texts)) {
        if (!approved.has(sha256Hex(sentence))) offenders.push(`${pageId}: "${sentence}"`);
      }
    }
    expect(offenders).toEqual([]);
    // File integrity: an entry whose stored text no longer hashes to its own
    // sha256 means the file was hand-edited without rehashing.
    for (const entry of entries) {
      expect(sha256Hex(normalizeSentence(entry.text)), `approved entry drifted: "${entry.text}"`).toBe(entry.sha256);
    }
  });

  it("an unapproved Atlas sentence fails", () => {
    // Sentences that never shipped are not in the approved set: the exported
    // checker must return one offender per unapproved Atlas sentence.
    const approved = new Set(approvedEntries().map((e) => e.sha256));
    const offenders = findUnapproved(
      ["Use Atlas to compare hotel prices.", "Atlas helps you book hotels.", "Search hotels and activities with Atlas."],
      approved,
    );
    expect(offenders).toHaveLength(3);
  });

  it("getting-started copy names smart search", () => {
    const common = JSON.parse(readFileSync(resolve(process.cwd(), "messages/en/common.json"), "utf-8"));
    const gettingStarted = HELP_CONTENT["planner-itinerary"].sections.find((s) => s.heading === "Getting started");
    expect(gettingStarted, "Getting started section missing").toBeTruthy();
    const text = gettingStarted?.text ?? "";
    expect(text).toContain(common.atlasSmartSearch.start);
    expect(text).not.toContain("does not search on its own");
  });
});

// The plan-mandated exported checker: one offender per sentence in `texts`
// whose Atlas sentence is not covered by the approved hash set.
export function findUnapproved(texts: string[], approved: Set<string>): string[] {
  return atlasSentences(texts).filter((s) => !approved.has(sha256Hex(s)));
}

// The itinerary "flights, hotels, and activities" promise lived in SIX translated
// files as well as in the components, and the consent chip asked the user to
// approve exactly that search. Copy fixed only in `en` would still ship the
// promise to five locales, so pin every locale — each phrase is checked against
// every file, so a phrase migrating between locales fails too.
const FORBIDDEN_LOCALE_PHRASES = [
  "hotels, and activities",
  "hotels, or activities",
  "Hotels und Aktivitäten",
  "Hotels oder Aktivitäten",
  "hoteles y actividades",
  "hoteles o actividades",
  "hôtels et activités",
  "hôtels ou activités",
  "hotel e attività",
  "hotel o attività",
  "hotéis e atividades",
  "hotéis ou atividades",
];

/** Every string value in a nested translation object, with its dotted key path. */
function flattenStrings(node: unknown, path = ""): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flattenStrings(v, path ? `${path}.${k}` : k)
  );
}

describe("no locale promises hotel/activity search", () => {
  const messagesDir = resolve(process.cwd(), "messages");
  const locales = readdirSync(messagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it("finds the locale files (guard cannot pass by scanning nothing)", () => {
    expect(locales.length).toBeGreaterThanOrEqual(6);
  });

  // Scan PARSED, NFC-NORMALIZED values — never the raw file text
  // (feedback_scan_parsed_values_not_serialized). Two ways the same rendered
  // sentence hides from a naive scan, both of which a translation tool
  // round-tripping this file will happily emit:
  //   1. the umlaut written as a JSON \u escape — valid JSON, renders identically,
  //      and the raw bytes never contain the accented phrase;
  //   2. the umlaut stored DECOMPOSED (plain a + combining diaeresis U+0308) —
  //      byte-different from the composed form, visually and semantically identical.
  // JSON.parse handles (1); normalizing both sides to NFC handles (2).
  const nfc = (s: string) => s.normalize("NFC");
  const forbidden = FORBIDDEN_LOCALE_PHRASES.map(nfc);

  it.each(locales)("messages/%s/common.json claims no hotel or activity search", (locale) => {
    const raw = readFileSync(resolve(messagesDir, locale, "common.json"), "utf-8");
    const entries = flattenStrings(JSON.parse(raw));

    expect(entries.length, `messages/${locale}/common.json produced no strings to scan`).toBeGreaterThan(0);

    const offenders = entries.flatMap(([key, value]) =>
      forbidden
        .filter((phrase) => nfc(value).includes(phrase))
        .map((phrase) => `${locale}: ${key} contains "${phrase}"`)
    );

    expect(offenders).toEqual([]);
  });
});
