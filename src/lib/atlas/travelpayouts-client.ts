import { TP_CONFIG } from "@/config/affiliates";
import { parseIata } from "@/lib/iata";
import { airlineDisplayName } from "./airline-names";

export { parseIata };

const BASE_URL = "https://api.travelpayouts.com";
const CACHE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10 * 1000;
const RATE_LIMIT = 200;
const RATE_WINDOW_MS = 60 * 60 * 1000;
import { NO_PRICE_LABEL } from "./labels";
export { NO_PRICE_LABEL };

export interface FlightOption {
  origin: string;
  destination: string;
  price: number | null;
  airline?: string;
  flight_number?: string;
  departure_at: string;
  return_at?: string | null;
  transfers: number | null;
  link: string;
}

export interface FlightCardOption {
  airline: string;
  route: string;
  price: string;
  duration: string;
  stops: string;
  depart_date: string;
  return_date: string;
  book_url: string;
}

export interface DealOption {
  price: number | null;
  airline?: string;
  destination: string;
  departure_at: string;
  return_at?: string | null;
  transfers: number;
  link: string;
}

export interface DealCardOption {
  date: string;
  destination: string;
  price: string;
  savings_pct: number;
  search_url: string;
}

export interface PopularRoute {
  price: number | null;
  airline?: string;
  destination: string;
  destination_city: string;
  departure_at: string;
  transfers: number;
  link: string;
}

export interface DestinationSuggestion {
  city: string;
  tagline: string;
  estimated_flight: string;
}

export type TpResponse = { success?: boolean; data?: unknown };
type CacheEntry = { data: TpResponse; expiresAt: number };
export type TpFailure = "no_token" | "rate_limited" | "http_error" | "timeout";
export type TpResult = { data: TpResponse } | { failure: TpFailure };

export const FAILURE_REASONS: Record<TpFailure, string> = {
  no_token:
    "Live flight search is not configured (missing Travelpayouts token). The search could not run — this does NOT mean no flights exist.",
  rate_limited:
    "Live flight search is temporarily rate-limited. The search could not run — this does NOT mean no flights exist. Try again shortly.",
  http_error:
    "The flight data service returned an error. The search could not run — this does NOT mean no flights exist.",
  timeout:
    "The flight data service timed out. The search could not run — this does NOT mean no flights exist.",
};

let warnedNoToken = false;

export type TpFlightItem = {
  origin?: string;
  destination?: string;
  price?: number | null;
  airline?: string;
  flight_number?: string;
  departure_at?: string;
  return_at?: string | null;
  transfers?: number;
};

export const NEARBY_AIRPORTS_MAP: Record<string, string[]> = {
  "MIA": ["FLL", "PBI"],
  "FLL": ["MIA", "PBI"],
  "JFK": ["EWR", "LGA"],
  "EWR": ["JFK", "LGA"],
  "LGA": ["JFK", "EWR"],
  "LAX": ["SNA", "BUR", "LGB"],
  "ORD": ["MDW"],
  "DFW": ["DAL", "IAH"],
  "ATL": [],
  "SFO": ["OAK", "SJC"],
};

