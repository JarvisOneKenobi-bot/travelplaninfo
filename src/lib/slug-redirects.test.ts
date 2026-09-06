import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "../i18n/routing";
import { buildSlugRedirects, PREFIXED_LOCALES, SLUG_RENAMES } from "./slug-redirects";

describe("slug redirects", () => {
  it("contains the complete 24-article evergreen rename map", () => {
    expect(Object.keys(SLUG_RENAMES).length).toBe(24);
  });

  it("derives PREFIXED_LOCALES from routing (no hand copy)", () => {
    const expected = routing.locales.filter((l) => l !== routing.defaultLocale);
    expect([...PREFIXED_LOCALES]).toEqual(expected);
    expect(PREFIXED_LOCALES).not.toContain(routing.defaultLocale);
    expect(PREFIXED_LOCALES.length).toBe(routing.locales.length - 1);
  });

  it("maps each old slug to itself with only the trailing year stripped", () => {
    for (const [oldSlug, newSlug] of Object.entries(SLUG_RENAMES)) {
      expect(newSlug).toBe(oldSlug.replace(/-20\d\d$/, ""));
    }
  });

  it("builds the exact bare plus localized redirect set", () => {
    const redirects = buildSlugRedirects();
    expect(redirects.length).toBe(144);

    const expected = Object.entries(SLUG_RENAMES).flatMap(([oldSlug, newSlug]) => [
      `/${oldSlug}/ -> /${newSlug}/`,
      ...PREFIXED_LOCALES.map((locale) => `/${locale}/${oldSlug}/ -> /${locale}/${newSlug}/`),
    ]);
    const actual = redirects.map(({ source, destination }) => `${source} -> ${destination}`);

    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it("uses trailing-slash permanent redirects with de-yeared destinations", () => {
    for (const redirect of buildSlugRedirects()) {
      expect(redirect.source.startsWith("/")).toBe(true);
      expect(redirect.source.endsWith("/")).toBe(true);
      expect(redirect.destination.startsWith("/")).toBe(true);
      expect(redirect.destination.endsWith("/")).toBe(true);
      expect(redirect.permanent).toBe(true);

      const destinationSegments = redirect.destination.split("/").filter(Boolean);
      expect(destinationSegments[destinationSegments.length - 1]).not.toMatch(/-20\d\d$/);
    }
  });

  it("maps only year-suffixed old slugs to evergreen new slugs", () => {
    for (const [oldSlug, newSlug] of Object.entries(SLUG_RENAMES)) {
      expect(oldSlug).toMatch(/-20\d\d$/);
      expect(newSlug).not.toMatch(/-20\d\d$/);
    }
  });

  it("does not duplicate redirect sources", () => {
    const sources = buildSlugRedirects().map(({ source }) => source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("points every destination at an existing evergreen article", () => {
    for (const newSlug of Object.values(SLUG_RENAMES)) {
      expect(fs.existsSync(path.join(process.cwd(), "content", "articles", `${newSlug}.json`))).toBe(true);
    }
  });
});
