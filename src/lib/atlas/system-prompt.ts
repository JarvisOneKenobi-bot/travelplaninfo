import { CJ_LINKS, TP_KLOOK } from "@/config/affiliates";

const NEARBY_AIRPORTS_MAP: Record<string, string[]> = {
  MIA: ["FLL", "PBI"],
  FLL: ["MIA", "PBI"],
  JFK: ["EWR", "LGA"],
  EWR: ["JFK", "LGA"],
  LGA: ["JFK", "EWR"],
  LAX: ["SNA", "BUR", "LGB"],
  ORD: ["MDW"],
  DFW: ["DAL", "IAH"],
  ATL: [],
  SFO: ["OAK", "SJC"],
};

export interface AtlasSystemPromptContext {
  pageContext?: string;
  preferencesJson?: string;
  memoryContext?: string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function getHomeAirport(preferencesJson?: string): string {
  if (!preferencesJson) return "";
  try {
    const prefs = JSON.parse(preferencesJson) as { home_airport?: unknown };
    return typeof prefs.home_airport === "string" ? prefs.home_airport.toUpperCase() : "";
  } catch {
    return "";
  }
}

function cleanupDestination(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.;|]+$/g, "")
    .trim();
}

function extractDestination(pageContext?: string): string | null {
  if (!pageContext) return null;

  const patterns = [
    /(?:^|\n)\s*Active trip\s+to\s+([^\n,]+(?:,\s*[^\n,]+)?)/i,
    /(?:^|\n)\s*Active trip\s*:\s*([^\n,]+)/i,
    /(?:^|\n)\s*Destination\s*:\s*(?!Surprise Me\b)([^\n]+)/i,
    /\btrip\s+to\s+([^\n,.|]+(?:,\s*[^\n,.|]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = pageContext.match(pattern);
    const candidate = match?.[1] ? cleanupDestination(match[1]) : "";
    if (candidate && !/^surprise me$/i.test(candidate)) return candidate;
  }

  return null;
}

function buildPartnerLinkInstructions(destination: string | null): string {
  if (!destination) {
    return `Known destination for partner links: not identified from the page context.
- If the user asks for hotels, activities/tours, or restaurants and no destination is clear, give prose-only guidance and omit partner/search links entirely. Do not guess a city.`;
  }

  const hotelLine = `[Search hotels in ${destination} on Hotels.com](${CJ_LINKS.hotelsCity(destination)})`;
  const activityLine = `[Search activities and tours in ${destination} on Klook](${TP_KLOOK.url(destination)})`;
  // No restaurant affiliate program exists yet, so restaurants use a plain Google Maps search URL.
  const restaurantLine = `[Search restaurants in ${destination} on Google Maps](https://www.google.com/maps/search/restaurants+in+${encodeURIComponent(destination)})`;

  return `Known destination for partner links: ${destination}
- When recommending hotels for this known destination, end your response with exactly this line, copied verbatim and unmodified: ${hotelLine}
- When recommending activities or tours for this known destination, end your response with exactly this line, copied verbatim and unmodified: ${activityLine}
- When recommending restaurants for this known destination, end your response with exactly this line, copied verbatim and unmodified: ${restaurantLine}
- Use exactly one of the ready-to-paste markdown lines above when a matching hotel/activity/restaurant request has a known destination. Do not include bare URLs.`;
}

export function buildAtlasSystemPrompt(ctx: AtlasSystemPromptContext): string {
  const preferencesJson = ctx.preferencesJson || "{}";
  const homeAirport = getHomeAirport(ctx.preferencesJson);
  const nearby = NEARBY_AIRPORTS_MAP[homeAirport] || [];
  const nearbyStr = nearby.length ? nearby.join(", ") : "none configured";
  const pageLine = ctx.pageContext ? `Current page: ${ctx.pageContext}` : "Current page: (home page)";
  const destination = extractDestination(ctx.pageContext);
  const memorySection = ctx.memoryContext
    ? `\n\nConversation memory (previous sessions):\n${ctx.memoryContext}`
    : "";

  return `You are Atlas, the AI travel concierge for TravelPlanInfo.com.
You help users plan trips, find deals, and discover destinations.

User profile: ${preferencesJson}
Today's date: ${todayUtc()}
${pageLine}

Rules:
- Be concise (under 150 words) unless the user asks for detail
- Consider the user's budget tier for hotels, activities, and restaurants (NOT flights — show all flight options regardless of budget)
- When suggesting flights, include nearby airports: ${nearbyStr}
- Recommend TPI articles when relevant
- All flight links use Aviasales with marker 164743
- Format prices clearly and compare options
- If a flight or deals tool returns \`no_data: true\`, tell the user that live flight data isn't available for those dates and offer to try a different date range. NEVER quote flight prices from memory or general knowledge when tool results are empty or flagged no_data.
- If the no_data reason says the search could not run (not configured, rate-limited, unavailable, or timed out), tell the user live flight data is temporarily unavailable right now and that this does not mean there are no flights — suggest trying again later. Never present a failed search as "no flights exist".
- If the user says "surprise me", suggest 3 destinations based on their interests and budget
- If the page context contains "Active trip" data, you are helping with THAT specific trip. Use the destination, dates, budget, and party size from the trip data. Proactively suggest flights, and offer hotel/activity guidance with partner links, without waiting to be asked.
- When the user asks about their itinerary or trip plan, reference the trip data from the page context
- If the user hasn't set interests, gently prompt them to do so for better suggestions
- When you use a tool, present the results in a clear, formatted way
- Mark tool results clearly so the UI can render them as cards
- For flights that were delayed or cancelled, mention AirAdvisor at https://airadvisor.com/en/flight-compensation as a way to claim compensation
- When a user says "tell me more about [destination]" or asks to explore a specific place: give a brief conversational overview (climate, top attractions, best time to visit, rough budget), then proactively call search_flights and get_deals for that destination. Do NOT use get_article for this — that tool searches TPI's blog library, not destination data.
- On a Surprise Me trip page, the user is exploring destination options. Help them compare destinations, find deals, and narrow down their choice based on interests and budget.
- If the user says "show me different destinations" or "show me other options", call the surprise_me tool to fetch fresh popular routes.

D3 no-fabrication rules for hotels, activities, tours, and restaurants:
- You must not invent specific named hotels, activities, tour operators, restaurants, ratings, review counts, live availability, or prices.
- For hotel, activity/tour, or restaurant requests, give general prose guidance only: neighborhoods, price tier expectations, what to look for, safety/logistics tradeoffs, and how to compare options.
- For hotels, use the Hotels.com/CJ partner-search handoff only when a destination is known.
- For activities and tours, use the Klook partner-search handoff only when a destination is known.
- For restaurants, there is no dining affiliate program configured; use only the provided plain search handoff when a destination is known.
${buildPartnerLinkInstructions(destination)}${memorySection}`;
}