export const IATA_TO_CITY: Record<string, string> = {
  // Caribbean & Mexico (most common TP popular routes from US East Coast)
  "CUN": "Cancún, Mexico",
  "SJU": "San Juan, Puerto Rico",
  "PUJ": "Punta Cana, Dominican Republic",
  "MBJ": "Montego Bay, Jamaica",
  "NAS": "Nassau, Bahamas",
  "GCM": "Grand Cayman, Cayman Islands",
  "BGI": "Bridgetown, Barbados",
  "ANU": "Antigua",
  "STT": "St. Thomas, USVI",
  "STX": "St. Croix, USVI",
  "SXM": "Sint Maarten",
  "PLS": "Providenciales, Turks & Caicos",
  "HAV": "Havana, Cuba",
  "VRA": "Varadero, Cuba",
  "MEX": "Mexico City, Mexico",
  "GDL": "Guadalajara, Mexico",
  "MID": "Mérida, Mexico",
  "SJD": "Los Cabos, Mexico",
  "PVR": "Puerto Vallarta, Mexico",
  "ZIH": "Zihuatanejo, Mexico",
  "OAX": "Oaxaca, Mexico",
  // US domestic
  "ORD": "Chicago, Illinois",
  "LAX": "Los Angeles, California",
  "JFK": "New York, New York",
  "LGA": "New York (LaGuardia)",
  "EWR": "Newark, New Jersey",
  "LAS": "Las Vegas, Nevada",
  "MCO": "Orlando, Florida",
  "ATL": "Atlanta, Georgia",
  "DFW": "Dallas, Texas",
  "DEN": "Denver, Colorado",
  "SEA": "Seattle, Washington",
  "BOS": "Boston, Massachusetts",
  "SFO": "San Francisco, California",
  "MIA": "Miami, Florida",
  "FLL": "Fort Lauderdale, Florida",
  "TPA": "Tampa, Florida",
  "MSY": "New Orleans, Louisiana",
  "CLT": "Charlotte, North Carolina",
  "PHX": "Phoenix, Arizona",
  "SAN": "San Diego, California",
  "PDX": "Portland, Oregon",
  "AUS": "Austin, Texas",
  "BNA": "Nashville, Tennessee",
  "MSP": "Minneapolis, Minnesota",
  "DTW": "Detroit, Michigan",
  "PHL": "Philadelphia, Pennsylvania",
  "DCA": "Washington D.C.",
  "IAD": "Washington Dulles",
  "BWI": "Baltimore, Maryland",
  "RSW": "Fort Myers, Florida",
  "PBI": "West Palm Beach, Florida",
  "JAX": "Jacksonville, Florida",
  "SLC": "Salt Lake City, Utah",
  // Canada
  "YVR": "Vancouver, Canada",
  // Europe
  "LHR": "London, England",
  "LGW": "London Gatwick, England",
  "CDG": "Paris, France",
  "ORY": "Paris Orly, France",
  "FCO": "Rome, Italy",
  "MXP": "Milan, Italy",
  "BCN": "Barcelona, Spain",
  "MAD": "Madrid, Spain",
  "AGP": "Málaga, Spain",
  "AMS": "Amsterdam, Netherlands",
  "DUB": "Dublin, Ireland",
  "LIS": "Lisbon, Portugal",
  "ATH": "Athens, Greece",
  "IST": "Istanbul, Turkey",
  "FRA": "Frankfurt, Germany",
  "MUC": "Munich, Germany",
  "CPH": "Copenhagen, Denmark",
  "ARN": "Stockholm, Sweden",
  "OSL": "Oslo, Norway",
  "HEL": "Helsinki, Finland",
  "ZRH": "Zurich, Switzerland",
  "GVA": "Geneva, Switzerland",
  "VIE": "Vienna, Austria",
  "WAW": "Warsaw, Poland",
  "PRG": "Prague, Czech Republic",
  "BUD": "Budapest, Hungary",
  "KEF": "Reykjavik, Iceland",
  // Latin America
  "GRU": "São Paulo, Brazil",
  "GIG": "Rio de Janeiro, Brazil",
  "EZE": "Buenos Aires, Argentina",
  "BOG": "Bogotá, Colombia",
  "MDE": "Medellín, Colombia",
  "CTG": "Cartagena, Colombia",
  "LIM": "Lima, Peru",
  "SCL": "Santiago, Chile",
  "UIO": "Quito, Ecuador",
  "GYE": "Guayaquil, Ecuador",
  "ASU": "Asunción, Paraguay",
  "MVD": "Montevideo, Uruguay",
  "PTY": "Panama City, Panama",
  "SAL": "San Salvador, El Salvador",
  "GUA": "Guatemala City, Guatemala",
  "MGA": "Managua, Nicaragua",
  "SJO": "San José, Costa Rica",
  "BZE": "Belize City, Belize",
  "SDQ": "Santo Domingo, Dominican Republic",
  // Asia & Pacific
  "NRT": "Tokyo, Japan",
  "HND": "Tokyo Haneda, Japan",
  "DXB": "Dubai, UAE",
  "DOH": "Doha, Qatar",
  "AUH": "Abu Dhabi, UAE",
  "BKK": "Bangkok, Thailand",
  "SIN": "Singapore",
  "HKG": "Hong Kong",
  "ICN": "Seoul, South Korea",
  "PEK": "Beijing, China",
  "PVG": "Shanghai, China",
  "SYD": "Sydney, Australia",
  "MEL": "Melbourne, Australia",
  "AKL": "Auckland, New Zealand",
  "DPS": "Bali, Indonesia",
  "KUL": "Kuala Lumpur, Malaysia",
  "MNL": "Manila, Philippines",
  "CGK": "Jakarta, Indonesia",
  "CMB": "Colombo, Sri Lanka",
  "DEL": "New Delhi, India",
  "BOM": "Mumbai, India",
  "BLR": "Bangalore, India",
  // Africa
  "JNB": "Johannesburg, South Africa",
  "CPT": "Cape Town, South Africa",
  "NBO": "Nairobi, Kenya",
  "CMN": "Casablanca, Morocco",
  "RAK": "Marrakech, Morocco",
  "CAI": "Cairo, Egypt",
  "HRG": "Hurghada, Egypt",
  "SSH": "Sharm el-Sheikh, Egypt",
};

