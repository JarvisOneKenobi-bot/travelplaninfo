/**
 * Data-path guard for the Atlas results window.
 *
 * `extractTripData` feeds BOTH the `hasTripResults` gate that opens the results
 * window and the numbers the window renders. The producer
 * (`travelpayouts-client.ts`) emits `price: "—"` (NO_PRICE_LABEL) whenever the
 * upstream price is null or <= 0, and `duration: ""` unconditionally — so the
 * "unknown" paths here are the normal case, not an edge case.
 *
 * The rule this file pins: an unknown price or duration must never be turned
 * into a number that looks like real data. $0 sorts first and wins the
 * "Best Price" badge; 0 minutes sorts first as the shortest flight.
 */
import { describe, expect, it } from "vitest";
import { extractTripData } from "./AssistantChat";
import { PRICE_UNKNOWN, DURATION_UNKNOWN } from "./atlas/types";

function flightPart(flights: unknown[]) {
  return [{ type: "tool" as const, toolName: "search_flights", data: { flights } }];
}

describe("extractTripData — flight results", () => {
  it("parses a priced flight into a sortable numeric price", () => {
    const { flights } = extractTripData(
      flightPart([{ airline: "Delta", route: "MIA → JFK", price: "$166 round-trip", stops: "Nonstop", book_url: "u" }])
    );

    expect(flights).toHaveLength(1);
    expect(flights[0].price).toBe("$166 round-trip");
    expect(flights[0].price_value).toBe(166);
  });

  it("never turns an unknown price into $0", () => {
    const { flights } = extractTripData(
      flightPart([{ airline: "Delta", route: "MIA → JFK", price: "—", stops: "", book_url: "u" }])
    );

    expect(flights[0].price).toBe("—");
    expect(flights[0].price_value).not.toBe(0);
    expect(flights[0].price_value).toBe(PRICE_UNKNOWN);
  });

  it("never invents a price when the field is missing entirely", () => {
    const { flights } = extractTripData(flightPart([{ airline: "Delta", route: "MIA → JFK", book_url: "u" }]));

    expect(flights[0].price).not.toBe("$0");
    expect(flights[0].price_value).toBe(PRICE_UNKNOWN);
  });

  it("sorts an unpriced flight after every priced one", () => {
    const { flights } = extractTripData(
      flightPart([
        { airline: "A", route: "r", price: "—", book_url: "u" },
        { airline: "B", route: "r", price: "$900", book_url: "u" },
        { airline: "C", route: "r", price: "$100", book_url: "u" },
      ])
    );
    const byPrice = [...flights].sort((a, b) => a.price_value - b.price_value);

    expect(byPrice.map((f) => f.airline)).toEqual(["C", "B", "A"]);
    // the cheapest REAL price, not the unpriced row
    const priced = flights.filter((f) => f.price_value < PRICE_UNKNOWN);
    expect(Math.min(...priced.map((f) => f.price_value))).toBe(100);
  });

  it("never invents a duration and sorts an unknown duration last", () => {
    // the live producer sends duration: "" for every flight
    const { flights } = extractTripData(
      flightPart([
        { airline: "A", route: "r", price: "$100", duration: "", book_url: "u" },
        { airline: "B", route: "r", price: "$200", duration: "3h 15m", book_url: "u" },
      ])
    );

    expect(flights[0].duration).toBe("duration unavailable");
    expect(flights[0].duration).not.toBe("0h 0m");
    expect(flights[0].duration_minutes).toBe(DURATION_UNKNOWN);
    expect(flights[1].duration_minutes).toBe(195);
    expect(flights[1].duration_minutes).toBeLessThan(flights[0].duration_minutes);
  });

  it("returns no flights for a no_data response, so the results window stays shut", () => {
    const { flights } = extractTripData([
      { type: "tool", toolName: "search_flights", data: { flights: [], no_data: true } },
    ]);

    expect(flights).toEqual([]);
  });

  it("returns no flights for a contained tool error", () => {
    const { flights } = extractTripData([
      { type: "tool", toolName: "search_flights", data: { is_error: true, error: "upstream 503" } },
    ]);

    expect(flights).toEqual([]);
  });

  it("ignores results from tools that are not in the live registry", () => {
    const { flights } = extractTripData([
      { type: "text", text: "here you go" },
      { type: "tool", toolName: "get_deals", data: { deals: [{ price: "$99" }] } },
    ]);

    expect(flights).toEqual([]);
  });
});
