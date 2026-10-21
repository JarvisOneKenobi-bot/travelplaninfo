// @vitest-environment jsdom
/**
 * Parent-owned reset contract (Task 6, review #3): AssistantChat owns
 * modalSeq, so the parent — not the modal — must guarantee a fresh modal
 * instance per "Add to itinerary" open. TripResultsModal.test.tsx already
 * proves remount-under-a-new-key clears selection; this test pins that the
 * chat actually WIRES it: open results A, tick a flight, close, open results
 * B — the tick must not leak into B's flight 0.
 *
 * The chat is driven end-to-end the way a user would: the SSE
 * /api/assistant/chat stream is faked in the exact frame format encodeSseData
 * produces (`data: …\n\n`), so both message bodies come from a real streaming
 * render instead of reach-into-internals. The mutation check saved to
 * task6-mutation-red.txt removes the setModalSeq bump from openResults and
 * this test goes red: with a stable key the closed-but-still-mounted modal
 * carries flight 0's tick into the new result set — the exact leak this
 * pipeline exists to prevent (negative-controlled at the modal level in
 * TripResultsModal.test.tsx).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ── Module mocks: only the network-dependent hooks. Everything between the
// send button and the modal — trip-data parsing, the trip-flights cache, the
// trip-tools gate, AssistantMessageBody, TripResultsModal itself — runs real.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/hooks/useAtlasBubble", () => ({
  useAtlasBubble: () => ({ currentBubble: null, dismissBubble: vi.fn() }),
}));
vi.mock("@/hooks/useAssistantHealth", () => ({
  useAssistantHealth: () => ({ healthy: true }),
}));

import AssistantChat from "@/components/AssistantChat";

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

describe("AssistantChat owns the modal reset between opens", () => {
  beforeAll(() => {
    // jsdom has no smooth-scroll primitive; the auto-scroll effect would throw.
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("open A → tick → close → open B: B starts with nothing selected", async () => {
    installStreamQueue([
      streamFor("Found 5 great options for your trip.", FIVE_A),
      streamFor("Here are two more options.", TWO_B),
    ]);
    render(<AssistantChat />);

    // Open the chat panel and send the first message
    fireEvent.click(screen.getByTitle("Ask Atlas"));
    sendChat("Find me a flight");

    // Message A streamed in: 5 inline flight cards + its modal entry point
    await waitFor(
      () => {
        expect(screen.getAllByTestId("flight-card")).toHaveLength(5);
        expect(screen.getAllByRole("button", { name: /Add to itinerary/i })).toHaveLength(1);
      },
      { timeout: 5000 }
    );

    // Open results A and tick its first flight — state the next open must clear
    fireEvent.click(screen.getByRole("button", { name: /Add to itinerary/i }));
    const modalA = await screen.findByRole("dialog");
    expect(await within(modalA).findByRole("button", { name: /Add All to Itinerary/i })).toBeTruthy();
    fireEvent.click(within(modalA).getAllByRole("checkbox")[0]);
    // Pre-state proof: A's selection actually latched (cannot pass vacuously)
    expect(within(modalA).getByRole("button", { name: /Add Selected \(1\) to Itinerary/i })).toBeTruthy();

    // Close
    fireEvent.click(screen.getByRole("button", { name: "Close trip results" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Send the second message → its own result set arrives
    sendChat("Find me another");
    await waitFor(() => expect(screen.getAllByTestId("flight-card")).toHaveLength(7), { timeout: 5000 });
    const openButtons = screen.getAllByRole("button", { name: /Add to itinerary/i });
    expect(openButtons).toHaveLength(2);

    // Open results B
    fireEvent.click(openButtons[1]);

    // B's modal shows ONLY B's flights, and starts with NOT ONE flight ticked:
    // the parent bumped the modal instance key, so A's tick did not survive.
    const modalB = await screen.findByRole("dialog");
    await waitFor(() => expect(within(modalB).getByText("AirOmega")).toBeTruthy());
    expect(within(modalB).queryByText("AirAlpha")).toBeNull();
    const checkboxes = within(modalB).getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((c) => !c.checked)).toBe(true);
    expect(within(modalB).queryByRole("button", { name: /Add Selected \(\d+\) to Itinerary/i })).toBeNull();
  });
});