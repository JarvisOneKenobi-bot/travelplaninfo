// @vitest-environment jsdom
/**
 * Parent-level extraction counting (Task 6c, review #3 fix-up): the counting
 * test in AssistantMessageBody.test.tsx substitutes a direct getTripFlights
 * call for the production sidebar, so it cannot see a sidebar that stops
 * sharing the cache. This test renders the REAL AssistantChat and drives it
 * end-to-end like a user (SSE frames in encodeSseData's exact format, as in
 * AssistantChat.reset.test.tsx):
 *
 *  - the mobile chat-panel layout receives content A (body renders 5 cards);
 *  - the desktop modal-mode layout (atlas-open event, no auto-send) shows the
 *    same messages plus the real trip-cards sidebar, fed by the sidebarFlights
 *    memo through getTripFlights;
 *  - unrelated parent re-renders (input typing, voice toggle) hit bodies and
 *    sidebar without changing anything.
 *
 * A streams with intermediate content versions, so the assertion counts
 * flight-BEARING extractTripData calls (calls whose parsed parts contain a
 * tool result with flights): the empty placeholder and bare-text prefixes
 * yield no flight data, and the cache yields exactly ONE call per content.
 * Content A must be extracted ONCE across body + sidebar + re-renders, and
 * distinct content B adds exactly one. The mutation check saved to
 * task6c-sidebar-mutation-red.txt rewired AssistantChat's sidebarFlights memo
 * to call extractTripData directly (bypassing the cache) and this file went
 * red on the first assertion.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks: only the network-dependent hooks (same scaffolding as
// AssistantChat.reset.test.tsx). Everything between the send button and the
// sidebar — trip-data parsing, the trip-flights cache, AssistantMessageBody —
// runs real; trip-data is wrapped in a vitest spy like the cache test.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/hooks/useAtlasBubble", () => ({
  useAtlasBubble: () => ({ currentBubble: null, dismissBubble: vi.fn() }),
}));
vi.mock("@/hooks/useAssistantHealth", () => ({
  useAssistantHealth: () => ({ healthy: true }),
}));
vi.mock("./atlas/trip-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./atlas/trip-data")>();
  return { ...actual, extractTripData: vi.fn(actual.extractTripData) };
});

import AssistantChat from "@/components/AssistantChat";
import { extractTripData } from "./atlas/trip-data";
import { resetTripFlightsCache } from "./atlas/trip-flights-cache";

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

const FIVE_A = [
  rawFlight("AirAlpha", "$110"),
  rawFlight("AirBeta", "$210"),
  rawFlight("AirGamma", "$310"),
  rawFlight("AirDelta", "$410"),
  rawFlight("AirEpsilon", "$510"),
];
const TWO_B = [rawFlight("AirOmega", "$610"), rawFlight("AirPsi", "$710")];

/** Raw producer-shaped SSE payloads for one streamed assistant reply. */
function streamFor(prefix: string, flights: unknown[]): string[] {
  return [
    prefix,
    `[TOOL:search_flights]${JSON.stringify({ flights })}`,
    "[DONE]",
  ];
}

/** Minimal Response-like value whose body is a ReadableStream of SSE frames. */
function sseResponse(payloads: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream };
}

/** One POST /api/assistant/chat per stream, popped in order. */
function installStreamQueue(streams: string[][]) {
  const fetchMock = vi.fn();
  fetchMock.mockImplementation((input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    if (url.startsWith("/api/assistant/sessions")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "sess-test" }) });
    }
    if (url.startsWith("/api/assistant/chat")) {
      return Promise.resolve(sseResponse(streams.shift() ?? []));
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function sendChat(text: string) {
  fireEvent.change(screen.getByPlaceholderText("placeholder"), { target: { value: text } });
  fireEvent.click(screen.getByTitle("Send"));
}

/** spy invocations that parsed REAL flight data (any tool part with flights). */
function flightBearingExtractions(): number {
  const spy = extractTripData as unknown as { mock: { calls: unknown[][] } };
  return spy.mock.calls.filter((args) => {
    const parts = args[0];
    if (!Array.isArray(parts)) return false;
    return parts.some(
      (p) =>
        p !== null &&
        typeof p === "object" &&
        (p as { type?: unknown }).type === "tool" &&
        Array.isArray((p as { data?: { flights?: unknown[] } }).data?.flights) &&
        ((p as { data?: { flights?: unknown[] } }).data?.flights ?? []).length > 0
    );
  }).length;
}

describe("AssistantChat counts one extraction per content through the real sidebar", () => {
  beforeAll(() => {
    // jsdom has no smooth-scroll primitive; the auto-scroll effect would throw.
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => {
    resetTripFlightsCache();
    (extractTripData as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("extracts content A once across body + sidebar + re-renders, then +1 for B", async () => {
    installStreamQueue([
      streamFor("Found 5 great options for your trip.", FIVE_A),
      streamFor("Here are two more options.", TWO_B),
    ]);
    render(<AssistantChat />);

    // 1) Mobile layout: open the chat panel and stream content A.
    fireEvent.click(screen.getByTitle("Ask Atlas"));
    sendChat("Find me a flight");
    await waitFor(
      () => {
        expect(screen.getAllByTestId("flight-card")).toHaveLength(5);
        expect(screen.getAllByRole("button", { name: /Add to itinerary/i })).toHaveLength(1);
      },
      { timeout: 5000 }
    );

    // Body rendered A, the sidebarFlights memo consumed it too: exactly ONE
    // extraction of A despite both consumers (cache dedupe).
    expect(flightBearingExtractions()).toBe(1);

    // 2) Desktop layout: atlas-open (no message → no auto-send) swaps to the
    // modal-mode layout whose right sidebar renders the SAME cached flights.
    act(() => {
      window.dispatchEvent(new CustomEvent("atlas-open", { detail: {} }));
    });
    expect(await screen.findByText("✈️ Flights (5)")).toBeTruthy();
    expect(flightBearingExtractions()).toBe(1);

    // 3) Unrelated parent re-renders: typing in the input and toggling voice
    // both change parent-only state — bodies and sidebar are served by cache.
    fireEvent.change(screen.getByPlaceholderText("placeholder"), { target: { value: "idle typing" } });
    fireEvent.click(screen.getByTitle("Enable Atlas voice"));
    expect(await screen.findByText("✈️ Flights (5)")).toBeTruthy();
    expect(flightBearingExtractions()).toBe(1);
    fireEvent.click(screen.getByTitle("Mute Atlas voice"));
    expect(flightBearingExtractions()).toBe(1);

    // 4) Distinct content B: exactly ONE more extraction.
    sendChat("Find me another");
    await waitFor(() => expect(screen.getAllByTestId("flight-card")).toHaveLength(7), { timeout: 5000 });
    expect(await screen.findByText("✈️ Flights (2)")).toBeTruthy();
    expect(flightBearingExtractions()).toBe(2);
  });
});