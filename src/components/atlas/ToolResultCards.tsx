"use client";

import FlightCard from "./FlightCard";
import DealCard from "./DealCard";
import DestinationCard from "./DestinationCard";
import ArticleCard from "./ArticleCard";

/**
 * Tool-result card renderer moved out of AssistantChat.tsx (Task 6): the
 * dedicated card components for tool results, shared by every chat list.
 * Contained tool failures (is_error results from executeToolSafely) are
 * explained by Atlas's own follow-up text — don't render a raw JSON card.
 */
export default function ToolResultCards({ toolName, data }: { toolName: string; data: Record<string, unknown> }) {
  if (data.is_error) return null;

  // extractTripData skips a search_flights payload whose `flights` is not an
  // array, so this branch is reached in the no-trip-results fallback with
  // truthy non-array bodies — Array.isArray stops `.map` crashing on them
  // (the body falls through to the raw-JSON pre).
  if (toolName === "search_flights" && Array.isArray(data.flights)) {
    const flights = data.flights as Array<Record<string, string>>;
    return (
      <div className="space-y-2 my-2">
        {flights.map((f, i) => (
          <FlightCard key={i} flight={f as never} />
        ))}
      </div>
    );
  }

  if (toolName === "get_deals" && data.deals) {
    const deals = data.deals as Array<Record<string, unknown>>;
    return (
      <div className="space-y-2 my-2">
        {deals.map((d, i) => (
          <DealCard key={i} deal={d as never} />
        ))}
      </div>
    );
  }

  if (toolName === "surprise_me" && data.suggestions) {
    const suggestions = data.suggestions as Array<Record<string, unknown>>;
    return (
      <div className="space-y-2 my-2">
        {suggestions.map((s, i) => (
          <DestinationCard key={i} destination={s as never} />
        ))}
      </div>
    );
  }

  if (toolName === "get_article" && data.articles) {
    const articles = data.articles as Array<Record<string, string>>;
    return (
      <div className="space-y-2 my-2">
        {articles.map((a, i) => (
          <ArticleCard key={i} article={a as never} />
        ))}
      </div>
    );
  }

  // Fallback: show raw JSON
  return (
    <pre className="text-xs bg-gray-50 rounded p-2 overflow-x-auto my-2">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}