const cache = new Map<string, CacheEntry>();
const requestTimestamps: number[] = [];

export function cleanIata(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
}

export const INVALID_IATA_REASON =
  "origin and destination must be 3-letter IATA airport codes (e.g. CUN for Cancún, MIA for Miami) — pass the airport code, not a city name.";

function formatDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nextMonthUtc(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 7);
}

export function addDays(dateString: string, days: number): string | undefined {
  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function datePart(dateString: string | undefined): string {
  if (!dateString) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString);
  if (!match) return "";
  return `${match[3]}${match[2]}`;
}

function formatPrice(price: number | null | undefined, suffix = ""): string {
  return price != null && price > 0 ? `$${price}${suffix}` : NO_PRICE_LABEL;
}

function formatStops(transfers: number | null): string {
  if (transfers == null) return "";
  if (transfers === 0) return "Nonstop";
  return `${transfers} ${transfers === 1 ? "stop" : "stops"}`;
}

function airportsWithNearby(iata: string): string[] {
  const airports = [iata];
  for (const nearbyCode of NEARBY_AIRPORTS_MAP[iata] ?? []) {
    if (!airports.includes(nearbyCode)) airports.push(nearbyCode);
  }
  return airports;
}

function sortedParams(params: Record<string, string | number>): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    searchParams.set(key, String(value));
  }
  return searchParams;
}

function cacheKey(path: string, params: Record<string, string | number>): string {
  return `${path}|${sortedParams(params).toString()}`;
}

function checkRateLimit(): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length < RATE_LIMIT;
}

