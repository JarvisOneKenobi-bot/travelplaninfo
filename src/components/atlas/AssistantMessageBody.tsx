"use client";

import { memo, useMemo } from "react";
import { getTextSummary, parseMessageContent } from "./trip-data";
import { getTripFlights } from "./trip-flights-cache";
import { renderMarkdownLite } from "./markdown-lite";
import ToolResultCards from "./ToolResultCards";
import FlightCard from "./FlightCard";
import type { FlightResult } from "./types";

// Results from these tools render as inline flight cards directly in the
// message body — the visibility `main` always had (Task 6) — and, once
// streaming ends, also power the "Add to itinerary" button. Every other tool
// result still renders through ToolResultCards. Opening the results window is
// gated on usable results (flights.length > 0), not on this set.
const TRIP_TOOLS = new Set(["search_flights"]);

interface AssistantMessageBodyProps {
  content: string;
  isStreaming: boolean;
  onOpenResults: (flights: FlightResult[]) => void;
}

function AssistantMessageBody({ content, isStreaming, onOpenResults }: AssistantMessageBodyProps) {
  const parsed = useMemo(() => parseMessageContent(content), [content]);
  // ONE extraction per distinct message content, shared by both chat lists and
  // the sidebar via trip-flights-cache.ts — never per render.
  const flights = getTripFlights(content);
  const hasTripResults = flights.length > 0;

  return (
    <div>
      {hasTripResults ? (
        <>
          {/* Text summary only (tool JSON stripped) */}
          {(() => {
            const summary = getTextSummary(parsed);
            return summary ? (
              <span
                dangerouslySetInnerHTML={{
                  __html: renderMarkdownLite(summary),
                }}
              />
            ) : null;
          })()}
          {/* ALL flight cards inline, exactly like the legacy single-tool path */}
          <div className="space-y-2 my-2">
            {flights.map((f, i) => (
              <FlightCard key={i} flight={f} />
            ))}
          </div>
          {/* Non-trip tool results render inline as before */}
          {parsed
            .filter(
              (p) =>
                p.type === "tool" &&
                p.toolName &&
                !TRIP_TOOLS.has(p.toolName) &&
                p.data
            )
            .map((part, i) => (
              <ToolResultCards
                key={`nontool-${i}`}
                toolName={part.toolName!}
                data={part.data!}
              />
            ))}
          {/* Modal entry point — only once streaming is complete */}
          {!isStreaming && (
            <button
              onClick={() => onOpenResults(flights)}
              className="mt-3 w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              Add to itinerary
            </button>
          )}
        </>
      ) : (
        /* Standard rendering for messages without usable flight results */
        parsed.map((part, i) => {
          if (part.type === "tool" && part.toolName && part.data) {
            return (
              <ToolResultCards
                key={i}
                toolName={part.toolName}
                data={part.data}
              />
            );
          }
          return (
            <span
              key={i}
              dangerouslySetInnerHTML={{
                __html: renderMarkdownLite(part.text || ""),
              }}
            />
          );
        })
      )}
      {isStreaming && (
        <span className="inline-flex gap-1 ml-1">
          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </span>
      )}
    </div>
  );
}

// Presentational component: re-renders only when the message body itself
// changes (onOpenResults must stay referentially stable — AssistantChat pins
// it with a useCallback holding no reactive deps).
export default memo(AssistantMessageBody);