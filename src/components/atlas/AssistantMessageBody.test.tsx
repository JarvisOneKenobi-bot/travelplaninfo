// @vitest-environment jsdom
/**
 * AssistantMessageBody tests (Task 6).
 *
 * The behavior restored here is intentional and pinned:
 *  - a message with flight results shows its text summary AND all of its
 *    FlightCards inline (what the old single-tool path on main showed);
 *  - the branch's "Add to itinerary" button is ADDITIVE and only appears once
 *    streaming is complete;
 *  - trip data is extracted ONCE per message content (shared cache), no matter
 *    how many consumers (message lists, sidebar) or re-renders hit it.
 *
 * FlightCard reads useTranslations("atlas") — next-intl is mocked to a key
 * passthrough, which is enough for rendering assertions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PRICE_UNKNOWN, DURATION_UNKNOWN, NO_PRICE_LABEL } from "./types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./trip-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./trip-data")>();
  return { ...actual, extractTripData: vi.fn(actual.extractTripData) };
});

import { extractTripData } from "./trip-data";
import { getTripFlights, resetTripFlightsCache } from "./trip-flights-cache";
import AssistantMessageBody from "./AssistantMessageBody";
import type { FlightResult } from "./types";

/** Raw producer-shaped flight JSON as it appears inside message content. */
function rawFlight(airline: string, price: string, extra: Record<string, unknown> = {}) {
  return {
    airline,
    route: "MIA → JFK",
    price,
    duration: "2h",
    stops: "Nonstop",
    book_url: "https://example.test/book",
    ...extra,
  };
}

function flightsJson(flights: unknown[]) {
  return `[TOOL:search_flights]${JSON.stringify({ flights })}`;
}

const FIVE_FLIGHTS = [
  rawFlight("AirAlpha", "$110"),
  rawFlight("AirBeta", "$210"),
  rawFlight("AirGamma", "$310"),
  rawFlight("AirDelta", "$410"),
  rawFlight("AirEpsilon", "$510"),
];

const onOpenResults = vi.fn();

