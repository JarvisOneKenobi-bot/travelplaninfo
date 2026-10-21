/**
 * Unit contract for the shared trip-flights cache (Task 6):
 * one extraction per distinct message content, the SAME array handed to every
 * consumer (both chat lists + the sidebar), bounded at 200 entries with
 * oldest-first eviction.
 *
 * vi.mock("./trip-data") wraps the real extractTripData so the spy counts real
 * extractions — exactly what the AssistantMessageBody counting test observes
 * through the same module boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./trip-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./trip-data")>();
  return { ...actual, extractTripData: vi.fn(actual.extractTripData) };
});

import { extractTripData } from "./trip-data";
import { getTripFlights, resetTripFlightsCache } from "./trip-flights-cache";

/** Raw producer-shaped flight JSON as it appears inside message content. */
function rawFlight(airline: string, price: string) {
  return {
    airline,
    route: "MIA → JFK",
    price,
    duration: "2h",
    stops: "Nonstop",
    book_url: "https://example.test/book",
  };
}

function messageContent(flights: unknown[], stamp: string) {
  return `Options for you (${stamp}):
[TOOL:search_flights]${JSON.stringify({ flights })}`;
}

const mockedExtract = extractTripData as unknown as ReturnType<typeof vi.fn>;

describe("getTripFlights", () => {
  beforeEach(() => {
    resetTripFlightsCache();
    mockedExtract.mockClear();
  });

  afterEach(() => {
    resetTripFlightsCache();
  });

  it("extracts flights from a single search_flights result", () => {
    const content = messageContent([rawFlight("Delta", "$166")], "one");

    expect(getTripFlights(content)).toHaveLength(1);
    expect(getTripFlights(content)[0]!.price_value).toBe(166);
  });

  it("returns the SAME array to repeat calls for the same content", () => {
    const content = messageContent([rawFlight("Delta", "$166")], "two");

    const first = getTripFlights(content);
    const second = getTripFlights(content);

    expect(second).toBe(first);
    expect(mockedExtract).toHaveBeenCalledTimes(1);
  });

  it("re-extracts after resetTripFlightsCache", () => {
    const content = messageContent([rawFlight("Delta", "$166")], "three");

    getTripFlights(content);
    expect(mockedExtract).toHaveBeenCalledTimes(1);

    resetTripFlightsCache();
    getTripFlights(content);
    expect(mockedExtract).toHaveBeenCalledTimes(2);
  });

  it("stays bounded at 200 entries, evicting the oldest", () => {
    for (let i = 1; i <= 200; i++) {
      getTripFlights(messageContent([rawFlight(`Air${i}`, `$${i + 100}`)], `fill-${i}`));
    }
    expect(mockedExtract).toHaveBeenCalledTimes(200);

    // Entry 201 pushes size to 201 → the oldest (fill-1) is evicted, the map
    // stays at 200, and REPEATING the most recent entry must still be a hit.
    getTripFlights(messageContent([rawFlight("Air201", "$301")], "fill-201"));
    expect(mockedExtract).toHaveBeenCalledTimes(201);

    const before = mockedExtract.mock.calls.length;
    getTripFlights(messageContent([rawFlight("Air201", "$301")], "fill-201"));
    expect(mockedExtract.mock.calls.length).toBe(before);

    // fill-2 is still cached (only fill-1 was evicted)
    getTripFlights(messageContent([rawFlight("Air2", "$102")], "fill-2"));
    expect(mockedExtract.mock.calls.length).toBe(before);

    // fill-1 was evicted → re-requesting it extracts again
    getTripFlights(messageContent([rawFlight("Air1", "$101")], "fill-1"));
    expect(mockedExtract.mock.calls.length).toBe(before + 1);
  });
});