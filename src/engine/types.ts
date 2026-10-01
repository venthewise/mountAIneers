export type SiteId = "bc" | "c1" | "c2" | "c3" | "c4" | "summit";
export type Weather = "clear" | "wind" | "snow" | "storm";
export type Item = "o2" | "food";
export type ClimberKind = "human" | "heuristic" | "llm";
export type HeuristicStyle = "serac" | "cornice" | "scree";
export type ExpeditionStatus = "staging" | "climbing" | "ended";

type WithSay = { say?: string; why?: string };

export type Action =
  | ({ act: "move"; to: SiteId } & WithSay)
  | ({ act: "rest" } & WithSay)
  | ({ act: "wait" } & WithSay)
  | ({ act: "cache"; item: Item; qty: number } & WithSay)
  | ({ act: "take"; item: Item; qty: number } & WithSay)
  | ({ act: "radio"; msg: string } & WithSay);

export type Site = {
  id: SiteId;
  name: string;
  alt: number;
  x: number;
  y: number;
  neighbors: SiteId[];
  hazard?: "icefall";
  blurb: string;
};

export type Peak = {
  id: string;
  name: string;
  range: string;
  summitAlt: number;
  deathZoneAlt: number;
  sites: Record<SiteId, Site>;
  route: SiteId[];
};

export type Cache = { o2: number; food: number };

export type Climber = {
  id: string;
  name: string;
  kind: ClimberKind;
  color: string;
  location: SiteId;
  energy: number;
  food: number;
  o2: number;
  ams: number;
  frostbite: number;
  starve: number;
  strikes: number;
  hasSummit: boolean;
  alive: boolean;
  cause?: string;
  lastAction?: string;
  lastResult?: string;
  lastSay?: string;
  lastSpecs?: string;
  persona?: string;
  style?: HeuristicStyle;
  standingOrders?: string;
};

export type TalkLine = {
  turn: number;
  climberId: string;
  name: string;
  color: string;
  text: string;
  specs?: string;
};

export type LogEvent = {
  turn: number;
  type:
    | "system"
    | "join"
    | "weather"
    | "move"
    | "rest"
    | "wait"
    | "cache"
    | "take"
    | "radio"
    | "fail"
    | "summit"
    | "death"
    | "win"
    | "end";
  climberId?: string;
  message: string;
};

export type WeatherState = {
  sky: Weather;
  tempC: number;
  windKph: number;
  window: "good" | "poor" | "closed";
};

export type Outcome = {
  winnerIds: string[];
  endedReason: string;
};

export type Expedition = {
  id: string;
  seed: number;
  turn: number;
  maxTurns: number;
  hoursPerTurn: number;
  status: ExpeditionStatus;
  weather: WeatherState;
  weatherLock?: Weather;
  hazards: boolean;
  caches: Record<SiteId, Cache>;
  climbers: Climber[];
  pending: Record<string, Action>;
  log: LogEvent[];
  talk: TalkLine[];
  outcome?: Outcome;
};

export type Observation = {
  turn: number;
  maxTurns: number;
  day: number;
  phase: string;
  weather: WeatherState;
  you: Climber;
  site: Site;
  neighbors: { id: SiteId; name: string; alt: number; dir: "up" | "down" }[];
  cacheHere: Cache;
  others: { name: string; location: SiteId; alive: boolean; hasSummit: boolean }[];
  legal: Action[];
  recentLog: string[];
  ended: boolean;
  briefing: string;
  standingOrders?: string;
};