describe("AssistantMessageBody — inline flight cards (restored main behavior)", () => {
  afterEach(cleanup);

  it("renders every FlightCard inline for a single search_flights result", () => {
    const content = `Found 5 options for you!\n${flightsJson(FIVE_FLIGHTS)}`;

    render(<AssistantMessageBody content={content} isStreaming={false} onOpenResults={onOpenResults} />);

    // ALL flight cards, inline — not a "View results" button only
    expect(screen.getAllByTestId("flight-card")).toHaveLength(5);
    // The text summary is still shown next to the cards
    expect(screen.getByText(/Found 5 options/)).toBeTruthy();
    // Add to itinerary appears because streaming is complete (additive branch behavior)
    expect(screen.getByRole("button", { name: /Add to itinerary/i })).toBeTruthy();
  });

  it("shows Add to itinerary only after streaming", () => {
    const content = `Some options\n${flightsJson(FIVE_FLIGHTS)}`;

    const { rerender } = render(
      <AssistantMessageBody content={content} isStreaming onOpenResults={onOpenResults} />
    );

    // While streaming: cards are already visible, but no modal entry point
    expect(screen.getAllByTestId("flight-card")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /Add to itinerary/i })).toBeNull();

    rerender(<AssistantMessageBody content={content} isStreaming={false} onOpenResults={onOpenResults} />);

    const button = screen.getByRole("button", { name: /Add to itinerary/i });
    fireEvent.click(button);

    expect(onOpenResults).toHaveBeenCalledTimes(1);
    const flightsArg: FlightResult[] = onOpenResults.mock.calls[0][0];
    expect(flightsArg).toHaveLength(5);
    expect(flightsArg[0]!.price_value).toBe(110);
  });

  it("extracts trip data once per content", () => {
    resetTripFlightsCache();
    (extractTripData as unknown as ReturnType<typeof vi.fn>).mockClear();

    const contentA = `Options A\n${flightsJson(FIVE_FLIGHTS)}`;
    const contentB = `Options B\n${flightsJson([rawFlight("AirZeta", "$120")])}`;
    const shared = { isStreaming: false, onOpenResults };

    const { rerender } = render(
      <>
        <AssistantMessageBody {...shared} content={contentA} />
        <AssistantMessageBody {...shared} content={contentA} />
      </>
    );

    // A second consumer reading the same content (like the sidebar does)
    expect(getTripFlights(contentA)).toHaveLength(5);

    // 1 extraction for content A across body + sidebar consumers
    expect(extractTripData).toHaveBeenCalledTimes(1);

    // Unrelated parent state change re-renders both bodies — cache serves them
    rerender(
      <>
        <span data-testid="unrelated-parent-state">tick 2</span>
        <AssistantMessageBody {...shared} content={contentA} />
        <AssistantMessageBody {...shared} content={contentA} />
      </>
    );
    expect(extractTripData).toHaveBeenCalledTimes(1);

    // Distinct content B: exactly one more extraction
    getTripFlights(contentB);
    render(<AssistantMessageBody content={contentB} isStreaming={false} onOpenResults={onOpenResults} />);
    expect(extractTripData).toHaveBeenCalledTimes(2);
  });

  it("renders mixed tool results: flight cards + other tool cards in one message", () => {
    const content = [
      "Here is what I found.",
      flightsJson([rawFlight("AirAlpha", "$110"), rawFlight("AirBeta", "$210")]),
      `[TOOL:get_deals]${JSON.stringify({
        deals: [
          {
            date: "2026-11-08",
            destination: "Santo Domingo",
            price: "$199",
            savings_pct: 31,
            search_url: "https://example.test/deal",
          },
        ],
      })}`,
      "Want me to refine the dates?",
    ].join("\n");

    render(<AssistantMessageBody content={content} isStreaming={false} onOpenResults={onOpenResults} />);

    // Flights stay inline cards; the non-trip tool still renders its own card
    expect(screen.getAllByTestId("flight-card")).toHaveLength(2);
    expect(screen.getByText("Santo Domingo")).toBeTruthy();
    // Both text segments feed the summary
    expect(screen.getByText(/Here is what I found\./)).toBeTruthy();
    expect(screen.getByText(/Want me to refine/)).toBeTruthy();
  });

  it("renders no cards and no button for an empty or errored search result", () => {
    const emptyContent = `I could not find flights in your dates.\n[TOOL:search_flights]${JSON.stringify({
      flights: [],
      no_data: true,
    })}`;

    const { unmount } = render(
      <AssistantMessageBody content={emptyContent} isStreaming={false} onOpenResults={onOpenResults} />
    );

    expect(screen.queryAllByTestId("flight-card")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Add to itinerary/i })).toBeNull();
    expect(screen.getByText(/could not find flights/)).toBeTruthy();
    // A contained failure must not leak raw tool JSON into the message
    expect(screen.queryByText(/no_data/)).toBeNull();
    expect(screen.queryByText(/is_error/)).toBeNull();
    unmount();

    cleanup();

    const errorContent = `Atlas hit an upstream error looking for flights.\n[TOOL:search_flights]${JSON.stringify(
      { is_error: true, error: "upstream 503" }
    )}`;
    render(<AssistantMessageBody content={errorContent} isStreaming={false} onOpenResults={onOpenResults} />);

    expect(screen.queryAllByTestId("flight-card")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Add to itinerary/i })).toBeNull();
    expect(screen.getByText(/upstream error/)).toBeTruthy();
    expect(screen.queryByText(/is_error/)).toBeNull();
  });

  it("renders a sparse unpriced flight with every unknown field left blank", () => {
    const content = `These prices are still pending.\n${flightsJson([
      rawFlight("Carrier X", NO_PRICE_LABEL, { duration: "", stops: "" }),
    ])}`;

    render(<AssistantMessageBody content={content} isStreaming={false} onOpenResults={onOpenResults} />);

    const cards = screen.getAllByTestId("flight-card");
    expect(cards).toHaveLength(1);
    // The honest no-price label, not a fabricated $0
    expect(screen.getByText(NO_PRICE_LABEL)).toBeTruthy();
    // Route survives; nothing else is fabricated into the meta line
    expect(screen.getByText(/MIA/)).toBeTruthy();
    // Unknown sentinels stay behind the scenes, never rendered as 0
    const flights = getTripFlights(content);
    expect(flights[0]!.price_value).toBe(PRICE_UNKNOWN);
    expect(flights[0]!.duration_minutes).toBe(DURATION_UNKNOWN);
  });
});