import {
  tpGet,
  rawSearchFlights,
  rawItems,
  nextMonthUtc,
  addDays,
  cleanIata,
  parseIata,
  buildAviasalesLink,
  FAILURE_REASONS,
  INVALID_IATA_REASON,
  type TpFailure,
  type TpFlightItem,
} from "./travelpayouts-client";
import { NO_PRICE_LABEL } from "./labels";
import { DESTINATION_VIBES } from "./destination-vibes";
import { resolveCityName } from "./city-names";
import { resolveMetro } from "./metro";
import { airlineDisplayName } from "./airline-names";
import { normalizeVibes } from "./surprise-query";
import type { SurpriseDegraded } from "./surprise-degrade";
import { preflightVibes, type PreflightResult } from "./vibe-preflight";

export const TRIP_LENGTH_DAYS: Record<string, number> = {
  weekend: 2,
  week: 7,
  "10_14_days": 12,
  "2_weeks": 14,
  "3_weeks": 21,
};

export const NO_ROUTES_REASON =
  "Live flight search returned no popular routes for this origin and month. This does NOT mean no flights exist — try a different month or ask Atlas.";
export const NO_VIBE_MATCH_REASON =
  "No live routes matched the requested vibes for this origin and month. This does NOT mean no flights exist — try different vibes or ask Atlas.";
export const UNKNOWN_VIBES_REASON =
  "Some requested vibes are not part of the search vocabulary, so the search did not run. This does NOT mean no flights exist — adjust the vibes or ask Atlas.";
export const NO_MATCH_POSSIBLE_REASON =
  "No known destination combines all the requested vibes at once, so the search did not run. This does NOT mean no flights exist — try matching any vibe, or ask Atlas.";
export { NO_PRICE_LABEL };

export interface SurpriseDestination {
  name: string;
  flightPrice: string;
  airline: string;
  nonstop: boolean;
  link: string;
}

export interface SurpriseResult {
  origin: string;
  originName?: string;
  destinations: SurpriseDestination[];
  degraded?: SurpriseDegraded;
  notice?: SurpriseDegraded;
  preflight?: PreflightResult;
}

type RouteCandidate = {
  destination: string;
  price: TpFlightItem["price"] | null;
  airline: string;
  transfers: number | null;
  link: string;
};

type CuratedEntry = {
  code: string;
  tags: ReadonlySet<string>;
  overlap: number;
};

function priceLabel(price: number | null | undefined, isRoundTrip: boolean): string {
  if (price == null) return NO_PRICE_LABEL;
  return isRoundTrip ? `$${price} rt` : `$${price}`;
}

function overlapCount(requestedVibes: ReadonlySet<string>, tags: ReadonlySet<string> | undefined): number {
  if (!tags) return 0;
  let overlap = 0;
  for (const vibe of requestedVibes) {
    if (tags.has(vibe)) overlap += 1;
  }
  return overlap;
}

// "New York, New York", "New York (LaGuardia)" and "New York, United States
// (all airports)" are the same place for trip purposes: compare on the city
// part, trailing parenthetical stripped.
function cityKey(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").split(",")[0].trim().toLowerCase();
}

function canUseMonthForRoundTrip(departMonth: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(departMonth)) return false;
  const month = Number(departMonth.slice(5, 7));
  return month >= 1 && month <= 12;
}

function toDestination(route: RouteCandidate, name: string, isRoundTrip: boolean): SurpriseDestination {
  return {
    name,
    flightPrice: priceLabel(route.price, isRoundTrip),
    airline: airlineDisplayName(route.airline),
    nonstop: route.transfers === 0,
    link: route.link,
  };
}

