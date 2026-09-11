import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS } from "./tool-loop";
import { buildAtlasSystemPrompt } from "./system-prompt";

describe("Atlas D3 no-fabrication guarantees", () => {
  it("exposes exactly the allowed real-data tools and no D3-forbidden inventory tools", () => {
    const toolNames = TOOLS.map((tool) => tool.name);

    expect(toolNames).toEqual(["search_flights", "get_deals", "get_article", "surprise_me"]);
    expect(toolNames).toHaveLength(4);
    expect(toolNames).not.toContain("search_hotels");
    expect(toolNames).not.toContain("search_activities");
    expect(toolNames).not.toContain("search_restaurants");
  });

  it("includes the explicit D3 prohibition text for hotels, activities, tours, and restaurants", () => {
    const prompt = buildAtlasSystemPrompt({ pageContext: "Active trip to Miami, Florida" });

    expect(prompt).toMatch(/must not invent/i);
    expect(prompt).toMatch(/hotels?/i);
    expect(prompt).toMatch(/activities?/i);
    expect(prompt).toMatch(/restaurants?/i);
  });

  it("includes a well-formed markdown Hotels.com/CJ link when a destination is identified", () => {
    const prompt = buildAtlasSystemPrompt({ pageContext: "Active trip to Miami, Florida" });

    expect(prompt).toMatch(/\[[^\]]+\]\(https:\/\/www\.dpbolvw\.net[^)]+\)/);
  });
});

const SURPRISE_PATH_FILES = [
  "src/app/api/surprise-me/route.ts",
  "src/components/SurpriseMeSection.tsx",
  "src/components/SurpriseClarificationCard.tsx",
  "src/components/AtlasHeroSection.tsx",
  "src/components/DestinationCard.tsx",
  "src/lib/atlas/surprise-query.ts",
  "src/lib/atlas/surprise.ts",
  "src/lib/atlas/tool-loop.ts",
  "src/lib/atlas/tool-render.ts",
  "src/lib/atlas/city-names.ts",
  "src/lib/atlas/destination-vibes.ts",
  "src/lib/atlas/vibe-preflight.ts",
];

const BANNED_SUBSTRINGS = [
  "$89",
  "$95",
  "$75",
  "$127",
  "$159",
  "$189",
  "/night",
  "hotelPrice",
  "Spirit NK",
  "JetBlue",
  "V1_FALLBACK",
  "FALLBACK",
];

describe("Surprise Me fabrication tripwire", () => {
  it.each(SURPRISE_PATH_FILES)("%s contains no banned Surprise Me fabricated literals", (file) => {
    const content = readFileSync(resolve(process.cwd(), file), "utf-8");

    for (const literal of BANNED_SUBSTRINGS) {
      expect(content, `${file} must not contain ${literal}`).not.toContain(literal);
    }
  });

  it("does not bake MIA origin substitution into the Surprise Me engine", () => {
    const file = "src/lib/atlas/surprise.ts";
    const content = readFileSync(resolve(process.cwd(), file), "utf-8");

    expect(content, `${file} must not contain MIA`).not.toContain("MIA");
  });

  it("delegates Surprise Me client query construction so flexible never reaches the API as a vibe", () => {
    const file = "src/components/SurpriseMeSection.tsx";
    const content = readFileSync(resolve(process.cwd(), file), "utf-8");

    // The flexible sentinel must never be reachable as a vibe param from the client.
    expect(content, `${file} must delegate Surprise Me query construction`).toContain("buildSurpriseQuery");
    expect(content, `${file} must not set a vibes param inline`).not.toMatch(/set\(\s*.vibes./);
    expect(content, `${file} must not construct query params inline`).not.toContain("new URLSearchParams");
  });
});

const PRODUCT_SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const BANNED_ENTRY_COMPONENT_BASENAMES = new Set([
  "EntryTabs",
  "SurpriseMeQuiz",
  "DestinationSuggestions",
]);

function productSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...productSourceFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name);
    if (!PRODUCT_SOURCE_EXTENSIONS.has(extension) || /\.test\.tsx?$/.test(entry.name)) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function productSourcePath(file: string): string {
  return relative(process.cwd(), file).split("\\").join("/");
}

const PLANNER_DETAIL_PAGE = "src/app/[locale]/planner/[tripId]/page.tsx";
const PARKED_QUIZ_RENDER_FIELDS = ["quiz_budget", "quiz_vibes", "quiz_who"] as const;

// The three-mode entry system was rejected 2026-04-10 and its PRESET_VIBES was
// a second, dead vibe vocabulary that fooled two analyses. It is deleted, and
// this guard keeps it deleted. NOTE (anti-self-defeat): scan product source
// under src/ only, never test files or docs, so this guard can name PRESET_VIBES
// and the rejected component basenames without matching itself.
describe("dead entry-system stays dead", () => {
  const srcRoot = resolve(process.cwd(), "src");

  it("keeps parked quiz enums out of the resolved-trip planner render path", () => {
    const content = readFileSync(resolve(process.cwd(), PLANNER_DETAIL_PAGE), "utf-8");

    for (const field of PARKED_QUIZ_RENDER_FIELDS) {
      expect(content, `${PLANNER_DETAIL_PAGE} must not render trip.${field}`).not.toContain(`trip.${field}`);
    }
  });

  it("keeps PRESET_VIBES out of every product source module", () => {
    const offenders = productSourceFiles(srcRoot)
      .filter((file) => readFileSync(file, "utf-8").includes("PRESET_VIBES"))
      .map(productSourcePath);

    expect(offenders, "PRESET_VIBES must not reappear in product source").toEqual([]);
  });

  it("keeps the rejected entry-system component basenames deleted anywhere under src", () => {
    const offenders = productSourceFiles(srcRoot)
      .filter((file) => {
        const parsedBasename = basename(file, extname(file));
        const pathSegments = productSourcePath(file).split("/");
        return (
          BANNED_ENTRY_COMPONENT_BASENAMES.has(parsedBasename) ||
          (parsedBasename === "index" &&
            pathSegments.some((segment) => BANNED_ENTRY_COMPONENT_BASENAMES.has(segment)))
        );
      })
      .map(productSourcePath);

    expect(offenders, "rejected entry-system components must not reappear").toEqual([]);
  });
});

describe("AssistantChat fabrication tripwire", () => {
  const file = "src/components/AssistantChat.tsx";
  const content = readFileSync(resolve(process.cwd(), file), "utf-8");

  it("never substitutes a made-up flight duration", () => {
    expect(content).not.toContain('"0h 0m"');
  });

  it("only treats live tools as trip tools", () => {
    expect(content).toMatch(/TRIP_TOOLS = new Set\(\["search_flights"\]\)/);
    for (const dead of ["search_hotels", "search_activities", "search_restaurants"]) {
      expect(content, `${file} still references ${dead}`).not.toContain(dead);
    }
  });
});
