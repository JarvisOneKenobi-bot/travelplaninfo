/**
 * Shared sentinel constants for Atlas flight data. They live in lib, not in a
 * component module, so server-side code (src/lib/atlas/*, API routes) can
 * import them without depending on a component module path. The component
 * module (src/components/atlas/types.ts) re-exports them unchanged, so
 * existing component import sites keep working.
 */

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