export async function getSurpriseDestinations(params: {
  origin: string;
  vibes?: string;
  departMonth?: string;
  tripLength?: string;
  matchMode?: "all" | "any";
}): Promise<SurpriseResult> {
  const inputOrigin = params.origin ?? "";
  const origin = parseIata(inputOrigin);
  if (!origin) {
    return {
      origin: inputOrigin.trim().toUpperCase(),
      destinations: [],
      degraded: { code: "invalid_origin", reason: INVALID_IATA_REASON },
    };
  }

  const requestedVibes = new Set(normalizeVibes(params.vibes));
  const originResolved = resolveCityName(origin);
  const originName = originResolved ?? undefined;
  const originMetro = resolveMetro(origin);

  if (requestedVibes.size > 0) {
    const preflight = preflightVibes([...requestedVibes], { matchMode: params.matchMode });
    if (preflight.status !== "ok") {
      return {
        origin,
        originName,
        destinations: [],
        degraded:
          preflight.status === "unknown_vibes"
            ? { code: "unknown_vibes", reason: UNKNOWN_VIBES_REASON }
            : { code: "no_match_possible", reason: NO_MATCH_POSSIBLE_REASON },
        preflight,
      };
    }
  }

  const minOverlap = params.matchMode === "any" ? 1 : requestedVibes.size >= 2 ? 2 : 1;
  const departMonth = params.departMonth?.trim() || nextMonthUtc();

  let returnDate: string | undefined;
  let isRoundTrip = false;
  const days = TRIP_LENGTH_DAYS[params.tripLength ?? ""];
  if (typeof days === "number" && canUseMonthForRoundTrip(departMonth)) {
    returnDate = addDays(`${departMonth}-01`, days);
    isRoundTrip = returnDate !== undefined;
  }

  const popularParams: Record<string, string | number> = {
    origin,
    departure_at: departMonth.slice(0, 7),
    sorting: "price",
    currency: "usd",
    limit: 100,
  };
  if (returnDate) popularParams.return_at = returnDate.slice(0, 7);

  const result = await tpGet("/aviasales/v3/prices_for_dates", popularParams);
  let failureReason: string | undefined;
  let failureCode: TpFailure | undefined;
  let popular: RouteCandidate[] = [];

  if ("failure" in result) {
    failureCode = result.failure;
    failureReason = FAILURE_REASONS[result.failure];
  } else {
    popular = rawItems(result.data).map((route) => {
      const destination = cleanIata(route.destination ?? "");
      return {
        destination,
        price: route.price ?? null,
        airline: route.airline ?? "",
        transfers: route.transfers ?? null,
        link: buildAviasalesLink(origin, destination, route.departure_at ?? ""),
      };
    });
  }

  const popularPriceByDest: Record<string, RouteCandidate> = {};
  for (const route of popular) {
    if (route.destination && !(route.destination in popularPriceByDest)) {
      popularPriceByDest[route.destination] = route;
    }
  }

  const seenCodes = new Set<string>();
  const candidates: RouteCandidate[] = [];
  for (const route of popular) {
    const code = route.destination;
    if (code === origin || resolveMetro(code) === originMetro || seenCodes.has(code)) continue;
    seenCodes.add(code);
    candidates.push(route);
  }

  const originCityKey = originResolved ? cityKey(originResolved) : null;

  let namedCandidates = candidates
    .map((route) => ({ route, name: resolveCityName(route.destination) }))
    .filter((entry): entry is { route: RouteCandidate; name: string } => entry.name !== null)
    .filter(({ name }) => originCityKey === null || cityKey(name) !== originCityKey);

  if (requestedVibes.size > 0) {
    namedCandidates = namedCandidates
      .map((entry) => ({
        ...entry,
        overlap: overlapCount(requestedVibes, DESTINATION_VIBES[entry.route.destination]),
      }))
      .filter(({ overlap }) => overlap >= minOverlap)
      .sort((a, b) => b.overlap - a.overlap)
      .map(({ route, name }) => ({ route, name }));
  }

  const destinations: SurpriseDestination[] = namedCandidates
    .slice(0, 3)
    .map(({ route, name }) => toDestination(route, name, isRoundTrip));

  if (destinations.length < 3 && requestedVibes.size > 0) {
    const curatedEntries: CuratedEntry[] = Object.entries(DESTINATION_VIBES)
      .map(([code, tags]) => ({ code, tags, overlap: overlapCount(requestedVibes, tags) }))
      .sort((a, b) => b.overlap - a.overlap);

    const slotsRemaining = 3 - destinations.length;
    const seen = new Set(destinations.map((destination) => cityKey(destination.name)));
    const enrichmentCodes: string[] = [];

    for (const { code, overlap } of curatedEntries) {
      if (enrichmentCodes.length >= slotsRemaining) break;
      if (code === origin) continue;
      if (resolveMetro(code) === originMetro) continue;
      if (overlap < minOverlap) continue;
      const cityName = resolveCityName(code);
      if (!cityName) continue;
      if (originCityKey !== null && cityKey(cityName) === originCityKey) continue;
      if (seen.has(cityKey(cityName))) continue;
      if (!(code in popularPriceByDest)) enrichmentCodes.push(code);
    }

    const enrichmentLookup: Record<string, RouteCandidate> = {};
    await Promise.all(
      enrichmentCodes.map(async (code) => {
        try {
          const search = await rawSearchFlights(origin, code, `${departMonth.slice(0, 7)}-01`, returnDate);
          if (search.flights.length === 0) return;
          const cheapest = search.flights.reduce((best, current) =>
            (current.price ?? 999999) < (best.price ?? 999999) ? current : best
          );
          enrichmentLookup[code] = {
            destination: code,
            price: cheapest.price ?? null,
            airline: cheapest.airline ?? "",
            transfers: cheapest.transfers ?? null,
            link: cheapest.link ?? "",
          };
        } catch {
          // A failed enrichment is simply unavailable; the card remains honest.
        }
      })
    );

    for (const { code, overlap } of curatedEntries) {
      if (destinations.length >= 3) break;
      if (code === origin) continue;
      if (resolveMetro(code) === originMetro) continue;
      if (overlap < minOverlap) continue;
      const cityName = resolveCityName(code);
      if (!cityName) continue;
      if (originCityKey !== null && cityKey(cityName) === originCityKey) continue;
      if (seen.has(cityKey(cityName))) continue;
      seen.add(cityKey(cityName));

      const route = popularPriceByDest[code] ?? enrichmentLookup[code];
      if (route) {
        destinations.push({
          name: cityName,
          flightPrice: priceLabel(route.price, isRoundTrip),
          airline: airlineDisplayName(route.airline),
          nonstop: route.transfers === 0,
          link: route.link ?? "",
        });
      } else {
        destinations.push({
          name: cityName,
          flightPrice: NO_PRICE_LABEL,
          airline: "",
          nonstop: false,
          link: "",
        });
      }
    }
  }

  if (destinations.length === 0) {
    return {
      origin,
      originName,
      destinations,
      degraded: {
        code: failureCode ?? (requestedVibes.size > 0 ? "no_vibe_match" : "no_routes"),
        reason: failureReason ?? (requestedVibes.size > 0 ? NO_VIBE_MATCH_REASON : NO_ROUTES_REASON),
      },
    };
  }

  return {
    origin,
    originName,
    destinations,
    ...(failureCode ? { notice: { code: failureCode, reason: FAILURE_REASONS[failureCode] } } : {}),
  };
}
