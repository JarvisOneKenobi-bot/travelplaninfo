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
 * Sentinel `price_value` for a flight whose price is unknown. The producer emits
 * "—" (NO_PRICE_LABEL) whenever the upstream price is null or <= 0 and sends no
 * price_value, so parsing yields 0 — which would sort the row FIRST, hand it the
 * "Best Price" badge and render a $0 estimated total. Unknown sorts last and is
 * excluded from every cheapest/total calculation.
 */
export const PRICE_UNKNOWN = Number.MAX_SAFE_INTEGER;

/** The producer's label for a price it does not have. One spelling everywhere. */
export const NO_PRICE_LABEL = "—";

/** Sentinel `duration_minutes` for a flight whose duration is unknown. Sorts last. */
export const DURATION_UNKNOWN = Number.MAX_SAFE_INTEGER;
