import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAffiliateHref, withSponsoredRel } from "./affiliate-rel";

const CJ = "https://www.jdoqocy.com/click-101692716-10790646?sid=travelplaninfo";

describe("isAffiliateHref", () => {
  it("matches CJ tracking domains and the publisher id", () => {
    expect(isAffiliateHref(CJ)).toBe(true);
    expect(isAffiliateHref("https://www.dpbolvw.net/click-101692716-1?sid=x")).toBe(true);
    expect(isAffiliateHref("https://www.tkqlhce.com/click-101692716-1")).toBe(true);
    expect(isAffiliateHref("https://www.anrdoezrs.net/links/101692716/type/dlg/https://example.com")).toBe(true);
    expect(isAffiliateHref("https://example.com/click-101692716-1")).toBe(true);
    expect(isAffiliateHref("https://example.com/page")).toBe(false);
    expect(isAffiliateHref("/images/articles/x/y.png")).toBe(false);
  });
});

describe("withSponsoredRel", () => {
  it("adds the full rel set to an affiliate anchor with no rel", () => {
    const input = `<p>Try <a href="${CJ}">Vrbo</a> today.</p>`;
    expect(withSponsoredRel(input)).toBe(
      `<p>Try <a href="${CJ}" rel="sponsored noopener noreferrer">Vrbo</a> today.</p>`,
    );
  });

  it("merges with an existing rel without duplicating tokens", () => {
    const input = `<a rel="nofollow" href="${CJ}">x</a>`;
    expect(withSponsoredRel(input)).toBe(`<a rel="nofollow sponsored noopener noreferrer" href="${CJ}">x</a>`);
  });

  it("leaves an anchor that already has every token byte-identical", () => {
    const input = `<a href="${CJ}" rel="sponsored noopener noreferrer" target="_blank">x</a>`;
    expect(withSponsoredRel(input)).toBe(input);
  });

  it("leaves non-affiliate anchors untouched", () => {
    const input = `<a href="https://example.com/">x</a> <a href='/guides/'>y</a>`;
    expect(withSponsoredRel(input)).toBe(input);
  });

  it("ignores data-href and data-rel attributes", () => {
    const input = `<a data-href="${CJ}" href="/local/">x</a>`;
    expect(withSponsoredRel(input)).toBe(input);
    const withDataRel = `<a data-rel="x" href="${CJ}">y</a>`;
    expect(withSponsoredRel(withDataRel)).toBe(`<a data-rel="x" href="${CJ}" rel="sponsored noopener noreferrer">y</a>`);
  });

  it("handles single-quoted hrefs", () => {
    const input = `<a href='${CJ}'>x</a>`;
    expect(withSponsoredRel(input)).toBe(`<a href='${CJ}' rel="sponsored noopener noreferrer">x</a>`);
  });

  it("is idempotent", () => {
    const once = withSponsoredRel(`<a href="${CJ}">x</a><a rel="nofollow" href="${CJ}">y</a>`);
    expect(withSponsoredRel(once)).toBe(once);
  });

  it("covers every inline CJ anchor in the live corpus (ratchet)", () => {
    const dir = path.join(process.cwd(), "content", "articles");
    let anchors = 0;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const article = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { content: string };
      const rendered = withSponsoredRel(article.content);
      for (const tag of rendered.match(/<a\b[^>]*click-101692716[^>]*>/gi) ?? []) {
        anchors += 1;
        expect(tag).toMatch(/(?<![\w-])rel=["'][^"']*\bsponsored\b/);
        expect(tag).toMatch(/\bnoopener\b/);
        expect(tag).toMatch(/\bnoreferrer\b/);
      }
    }
    expect(anchors).toBeGreaterThanOrEqual(20); // 20 inline CJ anchors on 2026-09-06 (none carried rel); only grows
  });

  it("does not corrupt a tag whose quoted attribute contains '>'", () => {
    const input = `<a href="${CJ}" title="a > b">x</a>`;
    expect(withSponsoredRel(input)).toBe(`<a href="${CJ}" title="a > b" rel="sponsored noopener noreferrer">x</a>`);
  });

  it("keeps the existing quote style when merging rel and stays idempotent", () => {
    const input = `<a rel='nofollow' href="${CJ}">x</a>`;
    const once = withSponsoredRel(input);
    expect(once).toBe(`<a rel='nofollow sponsored noopener noreferrer' href="${CJ}">x</a>`);
    expect(withSponsoredRel(once)).toBe(once);
  });

  it("treats rel='' as empty and fills it", () => {
    expect(withSponsoredRel(`<a rel="" href="${CJ}">x</a>`)).toBe(`<a rel="sponsored noopener noreferrer" href="${CJ}">x</a>`);
  });

  it("handles a rel value containing the other quote character without duplicating rel", () => {
    const doubleQuoted = `<a rel="foo'bar" href="${CJ}">x</a>`;
    expect(withSponsoredRel(doubleQuoted)).toBe(`<a rel="foo'bar sponsored noopener noreferrer" href="${CJ}">x</a>`);
    const singleQuoted = `<a rel='foo"bar' href="${CJ}">x</a>`;
    expect(withSponsoredRel(singleQuoted)).toBe(`<a rel='foo"bar sponsored noopener noreferrer' href="${CJ}">x</a>`);
    for (const input of [doubleQuoted, singleQuoted]) {
      expect((withSponsoredRel(input).match(/rel\s*=/g) ?? []).length).toBe(1);
    }
  });

  it("no corpus anchor relies on behaviour the tokenizer does not model (precondition ratchet)", () => {
    const dir = path.join(process.cwd(), "content", "articles");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    let naiveStarts = 0;
    let recognised = 0;
    for (const file of files) {
      const { content } = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { content: string };
      naiveStarts += (content.match(/<a\b/gi) ?? []).length;
      for (const tag of content.match(/<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
        recognised += 1;
        expect(tag).toMatch(/(?<![\w-])href\s*=\s*["']/); // no unquoted href
      }
    }
    // Non-vacuous: there IS a population to police.
    expect(naiveStarts).toBeGreaterThan(0);
    // Independent of the tokenizer's own acceptance set: every `<a` start the corpus contains must
    // be an opening tag the tokenizer actually models. A malformed or unsupported anchor would
    // otherwise vanish from the test population instead of failing it.
    expect(recognised).toBe(naiveStarts);
  });
});
