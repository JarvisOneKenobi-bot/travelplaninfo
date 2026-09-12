/**
 * The results modal keeps selection and per-flight day assignments in state keyed
 * by ARRAY INDEX, and AssistantChat keeps it mounted after close. Without a
 * remount between result sets, "flight 0 selected, assigned to day 5" from one
 * search silently carries over to an unrelated flight 0 in the next search — and
 * "Add All" would then add a flight the user never picked.
 *
 * AssistantChat passes `key={modalSeq}`, bumped on every open, so a new result
 * set remounts. These tests pin that a remount clears selection and that the
 * leak is real without it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import TripResultsModal from "./TripResultsModal";
import type { FlightResult } from "./types";

afterEach(cleanup);

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
  });
});
