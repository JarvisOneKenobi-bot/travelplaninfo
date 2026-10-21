/**
 * Trip-result data plumbing, split out of AssistantChat.tsx so the parse rules
 * and the unknown-sentinel contract live in one testable, spy-able module.
 *
 * `extractTripData` feeds BOTH the `hasTripResults` gate that opens the results
 * window and the numbers the window renders. The rule pinned in this module:
 * an unknown price or duration must never be turned into a number that looks
 * like real data — 0 minutes sorts first as the shortest flight and $0 wins
 * the "Best Price" badge, so unknown values carry the PRICE_UNKNOWN /
 * DURATION_UNKNOWN sentinels instead.
 */
import { PRICE_UNKNOWN, DURATION_UNKNOWN, NO_PRICE_LABEL } from "./types";
import type { FlightResult } from "./types";

/**
 * One parsed part of an assistant message: text, or a tool call's parsed JSON
 * `data`. Produced by parseMessageContent in AssistantChat.tsx and kept here,
 * next to `extractTripData` (the module boundary Task 6 spies on).
 */
export interface ToolResult {
  type: "text" | "tool";
  toolName?: string;
  data?: Record<string, unknown>;
  text?: string;
}

/** Parse the numeric part of a price string like "$166 round-trip" (0 when absent). */
export function parsePriceValue(priceStr: string): number {
  const match = priceStr.replace(/,/g, "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

// Unit regexes, case-insensitive, with a (?![a-z]) lookahead so each unit word
// is consumed whole: `PT5H30M`'s compact H/M units and `5 hrs 30 mins`' verbose
// ones both parse, and "mins" can't stop at the bare "m".
const DURATION_HOURS_RE = /(\d+)\s*(?:hours?|hrs?|h)(?![a-z])/i;
const DURATION_MINUTES_RE = /(\d+)\s*(?:minutes?|mins?|m)(?![a-z])/i;

/**
 * Parse a duration string into total minutes, case-insensitively: "5h 30m",
 * "5h", "45m", "PT5H30M" and "5 hrs 30 mins" all work. Returns
 * DURATION_UNKNOWN when nothing parses or the total is <= 0 — a 0 returned
 * here would sort the row first as the "shortest flight".
 */
export function parseDurationMinutes(durationStr: string): number {
  const hMatch = DURATION_HOURS_RE.exec(durationStr);
  const mMatch = DURATION_MINUTES_RE.exec(durationStr);
  const total = (hMatch ? parseInt(hMatch[1]) * 60 : 0) + (mMatch ? parseInt(mMatch[1]) : 0);
  return Number.isFinite(total) && total > 0 ? total : DURATION_UNKNOWN;
}

/**
 * Parse an assistant message into its text and tool-call parts. Moved here
 * from AssistantChat.tsx (Task 6) so the parse rules live beside the
 * extraction contract and both chat lists + the sidebar share one
 * implementation.
 */
export function parseMessageContent(content: string): ToolResult[] {
  const parts: ToolResult[] = [];
  const markerPattern = /\[TOOL:(\w+)\]/g;

  let lastIndex = 0;
  let match;

  while ((match = markerPattern.exec(content)) !== null) {
    // Text before this tool marker
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) parts.push({ type: "text", text });
    }

    const toolName = match[1];
    const jsonStart = match.index + match[0].length;

    // Find matching JSON using brace counting (handles nested objects)
    if (jsonStart < content.length && content[jsonStart] === "{") {
      let depth = 0;
      let jsonEnd = jsonStart;
      for (let i = jsonStart; i < content.length; i++) {
        if (content[i] === "{") depth++;
        else if (content[i] === "}") {
          depth--;
          if (depth === 0) { jsonEnd = i + 1; break; }
        }
      }
      const jsonStr = content.slice(jsonStart, jsonEnd);
      try {
        const data = JSON.parse(jsonStr);
        parts.push({ type: "tool", toolName, data });
      } catch {
        parts.push({ type: "text", text: match[0] + jsonStr });
      }
      lastIndex = jsonEnd;
      markerPattern.lastIndex = jsonEnd;
    } else {
      parts.push({ type: "text", text: match[0] });
      lastIndex = match.index + match[0].length;
    }
  }

  // Remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) parts.push({ type: "text", text });
  }

  return parts.length > 0 ? parts : [{ type: "text", text: content }];
}

/** Get text-only summary from parsed parts (strips tool JSON) */
export function getTextSummary(parts: ToolResult[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join(" ")
    .trim();
}

/** Extract typed arrays from parsed tool results */
export function extractTripData(parts: ToolResult[]): {
  flights: FlightResult[];
} {
  const flights: FlightResult[] = [];

  for (const p of parts) {
    if (p.type !== "tool" || !p.data) continue;

    if (p.toolName === "search_flights" && Array.isArray(p.data.flights)) {
      for (const f of p.data.flights as Record<string, unknown>[]) {
        const priceRaw = typeof f.price === "string" ? f.price.trim() : "";
        const price = priceRaw || NO_PRICE_LABEL;
        const durationRaw = typeof f.duration === "string" ? f.duration.trim() : "";
        // An empty duration is intentional so joinNonEmpty drops it.
        const duration = durationRaw;
        const stops = String(f.stops || "");
        const parsedPrice = typeof f.price_value === "number" ? f.price_value : parsePriceValue(price);
        flights.push({
          airline: String(f.airline || ""),
          route: String(f.route || ""),
          price,
          price_value: parsedPrice > 0 ? parsedPrice : PRICE_UNKNOWN,
          duration,
          // The producer's own duration_minutes is trusted only when it is a
          // real positive number: 0/NaN would look like real data (0 sorts
          // first, NaN sorts unpredictably), so both become the sentinel.
          duration_minutes:
            typeof f.duration_minutes === "number"
              ? Number.isFinite(f.duration_minutes) && f.duration_minutes > 0
                ? f.duration_minutes
                : DURATION_UNKNOWN
              : durationRaw
                ? parseDurationMinutes(durationRaw)
                : DURATION_UNKNOWN,
          stops,
          nonstop: typeof f.nonstop === "boolean" ? f.nonstop : /nonstop/i.test(stops),
          depart_date: f.depart_date ? String(f.depart_date) : undefined,
          return_date: f.return_date ? String(f.return_date) : undefined,
          book_url: String(f.book_url || ""),
        });
      }
    }

  }

  return { flights };
}