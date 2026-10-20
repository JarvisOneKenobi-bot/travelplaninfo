/**
 * Task 2 (2026-10-20): the batch route must never persist the display-only
 * "no price" label (NO_PRICE_LABEL, "—") into trip_items.price_estimate.
 *
 * Every external dependency is mocked — ownership (@/lib/guest), the database
 * (@/lib/db) and geocoding (@/lib/geocode) — so these tests never touch
 * data/tpi.db or the network. What we assert is the exact row the route hands
 * to insertStmt.run(): price_estimate AND estimated_cost, for a "—" input
 * (normalized to null), a null input (stays null), and a priced input
 * (kept verbatim, cost parsed).
 */
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NO_PRICE_LABEL } from "@/components/atlas/types";

import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  getDb: vi.fn(),
  geocodeItem: vi.fn(async () => {}),
}));

vi.mock("@/lib/guest", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/geocode", () => ({ geocodeItem: mocks.geocodeItem }));
// parseCost stays REAL: priced inputs must still parse to a number.

function makeDb() {
  const insertRun = vi.fn((..._args: unknown[]) => ({ lastInsertRowid: 42 }));
  const db = {
    prepare: vi.fn((sql: string) => {
      if (sql === "INSERT INTO trip_items\n      (trip_id, day_number, category, title, description, affiliate_url, price_estimate, estimated_cost, is_placeholder, sort_order)\n     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)") {
        return { run: insertRun };
      }
      if (sql === "SELECT id, user_id FROM trips WHERE id = ?") {
        return { get: vi.fn(() => ({ id: 1, user_id: "7" })) };
      }
      if (sql === "SELECT destination FROM trips WHERE id = ?") {
        return { get: vi.fn(() => ({ destination: "Miami" })) };
      }
      if (sql === "DELETE FROM trip_items WHERE trip_id = ? AND category = ? AND is_placeholder = 1") {
        return { run: vi.fn() };
      }
      if (sql.includes("SELECT * FROM trip_items WHERE id IN")) {
        return { all: vi.fn(() => [{ id: 42, title: "Carrier X MIA → JFK" }]) };
      }
      throw new Error(`route.test: unexpected statement prepared: ${sql}`);
    }),
    transaction: vi.fn(
      (fn: (rows: unknown[]) => number[]) => (rows: unknown[]) => fn(rows)
    ),
  };
  mocks.getDb.mockReturnValue(db);
  return { db, insertRun };
}

function postItem(priceEstimate: unknown) {
  const req = new Request("http://localhost/api/trips/1/items/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          day_number: 1,
          category: "flight",
          title: "Carrier X MIA → JFK",
          description: "Nonstop",
          price_estimate: priceEstimate,
          affiliate_url: "https://example.test/book",
        },
      ],
    }),
  }) as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ id: "1" }) });
}

describe("trip items batch route: price_estimate normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue({ userId: "7", isGuest: false });
  });

  it("normalizes a '—' price_estimate to null", async () => {
    const { insertRun } = makeDb();

    const res = await postItem(NO_PRICE_LABEL);

    expect(res.status).toBe(201);
    expect(insertRun).toHaveBeenCalledTimes(1);
    // insertStmt.run(id, day_number, category, title, description,
    //                affiliate_url, price_estimate, estimated_cost, ...) —
    // both the estimate and its parsed cost must be null, not "—".
    expect(insertRun.mock.calls[0][6]).toBe(null);
    expect(insertRun.mock.calls[0][7]).toBe(null);
  });

  it("persists a null price_estimate as null with a null estimated_cost", async () => {
    const { insertRun } = makeDb();

    const res = await postItem(null);

    expect(res.status).toBe(201);
    expect(insertRun.mock.calls[0][6]).toBe(null);
    expect(insertRun.mock.calls[0][7]).toBe(null);
  });

  it("persists a priced price_estimate verbatim and parses estimated_cost", async () => {
    const { insertRun } = makeDb();

    const res = await postItem("$289");

    expect(res.status).toBe(201);
    expect(insertRun.mock.calls[0][6]).toBe("$289");
    expect(insertRun.mock.calls[0][7]).toBe(289);
  });
});