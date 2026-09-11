import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_CONTENT } from "./help-content";
import { TOOLS, TOOL_DOMAIN } from "./atlas/tool-loop";

// Sentences that attribute an automatic search/lookup to Atlas.
const CLAIM_RE = /\bAtlas\s+(?:automatically\s+|also\s+|will\s+)?(?:searches|finds|looks up|pulls|fetches)\b[^.;!]*/gi;
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
    const bubble = readFileSync(resolve(process.cwd(), "src/hooks/useAtlasBubble.ts"), "utf-8");
    expect(bubble).not.toContain("hotels, or activities");
  });
});
