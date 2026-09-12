export interface HelpSection {
  heading: string;
  text: string;
}

export interface HelpPageContent {
  title: string;
  intro: string;
  sections: HelpSection[];
}

export const HELP_CONTENT: Record<string, HelpPageContent> = {
  "home": {
    title: "Welcome to TravelPlanInfo",
    intro: "Your AI-powered travel planning companion.",
    sections: [
      { heading: "How to get started", text: "Create an account to unlock personalized trip planning, deal alerts, and Atlas — your AI travel concierge." },
      { heading: "Hot Deals", text: "Curated travel deals matched to your preferences and budget. Update your profile to get better matches." },
    ]
  },
  "planner-new": {
    title: "Plan a New Trip",
    intro: "Tell us where, when, and how you want to travel. No account needed — you can plan as a guest and save later.",
    sections: [
      { heading: "Where are you going?", text: "Enter your destination, or click 'Surprise Me' to let Atlas suggest destinations based on your interests and budget. In Surprise Me mode, pick one or more vibes (Beach, Mountains, Winter Escapade, Food, Romantic, Nightlife, Family, and more) and optionally type a region hint. At least 2 interests are required so Atlas knows what to recommend." },
      { heading: "When are you traveling?", text: "Set your travel dates, or check 'I'm flexible' to let Atlas find the cheapest dates. When flexible, choose a travel window (next month, 2-3 months, etc.) and trip length (weekend, week, 2+ weeks). Or click 'Let Atlas find the cheapest dates' to let Atlas pick the absolute best deal regardless of timing." },
      { heading: "What's your budget?", text: "Choose Budget, Mid-range, or Luxury. These labels map to your custom dollar thresholds set in Preferences. You can customize what each tier means to you." },
      { heading: "What interests you?", text: "Pick activities you enjoy — Atlas uses these to suggest daily itinerary activities. New: Romance and Family Travel are now available as presets. Click 'Add your own' to type custom interests (comma-separated or press Enter for each). Custom interests are saved to your profile if you're registered." },
      { heading: "Atlas Recommends", text: "Selecting 'Atlas Recommends' (formerly 'Let Atlas decide') doesn't replace your interests — it tells Atlas to also suggest activities outside your picks if they're a great fit for your destination." },
      { heading: "Guest planning", text: "You can plan a full trip without signing in. Your trip is saved temporarily (7 days). Atlas will suggest creating a free account after you've built up your itinerary so you can keep it forever." },
    ]
  },
  "planner-itinerary": {
    title: "Your Trip Itinerary",
    intro: "Build your day-by-day travel plan with Atlas, your AI travel concierge.",
    sections: [
      { heading: "Getting started", text: "Your itinerary opens with a placeholder row per day. Atlas does not search on its own — ask it in chat, or add items yourself." },
      { heading: "Adding items", text: "Click '+ Add Item' on any day to add flights, hotels, activities, dining, restaurants, or transportation. Click an item to edit its title, description, or budget tier. Changes save instantly." },
      { heading: "Flight search", text: "Ask for flights in chat and Atlas searches live flight prices for your route and dates. Results open in a window where you can sort, pick flights, assign each one to a day, and add them to the itinerary in one go." },
      { heading: "Hotels, activities, restaurants", text: "Atlas does not have live inventory for these. It gives practical guidance — neighborhoods, price expectations, what to look for — and a trusted partner search link. It never invents listings or prices." },
      { heading: "Atlas chat", text: "Ask Atlas anything about your trip — Atlas searches live flight prices, current flight deals, TPI destination guides, and surprise destination ideas. Atlas knows what's already in your itinerary and suggests complementary ideas. If Atlas reaches its monthly usage limit, it pauses until next month and says so honestly." },
      { heading: "When nothing matches", text: "If no destination fits every vibe you picked, Atlas says so honestly and offers real ways forward: match any of your vibes instead of all of them, try a different month, or ask Atlas in chat — it already knows your starting city, month, and vibes. Atlas never fills the gap with made-up destinations or prices." },
      { heading: "Recommended Bookings", text: "The right sidebar shows affiliate booking links matched to your destination. Click 'Find Hotels' or 'Search Flights' to compare prices, or '+ Add to Itinerary' to add directly to your plan." },
      { heading: "Days", text: "Click the day header to collapse/expand. Click '+ Add Day' to extend your trip. Days are auto-calculated from your travel dates." },
    ]
  },
  "preferences": {
    title: "Your Travel Preferences",
    intro: "Customize how Atlas and TPI work for you.",
    sections: [
      { heading: "Home Airport", text: "Your default departure airport (IATA code like MIA, JFK, LAX). Atlas uses this to search flights from your location." },
      { heading: "Budget Tiers", text: "The three tiers (Budget, Mid-range, Luxury) are labels. You define what dollar amount each means to you. Default: Budget < $100/day, Mid $100-250/day, Luxury $250+/day." },
      { heading: "Interests", text: "Pick from preset options or add your own custom interests. 'Let Atlas decide' works alongside your picks — it tells Atlas to also suggest things outside your selections." },
      { heading: "Deal Alerts", text: "When enabled, you'll receive notifications when prices drop below your threshold on routes and destinations you've searched." },
      { heading: "Assistant Style", text: "Choose how Atlas communicates: concise (quick answers), detailed (thorough explanations), or friendly (casual tone)." },
    ]
  },
  "article": {
    title: "Travel Guide",
    intro: "Expert travel content with booking links.",
    sections: [
      { heading: "Booking links", text: "Orange 'Book Now' or 'Search' buttons are affiliate links to trusted travel partners (Hotels.com, Vrbo, CruiseDirect, Aviasales). You pay the same price — we earn a small commission that supports TPI." },
      { heading: "Deal Alerts sidebar", text: "Enter your email in the hero section to get weekly price drop alerts on flights, hotels, and cruises." },
    ]
  },
  "guides": {
    title: "Travel Guides",
    intro: "Browse our collection of destination guides and travel tips.",
    sections: [
      { heading: "Finding articles", text: "Articles are organized by destination and topic. Each guide includes practical tips and booking links." },
    ]
  },
  "hot-deals": {
    title: "Hot Deals",
    intro: "Our travel booking partners for hotels, vacation rentals, car rentals, and cruises.",
    sections: [
      { heading: "How this page works", text: "This page is a directory of our affiliate partners: Hotels.com, Vrbo, EconomyBookings, and CruiseDirect. Each card links straight to that partner's own search." },
      { heading: "Why we don't show prices", text: "A flight price needs a departure airport and travel dates; a hotel rate needs dates and a city. This page has neither, so any number here would be invented. The Planner and Atlas search live flight prices once they know your origin and dates, and partner sites show real current prices when you click through." },
      { heading: "Booking", text: "Click any deal to compare prices on our partner sites. You pay the same price — we earn a small commission that supports TPI." },
    ]
  },
};