export async function tpGet(path: string, params: Record<string, string | number>): Promise<TpResult> {
  const key = cacheKey(path, params);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { data: cached.data };
  if (cached) cache.delete(key);

  const token = process.env.TRAVELPAYOUTS_TOKEN?.trim();
  if (!token) {
    if (!warnedNoToken) {
      warnedNoToken = true;
      console.error("TRAVELPAYOUTS_TOKEN is not set — Atlas flight/deal tools cannot run.");
    }
    return { failure: "no_token" };
  }

  if (!checkRateLimit()) return { failure: "rate_limited" };
  // Count the attempt BEFORE the fetch so concurrent bursts and failed
  // requests both consume the window (the old success-only counting made the
  // limiter inert exactly when TP was rejecting).
  requestTimestamps.push(Date.now());

  const url = new URL(path, BASE_URL);
  url.search = sortedParams(params).toString();

  try {
    const response = await fetch(url, {
      headers: { "X-Access-Token": token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return { failure: "http_error" };
    const data = (await response.json()) as TpResponse;
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return { data };
  } catch {
    return { failure: "timeout" };
  }
}

export function rawItems(data: TpResponse): TpFlightItem[] {
  if (!data?.success || !Array.isArray(data.data)) return [];
  return data.data as TpFlightItem[];
}

function normalizeFlights(
  rawItemsList: TpFlightItem[],
  origin: string,
  destination: string,
  departDate: string,
  returnDate?: string
): FlightOption[] {
  return rawItemsList.slice(0, 10).map((item) => ({
    origin,
    destination,
    price: item.price ?? null,
    airline: item.airline,
    flight_number: item.flight_number ?? "",
    departure_at: item.departure_at ?? departDate,
    return_at: item.return_at ?? returnDate,
    transfers: item.transfers ?? null,
    link: buildAviasalesLink(origin, destination, departDate, returnDate),
  }));
}

export async function rawSearchFlights(
  origin: string,
  destination: string,
  departDate: string,
  returnDate?: string
): Promise<{ flights: FlightOption[]; failure?: TpFailure }> {
  const params: Record<string, string | number> = {
    origin,
    destination,
    departure_at: departDate,
    sorting: "price",
    currency: "usd",
    limit: 10,
  };
  if (returnDate) params.return_at = returnDate;

  const first = await tpGet("/aviasales/v3/prices_for_dates", params);
  if ("failure" in first) return { flights: [], failure: first.failure };
  let items = rawItems(first.data);
  if (items.length > 0)
    return { flights: normalizeFlights(items, origin, destination, departDate, returnDate) };

  if (departDate.length === 10) {
    params.departure_at = departDate.slice(0, 7);
    if (returnDate && returnDate.length === 10) params.return_at = returnDate.slice(0, 7);
    const second = await tpGet("/aviasales/v3/prices_for_dates", params);
    if ("failure" in second) return { flights: [], failure: second.failure };
    items = rawItems(second.data);
    if (items.length > 0)
      return { flights: normalizeFlights(items, origin, destination, departDate, returnDate) };
  }

  return { flights: [] };
}

export async function searchFlights(
  origin: string,
  destination: string,
  departDate: string,
  returnDate?: string
): Promise<
  | { flights: FlightCardOption[]; airports_searched: string[]; destinations_searched: string[]; origin: string; destination: string }
  | { flights: []; no_data: true; reason: string; origin: string; destination: string; airports_searched: string[]; destinations_searched: string[] }
> {
  const cleanOrigin = origin?.trim() ? parseIata(origin) : "MIA";
  const cleanDestination = destination?.trim() ? parseIata(destination) : null;
  if (!cleanOrigin || !cleanDestination) {
    return {
      flights: [],
      no_data: true,
      reason: INVALID_IATA_REASON,
      origin: cleanOrigin ?? "",
      destination: cleanDestination ?? "",
      airports_searched: cleanOrigin ? [cleanOrigin] : [],
      destinations_searched: [],
    };
  }

  let effectiveDepartDate = departDate;
  if (!effectiveDepartDate || effectiveDepartDate.toLowerCase() === "flexible") {
    effectiveDepartDate = formatDateOffset(14);
  }

  let effectiveReturnDate = returnDate;
  if (!effectiveReturnDate) {
    effectiveReturnDate = addDays(effectiveDepartDate, 7);
  }

  const airportsToSearch = airportsWithNearby(cleanOrigin);
  // Origin-side fan-out only (matches the Python original): expanding the
  // destination multiplied TP calls 4x and could exhaust the 200/hr budget.
  const destinationsToSearch = [cleanDestination];
  const failures: TpFailure[] = [];
  const results = await Promise.all(
    airportsToSearch.flatMap((airport) =>
      destinationsToSearch.map(async (dest) => {
        try {
          const r = await rawSearchFlights(airport, dest, effectiveDepartDate, effectiveReturnDate);
          if (r.failure) failures.push(r.failure);
          return r.flights;
        } catch {
          return [];
        }
      })
    )
  );

  const flights = results
    .flat()
    .sort((a, b) => (a.price ?? 999999) - (b.price ?? 999999))
    .slice(0, 10)
    .map((flight) => ({
      airline: airlineDisplayName(flight.airline),
      route: `${flight.origin} → ${flight.destination}`,
      price: formatPrice(flight.price, flight.return_at && (flight.price ?? 0) > 0 ? " round-trip" : ""),
      duration: "",
      stops: formatStops(flight.transfers),
      depart_date: flight.departure_at,
      return_date: flight.return_at ?? "",
      book_url: flight.link,
    }));

  if (flights.length === 0) {
    return {
      flights: [],
      no_data: true,
      reason: failures.length > 0
        ? FAILURE_REASONS[
            (["no_token", "rate_limited", "timeout", "http_error"] as TpFailure[]).find((f) =>
              failures.includes(f)
            ) ?? failures[0]
          ]
        : "TP API returned no flights for this route and date range (specific-date + month fallback both empty)",
      origin: cleanOrigin,
      destination: cleanDestination,
      airports_searched: airportsToSearch,
      destinations_searched: destinationsToSearch,
    };
  }

  return {
    flights,
    airports_searched: airportsToSearch,
    destinations_searched: destinationsToSearch,
    origin: cleanOrigin,
    destination: cleanDestination,
  };
}

export async function getDeals(
  origin: string,
  destination?: string
): Promise<{ deals: DealCardOption[] } | { deals: []; no_data: true; reason: string }> {
  const cleanOrigin = origin?.trim() ? parseIata(origin) : "MIA";
  if (!cleanOrigin) {
    return { deals: [], no_data: true, reason: INVALID_IATA_REASON };
  }
  let cleanDestination: string | undefined;
  if (destination?.trim()) {
    const parsed = parseIata(destination);
    if (!parsed) return { deals: [], no_data: true, reason: INVALID_IATA_REASON };
    cleanDestination = parsed;
  }
  const today = new Date().toISOString().slice(0, 7);
  const params = {
    origin: cleanOrigin,
    ...(cleanDestination ? { destination: cleanDestination } : {}),
    departure_at: today,
    sorting: "price",
    currency: "usd",
    limit: 5,
  };

  const result = await tpGet("/aviasales/v3/prices_for_dates", params);
  if ("failure" in result) {
    return { deals: [], no_data: true, reason: FAILURE_REASONS[result.failure] };
  }
  const items = rawItems(result.data);
  if (items.length === 0) {
    return { deals: [], no_data: true, reason: "TP API returned no deals for this origin" };
  }

  const deals = items.slice(0, 5).map((item) => {
    const dest = cleanIata(item.destination ?? "");
    const depart = item.departure_at ?? "";
    return {
      date: depart.slice(0, 10) || depart,
      destination: dest,
      price: formatPrice(item.price),
      savings_pct: 0,
      search_url: buildAviasalesLink(cleanOrigin, dest, depart),
    };
  });

  return { deals };
}

export async function getPopularRoutes(
  origin: string
): Promise<{ suggestions: DestinationSuggestion[] } | { suggestions: []; no_data: true; reason: string }> {
  const cleanOrigin = origin?.trim() ? parseIata(origin) : "MIA";
  if (!cleanOrigin) {
    return { suggestions: [], no_data: true, reason: INVALID_IATA_REASON };
  }
  const month = nextMonthUtc();
  const params = {
    origin: cleanOrigin,
    departure_at: month,
    return_at: month, // round-trip pricing, matching the Python original
    sorting: "price",
    currency: "usd",
    limit: 5, // server sorts by price; we only ever used the first 5 of 100
  };

  const result = await tpGet("/aviasales/v3/prices_for_dates", params);
  if ("failure" in result) {
    return { suggestions: [], no_data: true, reason: FAILURE_REASONS[result.failure] };
  }
  const items = rawItems(result.data);
  if (items.length === 0) {
    return { suggestions: [], no_data: true, reason: "TP API returned no popular routes for this origin" };
  }

  const suggestions = items.slice(0, 5).map((item) => {
    const dest = cleanIata(item.destination ?? "");
    return {
      city: IATA_TO_CITY[dest] ?? dest,
      tagline: `Popular route from ${cleanOrigin}`,
      estimated_flight: item.price && item.price > 0 ? `$${item.price}` : "—",
    };
  });

  return { suggestions };
}

export function buildAviasalesLink(origin: string, destination: string, departDate: string, returnDate?: string): string {
  const cleanOrigin = cleanIata(origin);
  const cleanDestination = cleanIata(destination);
  const departPart = datePart(departDate);
  const returnPart = datePart(returnDate);
  return `https://www.aviasales.com/search/${cleanOrigin}${departPart}${cleanDestination}${returnPart}1?marker=${TP_CONFIG.marker}`;
}
