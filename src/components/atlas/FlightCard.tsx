"use client";

import { useTranslations } from "next-intl";

interface FlightData {
  airline: string;
  route: string;
  price: string;
  duration: string;
  stops: string;
  depart_date?: string;
  return_date?: string;
  book_url: string;
}

export default function FlightCard({ flight }: { flight: FlightData }) {
  const t = useTranslations("atlas");
  const flightMeta = [flight.route, flight.duration, flight.stops].filter(Boolean).join(" · ");
  const airline = flight.airline.trim();
  return (
    <div data-testid="flight-card" className="bg-white rounded-lg shadow-sm border border-gray-100 p-3 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* Airline logo placeholder + name */}
          {airline && (
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gray-100 rounded flex items-center justify-center text-xs font-bold text-gray-500">
                {airline.charAt(0)}
              </div>
              <p className="font-medium text-sm text-gray-900 truncate">{airline}</p>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-1">{flightMeta}</p>
          {flight.depart_date && (
            <p className="text-xs text-gray-400 mt-0.5">
              {flight.depart_date}
              {flight.return_date ? ` - ${flight.return_date}` : " (one-way)"}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="font-bold text-lg text-orange-600 whitespace-nowrap">{flight.price}</p>
        </div>
      </div>
      <a
        href={flight.book_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-full px-3 py-1.5 transition-colors"
      >
        {t("bookOnAviasales")}
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </a>
    </div>
  );
}
