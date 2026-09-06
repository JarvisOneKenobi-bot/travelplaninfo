import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "../i18n/routing";
import { buildSlugRedirects, PREFIXED_LOCALES, resolveImageRedirect, SLUG_RENAMES } from "./slug-redirects";

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
    expect(redirects.length).toBe(192);

    const expected = Object.entries(SLUG_RENAMES).flatMap(([oldSlug, newSlug]) => [
      `/${oldSlug}/ -> /${newSlug}/`,
      ...PREFIXED_LOCALES.map((locale) => `/${locale}/${oldSlug}/ -> /${locale}/${newSlug}/`),
      `/images/articles/${oldSlug}/${oldSlug}-:tail -> /images/articles/${newSlug}/${newSlug}-:tail`,
      `/images/articles/${oldSlug}/:path* -> /images/articles/${newSlug}/:path*`,
    ]);
    const actual = redirects.map(({ source, destination }) => `${source} -> ${destination}`);

    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it("emits the slug-prefix rule before the directory catch-all for every rename", () => {
    const sources = buildSlugRedirects().map(({ source }) => source);
    for (const oldSlug of Object.keys(SLUG_RENAMES)) {
      const prefix = sources.indexOf(`/images/articles/${oldSlug}/${oldSlug}-:tail`);
      const dir = sources.indexOf(`/images/articles/${oldSlug}/:path*`);
      expect(prefix).toBeGreaterThanOrEqual(0);
      expect(dir).toBeGreaterThan(prefix);
    }
  });

  it("points every image redirect at an existing evergreen image directory and hero file", () => {
    for (const newSlug of Object.values(SLUG_RENAMES)) {
      const dir = path.join(process.cwd(), "public", "images", "articles", newSlug);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.existsSync(path.join(dir, `${newSlug}-hero.png`))).toBe(true);
    }
  });

  it("resolves the old URL of every image file on disk to an existing file (ratchet)", () => {
    let checked = 0;
    for (const [oldSlug, newSlug] of Object.entries(SLUG_RENAMES)) {
      const dir = path.join(process.cwd(), "public", "images", "articles", newSlug);
      for (const file of fs.readdirSync(dir)) {
        const oldFile = file.startsWith(`${newSlug}-`) ? `${oldSlug}-${file.slice(newSlug.length + 1)}` : file;
        const resolved = resolveImageRedirect(`/images/articles/${oldSlug}/${oldFile}`);
        expect(resolved).toBe(`/images/articles/${newSlug}/${file}`);
        expect(fs.existsSync(path.join(process.cwd(), "public", resolved!))).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(149); // 24 heroes + 125 renamed bodies on 2026-09-06; only grows
  });

  it("uses permanent redirects with de-yeared destination slugs", () => {
    for (const redirect of buildSlugRedirects()) {
      expect(redirect.permanent).toBe(true);
      expect(redirect.source.startsWith("/")).toBe(true);
      expect(redirect.destination.startsWith("/")).toBe(true);
      const isImage = redirect.source.startsWith("/images/articles/");
      if (!isImage) {
        expect(redirect.source.endsWith("/")).toBe(true);
        expect(redirect.destination.endsWith("/")).toBe(true);
      }
      const segments = redirect.destination.split("/").filter(Boolean);
      const slugSegment = isImage ? segments[2] : segments[segments.length - 1];
      expect(slugSegment).not.toMatch(/-20\d\d$/);
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
