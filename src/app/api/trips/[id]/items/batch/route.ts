import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/guest";
import { getDb } from "@/lib/db";
import { geocodeItem } from "@/lib/geocode";
import { parseCost } from "@/lib/cost-utils";
import { NO_PRICE_LABEL } from "@/lib/atlas/labels";

type Params = { params: Promise<{ id: string }> };

const VALID_CATEGORIES = new Set([
  "flight",
  "hotel",
  "car_rental",
  "activity",
  "restaurant",
  "transportation",
  "note",
]);

const MAX_BATCH_SIZE = 50;

async function verifyTripOwnership(userId: string, tripId: string) {
  const db = getDb();
  const trip = db.prepare("SELECT id, user_id FROM trips WHERE id = ?").get(tripId) as
    | { id: number; user_id: number }
    | undefined;
  return trip && String(trip.user_id) === String(userId) ? trip : null;
}

interface BatchItem {
  day_number?: number;
  category?: string;
  title?: string;
  description?: string;
  price_estimate?: string | null;
  affiliate_url?: string;
  is_placeholder?: number;
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getUserId();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = ctx.userId;

  if (!(await verifyTripOwnership(userId, id))) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Validate items array ────────────────────────────────────────────────

  if (!body.items || !Array.isArray(body.items)) {
    return NextResponse.json(
      { error: "items must be a non-empty array" },
      { status: 400 }
    );
  }

  const items = body.items as BatchItem[];

  if (items.length === 0) {
    return NextResponse.json(
      { error: "items must be a non-empty array" },
      { status: 400 }
    );
  }

  if (items.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Maximum ${MAX_BATCH_SIZE} items per batch` },
      { status: 400 }
    );
  }

  // ── Validate each item ──────────────────────────────────────────────────

  const errors: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!item.title || typeof item.title !== "string" || item.title.trim().length === 0) {
      errors.push(`Item ${i}: title is required and must be a non-empty string`);
      continue;
    }

    if (item.day_number !== undefined) {
      const day = Number(item.day_number);
      if (!Number.isInteger(day) || day < 1) {
        errors.push(`Item ${i}: day_number must be a positive integer`);
      }
    }

    // Normalize legacy 'car' category
    if (item.category === "car") item.category = "car_rental";

    if (item.category !== undefined && !VALID_CATEGORIES.has(item.category)) {
      errors.push(
        `Item ${i}: category must be one of: ${Array.from(VALID_CATEGORIES).join(", ")}`
      );
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  // ── Bulk insert in a transaction ────────────────────────────────────────

  const db = getDb();

  const insertStmt = db.prepare(
    `INSERT INTO trip_items
      (trip_id, day_number, category, title, description, affiliate_url, price_estimate, estimated_cost, is_placeholder, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction(
    (rows: { day_number: number; category: string; title: string; description: string | null; affiliate_url: string | null; price_estimate: string | null; estimated_cost: number | null; is_placeholder: number; sort_order: number }[]) => {
      const ids: number[] = [];
      for (const row of rows) {
        const result = insertStmt.run(
          id,
          row.day_number,
          row.category,
          row.title,
          row.description,
          row.affiliate_url,
          row.price_estimate,
          row.estimated_cost,
          row.is_placeholder,
          row.sort_order
        ) as { lastInsertRowid: number };
        ids.push(Number(result.lastInsertRowid));
      }
      return ids;
    }
  );

  // Get trip destination for geocoding
  const tripRow = db.prepare("SELECT destination FROM trips WHERE id = ?").get(id) as { destination: string } | undefined;
  const destination = tripRow?.destination || "";

  try {
    // Placeholder cleanup: remove placeholders of same category before inserting real items
    const placeholderCategories = ['flight', 'hotel', 'car_rental'];
    const categoriesToClean = [...new Set(items.map(i => i.category).filter(Boolean))] as string[];
    for (const cat of categoriesToClean) {
      if (placeholderCategories.includes(cat)) {
        db.prepare('DELETE FROM trip_items WHERE trip_id = ? AND category = ? AND is_placeholder = 1').run(id, cat);
      }
    }

    const rows = items.map((item, i) => {
      const rawPrice = item.price_estimate?.trim() || null;
      // "—" (NO_PRICE_LABEL) is a display-only label produced upstream when
      // the price is unknown; persisted, it would make every itinerary row
      // lie about its cost forever. Normalize it (and empty strings) to null.
      const priceEstimate = rawPrice === NO_PRICE_LABEL ? null : rawPrice;
      return {
        day_number: Math.max(1, Math.floor(Number(item.day_number) || 1)),
        category: item.category && VALID_CATEGORIES.has(item.category) ? item.category : "note",
        title: item.title!.trim(),
        description: item.description?.trim() || null,
        affiliate_url: item.affiliate_url?.trim() || null,
        price_estimate: priceEstimate,
        estimated_cost: parseCost(priceEstimate),
        is_placeholder: item.is_placeholder ?? 0,
        sort_order: i,
      };
    });

    const ids = insertMany(rows);

    // Fetch created items
    const placeholders = ids.map(() => "?").join(",");
    const createdItems = db
      .prepare(`SELECT * FROM trip_items WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number; title: string }[];

    // Fire-and-forget geocoding in chunks of 5 (rate limit protection)
    const geocodeAsync = async () => {
      for (let i = 0; i < createdItems.length; i += 5) {
        const chunk = createdItems.slice(i, i + 5);
        await Promise.allSettled(
          chunk.map(item => geocodeItem(item.id, item.title, destination))
        );
      }
    };
    geocodeAsync().catch(() => {});

    return NextResponse.json({ items: createdItems }, { status: 201 });
  } catch (err) {
    console.error("Batch insert error:", err);
    return NextResponse.json(
      { error: "Failed to add items" },
      { status: 500 }
    );
  }
}
