/** Shared types for Atlas trip result data — used by TripResultsModal + AssistantChat */

/** Extends FlightData from FlightCard with fields needed for sort + badges */
export interface FlightResult {
  airline: string;
  route: string;
  price: string;          // display string, e.g. "$289"
  price_value: number;    // numeric for sorting (dollars)
  duration: string;       // e.g. "3h 15m"
  duration_minutes: number; // numeric for sorting
  stops: string;          // e.g. "Nonstop" or "1 stop"
  nonstop: boolean;       // for badge rendering
  depart_date?: string;
  return_date?: string;
  book_url: string;
}

/** Budget tier type used by AssistantChat */
export type BudgetTier = "budget" | "mid" | "luxury";

/**
 * Price/duration sentinels live in their own lib module (src/lib/atlas/labels.ts)
 * so server-side code in src/lib can import them without a component dependency.
 * Re-exported here for the existing component import sites — same names, same
 * values, one spelling everywhere.
 */
export { PRICE_UNKNOWN, NO_PRICE_LABEL, DURATION_UNKNOWN } from "@/lib/atlas/labels";