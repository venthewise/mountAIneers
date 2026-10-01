import type { Peak, SiteId, Weather } from "./types.ts";

export const PEAK: Peak = {
  id: "thalun",
  name: "Thalun",
  range: "Karakoram",
  summitAlt: 8126,
  deathZoneAlt: 7500,
  route: ["bc", "c1", "c2", "c3", "c4", "summit"],
  sites: {
    bc: {
      id: "bc",
      name: "Base Camp",
      alt: 5280,
      x: 92,
      y: 568,
      neighbors: ["c1"],
      blurb: "Moraine and prayer flags. Eat here for free. The only safe end.",
    },
    c1: {
      id: "c1",
      name: "Camp 1",
      alt: 6050,
      x: 198,
      y: 458,
      neighbors: ["bc", "c2"],
      hazard: "icefall",
      blurb: "The icefall. Seracs calve without warning. Tired legs fall.",
    },
    c2: {
      id: "c2",
      name: "Camp 2",
      alt: 6720,
      x: 312,
      y: 358,
      neighbors: ["c1", "c3"],
      blurb: "Western cwm. Long, bright, and thirsty.",
    },
    c3: {
      id: "c3",
      name: "Camp 3",
      alt: 7350,
      x: 412,
      y: 258,
      neighbors: ["c2", "c4"],
      blurb: "Launch pad. South Col (c4) is next — the only door to the summit. Go.",
    },
    c4: {
      id: "c4",
      name: "South Col",
      alt: 7920,
      x: 508,
      y: 158,
      neighbors: ["c3", "summit"],
      blurb: "South Col. The summit is one camp up. One oxygen bottle pays for this turn. Keep moving.",
    },
    summit: {
      id: "summit",
      name: "Summit",
      alt: 8126,
      x: 586,
      y: 64,
      neighbors: ["c4"],
      blurb: "You are not done. Most of the mountain still sits below you.",
    },
  },
};

export const MAX_CLIMBERS = 16;
export const MAX_STANDING_ORDERS = 1000;
export const START_ENERGY = 100;
export const START_FOOD = 10;
export const START_O2 = 5;
export const MAX_TURNS_DEFAULT = 48;
export const HOURS_PER_TURN = 6;
export const RADIO_MAX = 140;
export const SAY_MAX = 100;
export const WHY_MAX = 160;
export const TALK_MAX = 80;

export const WEATHER_TEMP: Record<Weather, [number, number]> = {
  clear: [-18, -8],
  wind: [-28, -16],
  snow: [-24, -12],
  storm: [-38, -24],
};

export const WEATHER_WIND: Record<Weather, [number, number]> = {
  clear: [8, 28],
  wind: [40, 75],
  snow: [20, 45],
  storm: [80, 140],
};

export const WEATHER_CHAIN: Record<Weather, [Weather, number][]> = {
  clear: [
    ["clear", 0.52],
    ["wind", 0.28],
    ["snow", 0.15],
    ["storm", 0.05],
  ],
  wind: [
    ["clear", 0.28],
    ["wind", 0.38],
    ["snow", 0.22],
    ["storm", 0.12],
  ],
  snow: [
    ["clear", 0.22],
    ["wind", 0.24],
    ["snow", 0.38],
    ["storm", 0.16],
  ],
  storm: [
    ["clear", 0.16],
    ["wind", 0.26],
    ["snow", 0.28],
    ["storm", 0.3],
  ],
};

export function site(id: SiteId) {
  return PEAK.sites[id];
}

export function inDeathZone(id: SiteId): boolean {
  return PEAK.sites[id].alt >= PEAK.deathZoneAlt;
}

export function direction(from: SiteId, to: SiteId): "up" | "down" {
  return PEAK.sites[to].alt >= PEAK.sites[from].alt ? "up" : "down";
}

export function isNeighbor(from: SiteId, to: SiteId): boolean {
  return PEAK.sites[from].neighbors.includes(to);
}

export function uphill(id: SiteId): SiteId | null {
  const here = PEAK.sites[id];
  let best: SiteId | null = null;
  let bestAlt = here.alt;
  for (const n of here.neighbors) {
    if (PEAK.sites[n].alt > bestAlt) {
      best = n;
      bestAlt = PEAK.sites[n].alt;
    }
  }
  return best;
}

export function downhill(id: SiteId): SiteId | null {
  const here = PEAK.sites[id];
  let best: SiteId | null = null;
  let bestAlt = here.alt;
  for (const n of here.neighbors) {
    if (PEAK.sites[n].alt < bestAlt) {
      best = n;
      bestAlt = PEAK.sites[n].alt;
    }
  }
  return best;
}

export const HOUSE_BOTS = [
  { name: "Serac", color: "#7ec8c4" },
  { name: "Cornice", color: "#e8a54b" },
  { name: "Scree", color: "#c17ec8" },
  { name: "Sérac-2", color: "#6ea8fe" },
] as const;

export const KIND_COLORS: Record<string, string> = {
  human: "#e8e4dc",
  heuristic: "#7ec8c4",
  llm: "#6ea8fe",
};
