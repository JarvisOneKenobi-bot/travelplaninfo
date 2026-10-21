/**
 * Shared content-keyed cache for per-message trip data (Task 6).
 *
 * An assistant message's flights were re-extracted on every render, by every
 * consumer: both chat lists AND the sidebar each ran
 * extractTripData(parseMessageContent(content)) again and again, per keystroke
 * of the streaming text. getTripFlights runs that extraction ONCE per distinct
 * message content and hands the same array to everyone — which is also why
 * vi.mock("./trip-data") in the counting tests observes exactly one extraction
 * per content.
 *
 * Module-level Map keyed by message content. Streaming grows one entry
 * monotonically until the message completes, so the bound only matters across
 * many distinct messages; 200 entries is far above any single session's
 * message count, and oldest-first eviction caps the worst case (revisit long
 * histories loaded via /api/assistant/history).
 */
import { extractTripData, parseMessageContent } from "./trip-data";
import type { FlightResult } from "./types";

const MAX_CACHE_ENTRIES = 200;
const cache = new Map<string, FlightResult[]>();

export function getTripFlights(content: string): FlightResult[] {
  const cached = cache.get(content);
  if (cached) return cached;

  const flights = extractTripData(parseMessageContent(content)).flights;
  cache.set(content, flights);

  if (cache.size > MAX_CACHE_ENTRIES) {
    // Map iteration order is insertion order: the first key is the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  return flights;
}

export function resetTripFlightsCache(): void {
  cache.clear();
}