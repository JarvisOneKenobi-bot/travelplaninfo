/**
 * Render-layer guarantee that paid affiliate links are marked as such.
 * Article bodies are stored as raw HTML and injected with dangerouslySetInnerHTML;
 * some were hand-linked without rel. Google's paid-link guidance wants
 * rel="sponsored"; noopener/noreferrer match the component-level CJ links.
 */
export const AFFILIATE_REL = "sponsored noopener noreferrer";

const CJ_PUBLISHER_ID = "click-101692716";
const AFFILIATE_HOSTS = [
  "jdoqocy.com",
  "dpbolvw.net",
  "tkqlhce.com",
  "anrdoezrs.net",
  "kqzyfj.com",
  "tqlkg.com",
  "commission-junction.com",
  "cj.com",
];

export function isAffiliateHref(href: string): boolean {
  if (href.includes(CJ_PUBLISHER_ID)) return true;
  const match = /^https?:\/\/([^/?#]+)/i.exec(href.trim());
  if (!match) return false;
  const host = match[1].toLowerCase();
  return AFFILIATE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const ANCHOR_OPEN_TAG = /<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
// (?<![\w-]) keeps data-href / data-rel from matching.
const HREF_ATTR = /(?<![\w-])href\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const REL_ATTR = /(?<![\w-])rel\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

function mergeRel(existing: string | undefined): string {
  const tokens = (existing ?? "").split(/\s+/).filter(Boolean);
  for (const required of AFFILIATE_REL.split(" ")) {
    if (!tokens.includes(required)) tokens.push(required);
  }
  return tokens.join(" ");
}

export function withSponsoredRel(html: string): string {
  return html.replace(ANCHOR_OPEN_TAG, (tag) => {
    const href = HREF_ATTR.exec(tag);
    const hrefValue = href?.[1] ?? href?.[2];
    if (!hrefValue || !isAffiliateHref(hrefValue)) return tag;
    const rel = REL_ATTR.exec(tag);
    if (rel) {
      const q = rel[1] !== undefined ? '"' : "'";
      const current = rel[1] ?? rel[2];
      const merged = mergeRel(current);
      if (merged === current) return tag;
      return tag.replace(REL_ATTR, () => `rel=${q}${merged}${q}`);
    }
    return tag.replace(/\s*\/?>$/, (end) => ` rel="${AFFILIATE_REL}"${end.trimStart()}`);
  });
}
