import { readdirSync, readFileSync } from "node:fs";
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

describe("no locale promises hotel/activity search", () => {
  const messagesDir = resolve(process.cwd(), "messages");
  const locales = readdirSync(messagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it("finds the locale files (guard cannot pass by scanning nothing)", () => {
    expect(locales.length).toBeGreaterThanOrEqual(6);
  });

  it.each(locales)("messages/%s/common.json claims no hotel or activity search", (locale) => {
    const raw = readFileSync(resolve(messagesDir, locale, "common.json"), "utf-8");

    for (const phrase of FORBIDDEN_LOCALE_PHRASES) {
      expect(raw, `messages/${locale}/common.json still contains "${phrase}"`).not.toContain(phrase);
    }
  });
});
