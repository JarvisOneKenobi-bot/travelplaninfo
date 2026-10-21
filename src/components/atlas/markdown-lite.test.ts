import { describe, expect, it } from "vitest";
import { renderMarkdownLite } from "./markdown-lite";

// Every anchor the renderer produces must resolve back to the TPI origin when
// the browser resolves the href against the site root — this catches hrefs
// that only LOOK same-origin (e.g. "/\\host", "/<TAB>/host").
function assertAllLinksResolveToTpiOrigin(html: string): string[] {
  const hrefs = [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    const resolved = new URL(href, "https://travelplaninfo.com/");
    expect(resolved.origin).toBe("https://travelplaninfo.com");
  }
  return hrefs;
}

describe("renderMarkdownLite — relative URLs", () => {
  it("linkifies same-origin relative paths like /guides/foo", () => {
    const html = renderMarkdownLite("See [guides](/guides/foo).");

    expect(html).toContain('<a href="/guides/foo"');
    expect(html).toContain(">guides</a>");
    assertAllLinksResolveToTpiOrigin(html);
  });

  it("does NOT linkify protocol-relative //host URLs (stays literal text)", () => {
    const html = renderMarkdownLite("See [x](//evil.example/a).");

    // The injection attempt must survive as plain, inert text — never an <a>
    expect(html).not.toContain("<a href=");
    expect(html).toContain("[x](//evil.example/a)");
    assertAllLinksResolveToTpiOrigin(html);
  });

  it("still linkifies http(s) URLs as before", () => {
    const html = renderMarkdownLite("See [site](https://example.test/p).");

    expect(html).toContain('<a href="https://example.test/p"');
    expect(html).toContain(">site</a>");
    // Off-site origin is fine for absolute links — no TPI-origin assertion here.
  });

  it("linkifies every valid same-origin relative form (task 8b allow-list)", () => {
    const valid: [string, string][] = [
      ["/guides/foo", "See [guides](/guides/foo)."],
      ["/guides/foo?x=1#y", "See [deep](/guides/foo?x=1#y)."],
      ["/?x=1", "See [query](/?x=1)."],
      ["/#y", "See [top](/#y)."],
      ["/a/b-c_d.html", "See [page](/a/b-c_d.html)."],
    ];

    for (const [href, input] of valid) {
      const html = renderMarkdownLite(input);

      expect(html).toContain(`<a href="${href}"`);
      assertAllLinksResolveToTpiOrigin(html);
    }
  });

  // Task 8b fix-up: browsers normalize "/\" to "//" and strip tab/newline/CR
  // before URL parsing, so same-origin-looking hrefs could resolve OFF-SITE.
  // None of these bypass inputs may produce an <a> at all (real tab/newline).
  it.each([
    {
      name: "/\\host (browsers normalize /\\ to //)",
      input: "[x](/\\evil.example)",
    },
    {
      name: "real tab inside the href",
      input: "[x](/\t/evil.example)",
    },
    {
      name: "real newline inside the href",
      input: "[x](/\n/evil.example)",
    },
    {
      name: "space inside the path (/a b)",
      input: "[x](/a b)",
    },
    {
      name: "backslash inside the path (/ok\\path)",
      input: "[x](/ok\\path)",
    },
    {
      name: "protocol-relative //host/a",
      input: "[x](//evil.example/a)",
    },
  ])("does NOT linkify $name — no anchor produced", ({ input }) => {
    const html = renderMarkdownLite(input);

    // The bypass attempt must produce NO anchor at all — it stays inert text.
    expect(html).not.toContain("<a href=");
    // No href is produced for bypasses, so this is vacuous here — but it
    // guards against any anchor that DOES appear resolving off-site.
    assertAllLinksResolveToTpiOrigin(html);
  });
});