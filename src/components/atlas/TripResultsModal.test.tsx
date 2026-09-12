/**
 * The results modal keeps selection and per-flight day assignments in state keyed
 * by ARRAY INDEX, and AssistantChat keeps it mounted after close. Without a
 * remount between result sets, "flight 0 selected" from one search silently
 * carries over to an unrelated flight 0 in the next search — and "Add Selected"
 * would then add a flight the user never picked.
 *
 * What these tests actually prove, in order:
 *  1. a fresh mount starts with nothing selected;
 *  2. selection is tracked within one result set;
 *  3. NEGATIVE CONTROL — rerendering with a SECOND flight set under the SAME key
 *     leaves the stale selection in place. This is the bug, reproduced; without
 *     it test 4 would pass on any component that simply cannot hold state.
 *  4. rerendering under a CHANGED key clears it.
 *
 * Test 4 only proves React's remount semantics. That AssistantChat actually
 * supplies a changing key is pinned separately, by the `key={modalSeq}` /
 * two-`setModalSeq(`-call-sites assertion in src/lib/atlas/no-fabrication.test.ts.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import TripResultsModal from "./TripResultsModal";
import { NO_PRICE_LABEL, PRICE_UNKNOWN, type FlightResult } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // restoreAllMocks does NOT undo vi.stubGlobal, and vitest.config.ts does not
  // set unstubGlobals — without this the canned fetch below leaks into any later
  // test in this file.
  vi.unstubAllGlobals();
});

function flight(airline: string, priceValue: number): FlightResult {
  return {
    airline,
    route: "MIA → JFK",
    price: `$${priceValue}`,
    price_value: priceValue,
    duration: "",
    duration_minutes: 120,
    stops: "Nonstop",
    nonstop: true,
    book_url: "https://example.test/book",
  };
}

function unpricedFlight(): FlightResult {
  return {
    ...flight("Carrier X", 0),
    price: NO_PRICE_LABEL,
    price_value: PRICE_UNKNOWN,
  };
}

function renderModal(flights: FlightResult[], seq: number) {
  return render(
    <TripResultsModal
      key={seq}
      isOpen
      onClose={() => {}}
      destination="Miami"
      dates={{ start: "2026-10-01", end: "2026-10-05" }}
      adults={1}
      flights={flights}
      tripId={1}
    />
  );
}

const firstSet = [flight("Delta", 100), flight("United", 200)];
const secondSet = [flight("Carrier C", 300), flight("Carrier D", 400)];

describe("TripResultsModal selection does not leak between result sets", () => {
  it("starts with nothing selected", () => {
    renderModal(firstSet, 0);

    expect(screen.getByRole("button", { name: /Add All to Itinerary/i })).toBeTruthy();
  });

  it("tracks a selection within one result set", () => {
    renderModal(firstSet, 0);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(screen.getByRole("button", { name: /Add Selected \(1\) to Itinerary/i })).toBeTruthy();
  });

  // NEGATIVE CONTROL: this is the leak the key is there to prevent. If this test
  // ever starts passing "clean", the remount test below has stopped proving
  // anything and the modal is holding no state at all.
  it("LEAKS a stale selection into a new result set when the key does NOT change", () => {
    const { rerender } = renderModal(firstSet, 0);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByRole("button", { name: /Add Selected \(1\) to Itinerary/i })).toBeTruthy();

    rerender(
      <TripResultsModal
        key={0}
        isOpen
        onClose={() => {}}
        destination="Miami"
        dates={{ start: "2026-10-01", end: "2026-10-05" }}
        adults={1}
        flights={secondSet}
        tripId={1}
      />
    );

    // unrelated flight 0 of the SECOND set is still ticked
    expect(screen.getByRole("button", { name: /Add Selected \(1\) to Itinerary/i })).toBeTruthy();
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
  });

  it("a new result set (new key) starts with nothing selected", () => {
    const { rerender } = renderModal(firstSet, 0);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByRole("button", { name: /Add Selected \(1\) to Itinerary/i })).toBeTruthy();

    // same element position, different result set — the key change must remount
    rerender(
      <TripResultsModal
        key={1}
        isOpen
        onClose={() => {}}
        destination="Miami"
        dates={{ start: "2026-10-01", end: "2026-10-05" }}
        adults={1}
        flights={secondSet}
        tripId={1}
      />
    );

    expect(screen.queryByRole("button", { name: /Add Selected/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Add All to Itinerary/i })).toBeTruthy();
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(false);
  });
});

describe("an unpriced flight never persists a placeholder into the itinerary", () => {
  it("omits the no-price label from the trip_items description", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{}] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderModal([unpricedFlight()], 0);
    fireEvent.click(screen.getByRole("button", { name: /Add All to Itinerary/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const description: string = body.items[0].description;

    // "—" is an honest DISPLAY label for a missing price; writing it into the
    // itinerary row's description just persists a dash forever.
    expect(description).not.toContain(NO_PRICE_LABEL);
    expect(description).toBe("Nonstop");
  });
});
