import { describe, expect, it } from "vitest";
import { renderMarkdownLite } from "./markdown-lite";

describe("renderMarkdownLite — relative URLs", () => {
  it("linkifies same-origin relative paths like /guides/foo", () => {
    const html = renderMarkdownLite("See [guides](/guides/foo).");

    expect(html).toContain('<a href="/guides/foo"');
    expect(html).toContain(">guides</a>");
  });

  it("does NOT linkify protocol-relative //host URLs (stays literal text)", () => {
    const html = renderMarkdownLite("See [x](//evil.example/a).");

    // The injection attempt must survive as plain, inert text — never an <a>
    expect(html).not.toContain("<a href=");
    expect(html).toContain("[x](//evil.example/a)");
  });

  it("still linkifies http(s) URLs as before", () => {
    const html = renderMarkdownLite("See [site](https://example.test/p).");

    expect(html).toContain('<a href="https://example.test/p"');
    expect(html).toContain(">site</a>");
  });
});