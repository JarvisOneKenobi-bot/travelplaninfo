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
import { DURATION_UNKNOWN, NO_PRICE_LABEL, PRICE_UNKNOWN, type FlightResult } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // restoreAllMocks does NOT undo vi.stubGlobal, and vitest.config.ts does not
  // set unstubGlobals — without this the canned fetch below leaks into any later
  // test in this file.
  vi.unstubAllGlobals();
  // Same leak class for the fake rAF timers installed by the focus tests.
  vi.useRealTimers();
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

function unknownDurationFlight(airline: string, priceValue: number): FlightResult {
  return { ...flight(airline, priceValue), duration: "", duration_minutes: DURATION_UNKNOWN };
}

/**
 * DOM-order assertion: each airline text node must precede the next one in the
 * document — how the flight rows are physically stacked after a sort click.
 */
function expectDomOrder(...airlines: string[]) {
  const els = airlines.map((name) => screen.getByText(name));
  for (let i = 0; i + 1 < els.length; i++) {
    expect(els[i].compareDocumentPosition(els[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
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

describe("price_estimate persists null for unpriced flights, verbatim for priced ones", () => {
  // Batch-body capture helper: renders one flight, optionally ticks it, clicks
  // the add button, and returns the parsed fetch body the modal would POST.
  async function addFlightAndCaptureBody(
    flightUnderTest: FlightResult,
    tick: boolean
  ) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{}] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderModal([flightUnderTest], 0);
    if (tick) {
      fireEvent.click(screen.getAllByRole("checkbox")[0]);
      fireEvent.click(
        screen.getByRole("button", { name: /Add Selected \(1\) to Itinerary/i })
      );
    } else {
      fireEvent.click(screen.getByRole("button", { name: /Add All to Itinerary/i }));
    }

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  }

  it("persists price_estimate null for an unpriced ticked flight", async () => {
    const body = await addFlightAndCaptureBody(unpricedFlight(), true);

    expect(body.items[0].price_estimate).toBe(null);
    // "—" must not survive anywhere in the batch payload, not even as a
    // leftover in description or title.
    expect(JSON.stringify(body)).not.toContain(NO_PRICE_LABEL);
  });

  it("persists price_estimate null for the default top flight", async () => {
    const body = await addFlightAndCaptureBody(unpricedFlight(), false);

    expect(body.items[0].price_estimate).toBe(null);
    expect(JSON.stringify(body)).not.toContain(NO_PRICE_LABEL);
  });

  // Each "unknown" condition is covered independently, so a fix that only
  // checks ONE of the two sentinels (or one add path) fails a real test.
  it("persists price_estimate null when the label is a dash but price_value is numeric", async () => {
    const dashLabelNumericValue: FlightResult = {
      ...flight("Carrier X", 289),
      price: NO_PRICE_LABEL,
    };
    const body = await addFlightAndCaptureBody(dashLabelNumericValue, true);

    expect(body.items[0].price_estimate).toBe(null);
    expect(JSON.stringify(body)).not.toContain(NO_PRICE_LABEL);
  });

  it("persists price_estimate null when price_value is unknown but the label is not a dash", async () => {
    const unknownValueNonDashLabel: FlightResult = {
      ...flight("Carrier X", PRICE_UNKNOWN),
      price: "Unknown",
    };
    const body = await addFlightAndCaptureBody(unknownValueNonDashLabel, true);

    expect(body.items[0].price_estimate).toBe(null);
  });

  // Guards against the opposite failure mode: an "always null" fix would
  // wipe real prices off every itinerary row on either add path.
  it("keeps the real price_estimate for a priced flight on the ticked path", async () => {
    const body = await addFlightAndCaptureBody(flight("Delta", 120), true);

    expect(body.items[0].price_estimate).toBe("$120");
  });

  it("keeps the real price_estimate for a priced flight on the default top-flight path", async () => {
    const body = await addFlightAndCaptureBody(flight("Delta", 120), false);

    expect(body.items[0].price_estimate).toBe("$120");
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

describe("unknown durations stay unknown", () => {
  it("hides Sort by Duration when no flight has a known duration", () => {
    renderModal(
      [
        unknownDurationFlight("Delta", 100),
        unknownDurationFlight("United", 200),
        unknownDurationFlight("JetStream", 150),
      ],
      0
    );

    // positive control: the sort row rendered and Price is still offered —
    // without this the hide assertion could pass vacuously.
    expect(screen.getByRole("button", { name: "Sort by Price" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sort by Duration" })).toBeNull();
  });

  it("sorts unknown-duration flights last under Sort by Duration", () => {
    // Flights with durations 300, unknown and 120 (that array order), with
    // prices chosen so the pre-click (price) order differs everywhere from the
    // post-click duration order.
    renderModal(
      [
        { ...unknownDurationFlight("AirMid", 100), duration: "5h", duration_minutes: 300 },
        unknownDurationFlight("AirFar", 150),
        { ...unknownDurationFlight("AirNorth", 200), duration: "2h", duration_minutes: 120 },
      ],
      0
    );

    fireEvent.click(screen.getByRole("button", { name: "Sort by Duration" }));

    // 120, 300, UNKNOWN — the unknown row never wins a "shortest flight" slot.
    expectDomOrder("AirNorth", "AirMid", "AirFar");
  });
});

// ── Focus management ────────────────────────────────────────────────────────
//
// AssistantChat passes an inline onClose, so it changes identity on every
// parent render. While the selection-isolation suite above only re-renders
// with a stable onClose, the focus effect used to key on [isOpen, onClose]:
// every parent re-render re-ran it, restashing openerRef with whatever held
// focus at that instant and scheduling a fresh requestAnimationFrame whose
// callback dragged focus back to Close. These tests pin the fix: the focus
// effect keys on [isOpen] alone, reads the CURRENT close handler through a
// ref, cancels the pending focus frame on cleanup, and restores focus to the
// element that was focused when the modal OPENED.

describe("TripResultsModal focus survives parent re-renders", () => {
  function fakeRafTimers() {
    // Fake ONLY the animation-frame pair: render/fireEvent/waits stay on real
    // timers, rAF becomes deterministic and pending until flushed.
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  }
  function flushFrames() {
    vi.advanceTimersToNextFrame();
  }
  function openerButton(): HTMLButtonElement {
    // Its own render root: the opener persists across the modal's rerenders,
    // exactly as page content around AssistantChat's modal does.
    const { container } = render(<button id="trip-opener">Open results</button>);
    return container.querySelector("#trip-opener") as HTMLButtonElement;
  }
  function modalTree(onClose: () => void, isOpen: boolean) {
    return (
      <TripResultsModal
        isOpen={isOpen}
        onClose={onClose}
        destination="Miami"
        dates={{ start: "2026-10-01", end: "2026-10-05" }}
        adults={1}
        flights={firstSet}
        tripId={1}
      />
    );
  }

  it("keeps focus across parent re-renders and returns it to the opener on close", () => {
    fakeRafTimers();

    // 1. The opener holds focus BEFORE the modal opens — that is the element
    //    the opener stash must remember.
    const opener = openerButton();
    opener.focus();
    expect(document.activeElement).toBe(opener);

    // 2. Open. The focus-to-Close frame is still pending; flush it.
    const { rerender } = render(modalTree(() => {}, true));
    flushFrames();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close trip results" })
    );

    // 3. The user moves into the modal: focus on the 2nd flight checkbox.
    const checkbox2 = screen.getAllByRole("checkbox")[1];
    checkbox2.focus();
    expect(document.activeElement).toBe(checkbox2);

    // 4. A parent re-render arrives with a NEW inline onClose (fresh identity,
    //    as AssistantChat produces on every keystroke while the modal sits
    //    open), then another animation frame lands.
    rerender(modalTree(() => {}, true));
    flushFrames();

    // 5. Focus must STILL be the checkbox — not dragged back to Close.
    expect(document.activeElement).toBe(checkbox2);

    // 6. Closing hands focus back to the ORIGINAL opener.
    rerender(modalTree(() => {}, false));
    flushFrames();
    expect(document.activeElement).toBe(opener);
  });

  it("closing before the open frame fires does not steal focus or throw", () => {
    fakeRafTimers();

    const opener = openerButton();
    opener.focus();

    const { rerender } = render(modalTree(() => {}, true));
    // Close while the focus-to-Close frame is STILL pending: the cleanup must
    // cancel the pending frame, so flushing afterwards must not fire it.
    rerender(modalTree(() => {}, false));
    flushFrames();

    expect(document.activeElement).toBe(opener);
  });

  it("Escape invokes the latest onClose after a rerender with a new inline handler", () => {
    fakeRafTimers();

    const staleOnClose = vi.fn();
    const latestOnClose = vi.fn();

    const { rerender } = render(modalTree(staleOnClose, true));
    flushFrames();

    // The keydown listener no longer resubscribes on parent re-renders, so it
    // must reach the CURRENT close handler through the ref at event time —
    // never the stale identity captured at open.
    rerender(modalTree(latestOnClose, true));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(staleOnClose).not.toHaveBeenCalled();
    expect(latestOnClose).toHaveBeenCalledTimes(1);
  });
});
