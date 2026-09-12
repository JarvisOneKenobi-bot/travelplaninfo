"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { PRICE_UNKNOWN, DURATION_UNKNOWN, NO_PRICE_LABEL } from "./types";
import type { FlightResult } from "./types";

function joinNonEmpty(parts: string[], separator: string): string {
  return parts.filter(Boolean).join(separator);
}

// ── Tab definitions ─────────────────────────────────────────────────────────

const TABS = ["Flights", "Summary"] as const;
type TabId = (typeof TABS)[number];

// ── Props ───────────────────────────────────────────────────────────────────

interface TripResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  destination: string;
  dates?: { start: string; end: string };
  adults: number;
  flights: FlightResult[];
  tripId?: number;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function TripResultsModal({
  isOpen,
  onClose,
  destination,
  dates,
  adults,
  flights,
  tripId,
}: TripResultsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("Flights");
  const [flightSort, setFlightSort] = useState<"price" | "duration" | "airline">("price");
  const [selectedFlights, setSelectedFlights] = useState<Set<number>>(new Set());
  const [addingAll, setAddingAll] = useState(false);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);
  // Per-flight selected day (keyed by index in flights)
  const [flightDays, setFlightDays] = useState<Record<number, number>>({});

  const totalSelected = selectedFlights.size;

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  // ── Calculate total trip days ─────────────────────────────────────────

  // Total trip days (inclusive of arrival and departure day)
  const dayCount = useMemo(() => {
    if (!dates?.start || !dates?.end) return 1;
    return Math.ceil((new Date(dates.end).getTime() - new Date(dates.start).getTime()) / 86400000) + 1;
  }, [dates]);

  // ── Sorted data ────────────────────────────────────────────────────────

  const durationKnown = useMemo(
    () => flights.some((f) => f.duration_minutes !== DURATION_UNKNOWN),
    [flights]
  );
  const sortKeys = durationKnown ? (["price", "duration", "airline"] as const)
                                 : (["price", "airline"] as const);

  const sortedFlights = useMemo(() => {
    const sorted = [...flights];
    if (flightSort === "price") sorted.sort((a, b) => a.price_value - b.price_value);
    else if (flightSort === "duration") sorted.sort((a, b) => a.duration_minutes - b.duration_minutes);
    else sorted.sort((a, b) => a.airline.localeCompare(b.airline));
    return sorted;
  }, [flights, flightSort]);

  const pricedFlights = useMemo(() => flights.filter((f) => f.price_value < PRICE_UNKNOWN), [flights]);

  const cheapestFlightValue = useMemo(
    () => pricedFlights.length > 0 ? Math.min(...pricedFlights.map((f) => f.price_value)) : null,
    [pricedFlights]
  );

  // ── Focus trap + escape key ────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    // Save opener element for focus restoration
    openerRef.current = document.activeElement;

    // Focus the close button on open
    requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableSelector =
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(focusableSelector)
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to opener
      if (openerRef.current && openerRef.current instanceof HTMLElement) {
        openerRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  // ── Flight selection toggle ──────────────────────────────────────────

  const toggleSelection = useCallback((setter: React.Dispatch<React.SetStateAction<Set<number>>>, idx: number) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleFlight = useCallback((idx: number) => toggleSelection(setSelectedFlights, idx), [toggleSelection]);

  // ── Summary calculations ───────────────────────────────────────────────

  const summary = useMemo(() => {
    const cheapestFlight = pricedFlights.length > 0 ? Math.min(...pricedFlights.map((f) => f.price_value)) : null;
    const flightTotal = cheapestFlight !== null ? cheapestFlight * adults : null;
    const minTotal = flightTotal;
    const maxTotal = flightTotal;

    return {
      minTotal,
      maxTotal,
    };
  }, [pricedFlights, adults]);

  const formatMoney = useCallback((value: number | null) => {
    if (value === null) return NO_PRICE_LABEL;
    return `$${value.toLocaleString()}`;
  }, []);

  // ── Add All to Itinerary ───────────────────────────────────────────────

  const handleAddAll = useCallback(async () => {
    if (!tripId) {
      setAddedMessage("No active trip. Create a trip first.");
      return;
    }

    setAddingAll(true);
    setAddedMessage(null);

    interface BatchItem {
      day_number: number;
      category: string;
      title: string;
      description: string;
      price_estimate: string;
      affiliate_url: string;
    }

    const items: BatchItem[] = [];

    // Add selected flights (or top of sorted list when nothing is selected)
    if (selectedFlights.size > 0) {
      for (const idx of selectedFlights) {
        const f = flights[idx];
        if (!f) continue;
        const priceForText = f.price === NO_PRICE_LABEL ? "" : f.price;
        items.push({
          day_number: flightDays[idx] || 1,
          category: "flight",
          title: joinNonEmpty([f.airline, f.route], " "),
          description: joinNonEmpty([f.duration, f.stops, priceForText], " - "),
          price_estimate: f.price,
          affiliate_url: f.book_url,
        });
      }
    } else if (sortedFlights.length > 0) {
      // Default when nothing is ticked: add the flight currently at the top of the list (follows the active sort).
      const f = sortedFlights[0];
      const realIdx = flights.indexOf(f);
      const priceForText = f.price === NO_PRICE_LABEL ? "" : f.price;
      items.push({
        day_number: flightDays[realIdx] || 1,
        category: "flight",
        title: joinNonEmpty([f.airline, f.route], " "),
        description: joinNonEmpty([f.duration, f.stops, priceForText], " - "),
        price_estimate: f.price,
        affiliate_url: f.book_url,
      });
    }

    if (items.length === 0) {
      setAddingAll(false);
      setAddedMessage("No items to add.");
      return;
    }

    try {
      const res = await fetch(`/api/trips/${tripId}/items/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      if (res.ok) {
        const data = await res.json();
        setAddedMessage(`Added ${data.items?.length || items.length} items to your itinerary!`);
        // Reload after brief delay so user sees the message
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const err = await res.json().catch(() => ({ error: "Failed to add items" }));
        setAddedMessage(err.error || "Failed to add items");
      }
    } catch {
      setAddedMessage("Network error. Please try again.");
    }

    setAddingAll(false);
  }, [tripId, flights, sortedFlights, selectedFlights, flightDays]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center pt-[5vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-results-title"
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 id="trip-results-title" className="text-xl font-bold text-gray-900">
              Flights: {destination}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {dates ? `${dates.start} - ${dates.end}` : "Flexible dates"}
              {" | "}
              {adults} {adults === 1 ? "adult" : "adults"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close trip results"
            className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div className="px-6 border-b border-gray-200 shrink-0" role="tablist" aria-label="Trip result categories">
          <div className="flex gap-6">
            {TABS.map((tab) => {
              const isActive = activeTab === tab;
              const count = tab === "Flights" ? flights.length : null;
              return (
                <button
                  key={tab}
                  role="tab"
                  id={`tab-${tab}`}
                  aria-selected={isActive}
                  aria-controls={`panel-${tab}`}
                  onClick={() => setActiveTab(tab)}
                  className={[
                    "py-3 text-sm font-medium transition-colors relative",
                    isActive
                      ? "text-orange-600"
                      : "text-gray-500 hover:text-gray-700",
                  ].join(" ")}
                >
                  {tab}
                  {count !== null && (
                    <span className="ml-1 text-xs text-gray-400">({count})</span>
                  )}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Content area ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Flights Tab */}
          <div
            role="tabpanel"
            id="panel-Flights"
            aria-labelledby="tab-Flights"
            className={activeTab === "Flights" ? "" : "hidden"}
          >
            {flights.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No flight results available.</p>
            ) : (
              <>
                {/* Sort toggles */}
                <div className="flex gap-2 mb-4">
                  {sortKeys.map((key) => (
                    <button
                      key={key}
                      onClick={() => setFlightSort(key)}
                      className={[
                        "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                        flightSort === key
                          ? "bg-orange-100 text-orange-700"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                      ].join(" ")}
                    >
                      Sort by {key.charAt(0).toUpperCase() + key.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {sortedFlights.map((f, i) => {
                    const realIdx = flights.indexOf(f);
                    const isCheapest = cheapestFlightValue !== null && f.price_value === cheapestFlightValue;
                    const isSelected = selectedFlights.has(realIdx);
                    const airlineName = f.airline.trim();
                    return (
                      <div
                        key={i}
                        onClick={() => toggleFlight(realIdx)}
                        className={[
                          "cursor-pointer",
                          "bg-white rounded-lg border p-4 hover:shadow-md transition-shadow",
                          isSelected ? "border-orange-400 ring-2 ring-orange-200 bg-orange-50/30" : isCheapest ? "border-green-300 ring-1 ring-green-200" : "border-gray-200",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleFlight(realIdx)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 shrink-0 mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {airlineName && (
                                  <>
                                    <div className="w-7 h-7 bg-gray-100 rounded flex items-center justify-center text-xs font-bold text-gray-500">
                                      {airlineName.charAt(0)}
                                    </div>
                                    <span className="font-medium text-gray-900">{airlineName}</span>
                                  </>
                                )}
                                {isCheapest && (
                                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                                    Best Price
                                  </span>
                                )}
                                {f.nonstop && (
                                  <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-full">
                                    Nonstop
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-500 mt-1">
                                {joinNonEmpty([f.route, f.duration, f.stops], " · ")}
                              </p>
                              {f.depart_date && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {f.depart_date}
                                  {f.return_date ? ` - ${f.return_date}` : " (one-way)"}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-xl text-orange-600">{f.price}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          <a
                            href={f.book_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-full px-4 py-2 transition-colors"
                          >
                            Book on Aviasales
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                          </a>
                          {dayCount > 1 && (
                            <select
                              value={flightDays[realIdx] || 1}
                              onChange={(e) => { e.stopPropagation(); setFlightDays((prev) => ({ ...prev, [realIdx]: Number(e.target.value) })); }}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs border border-gray-200 rounded px-2 py-1.5 text-gray-600"
                            >
                              {Array.from({ length: dayCount }, (_, d) => (
                                <option key={d + 1} value={d + 1}>Day {d + 1}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Summary Tab */}
          <div
            role="tabpanel"
            id="panel-Summary"
            aria-labelledby="tab-Summary"
            className={activeTab === "Summary" ? "" : "hidden"}
          >
            <div className="space-y-6">
              {/* Cost breakdown */}
              <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Cost Breakdown</h3>
                <div className="space-y-3">
                  <div className="border-t border-gray-200 pt-3 flex justify-between text-sm">
                    <span className="font-semibold text-gray-900">Flights (cheapest × adults)</span>
                    <span className="font-bold text-lg text-orange-600">
                      {formatMoney(summary.minTotal)}
                      {summary.maxTotal !== null &&
                        summary.minTotal !== null &&
                        summary.maxTotal > summary.minTotal &&
                        ` - ${formatMoney(summary.maxTotal)}`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Sticky footer ── */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 shrink-0">
          {addedMessage && (
            <p className="text-sm text-center mb-2 text-green-700 font-medium">{addedMessage}</p>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Flights (cheapest × adults){" "}
              <span className="font-bold text-gray-900">
                {formatMoney(summary.minTotal)}
                {summary.maxTotal !== null &&
                  summary.minTotal !== null &&
                  summary.maxTotal > summary.minTotal &&
                  ` - ${formatMoney(summary.maxTotal)}`}
              </span>
            </p>
            <button
              onClick={handleAddAll}
              disabled={addingAll || !tripId}
              className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm px-5 py-2.5 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addingAll ? "Adding..." : totalSelected > 0 ? `Add Selected (${totalSelected}) to Itinerary` : "Add All to Itinerary"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
