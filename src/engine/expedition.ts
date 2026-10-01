import { actionLabel, actionSpecs, parseAction, spokenLine } from "./actions.ts";
import {
  HOURS_PER_TURN,
  KIND_COLORS,
  MAX_CLIMBERS,
  MAX_STANDING_ORDERS,
  MAX_TURNS_DEFAULT,
  PEAK,
  START_ENERGY,
  START_FOOD,
  START_O2,
  TALK_MAX,
  WEATHER_CHAIN,
  WEATHER_TEMP,
  WEATHER_WIND,
  direction,
  inDeathZone,
  isNeighbor,
  site,
} from "./peak.ts";
import { HEURISTIC_PROFILES, heuristicStyleFor } from "./heuristic.ts";
import { mulberry32, pickSeed } from "./rng.ts";
import type {
  Action,
  Cache,
  Climber,
  ClimberKind,
  Expedition,
  HeuristicStyle,
  Item,
  LogEvent,
  SiteId,
  Weather,
  WeatherState,
} from "./types.ts";

export type CreateOpts = {
  seed?: number;
  maxTurns?: number;
  weatherLock?: Weather;
  hazards?: boolean;
  id?: string;
};

function emptyCaches(): Record<SiteId, Cache> {
  const caches = {} as Record<SiteId, Cache>;
  for (const id of PEAK.route) caches[id] = { o2: 0, food: 0 };
  return caches;
}

function lerp(rng: () => number, lo: number, hi: number): number {
  return Math.round(lo + rng() * (hi - lo));
}

function weatherState(sky: Weather, rng: () => number): WeatherState {
  const window: WeatherState["window"] =
    sky === "clear" ? "good" : sky === "storm" ? "closed" : "poor";
  return {
    sky,
    tempC: lerp(rng, ...WEATHER_TEMP[sky]),
    windKph: lerp(rng, ...WEATHER_WIND[sky]),
    window,
  };
}

function nextSky(current: Weather, rng: () => number): Weather {
  const table = WEATHER_CHAIN[current];
  let roll = rng();
  for (const [sky, p] of table) {
    roll -= p;
    if (roll <= 0) return sky;
  }
  return current;
}

function pushLog(exp: Expedition, event: Omit<LogEvent, "turn">): void {
  exp.log.push({ turn: exp.turn, ...event });
  if (exp.log.length > 200) exp.log.splice(0, exp.log.length - 200);
}

export function clock(turn: number, hoursPerTurn = HOURS_PER_TURN): { day: number; phase: string; hour: number } {
  const hour = (turn * hoursPerTurn) % 24;
  const day = Math.floor((turn * hoursPerTurn) / 24) + 1;
  const phase = hour < 6 ? "night" : hour < 12 ? "dawn" : hour < 18 ? "day" : "dusk";
  return { day, phase, hour };
}

export function createExpedition(opts: CreateOpts = {}): Expedition {
  const seed = pickSeed(opts.seed);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const sky: Weather = opts.weatherLock ?? "clear";
  const exp: Expedition = {
    id: opts.id ?? `exp_${seed.toString(16)}`,
    seed,
    turn: 0,
    maxTurns: opts.maxTurns ?? MAX_TURNS_DEFAULT,
    hoursPerTurn: HOURS_PER_TURN,
    status: "staging",
    weather: weatherState(sky, rng),
    weatherLock: opts.weatherLock,
    hazards: opts.hazards !== false,
    caches: emptyCaches(),
    climbers: [],
    pending: {},
    log: [],
    talk: [],
  };
  pushLog(exp, {
    type: "system",
    message: `${PEAK.name} ${PEAK.summitAlt} m. Seed ${seed}. Summit and return to Base Camp.`,
  });
  pushLog(exp, {
    type: "weather",
    message: skyLine(exp.weather),
  });
  return exp;
}

export function skyLine(w: WeatherState): string {
  const sign = w.tempC > 0 ? "+" : "";
  return `${w.sky.toUpperCase()}  ${sign}${w.tempC}°C  wind ${w.windKph} kph  window ${w.window}`;
}

export function clipStandingOrders(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.replace(/\r\n/g, "\n").trim().slice(0, MAX_STANDING_ORDERS);
  return t || undefined;
}

export type ClimberProfile = {
  standingOrders?: string;
  style?: HeuristicStyle;
  persona?: string;
};

export function registerClimber(
  exp: Expedition,
  name: string,
  kind: ClimberKind,
  color?: string,
  profile?: ClimberProfile,
): { ok: true; climber: Climber } | { ok: false; error: string } {
  if (exp.status === "ended") return { ok: false, error: "expedition has ended" };
  if (exp.climbers.length >= MAX_CLIMBERS) return { ok: false, error: "rope is full (16)" };
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed) return { ok: false, error: "name required" };
  if (exp.climbers.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, error: "name already on the mountain" };
  }
  const style = kind === "heuristic" ? (profile?.style ?? heuristicStyleFor(trimmed)) : undefined;
  const climber: Climber = {
    id: `agt_${crypto.randomUUID().slice(0, 8)}`,
    name: trimmed,
    kind,
    color: color ?? KIND_COLORS[kind] ?? "#9aa4ad",
    location: "bc",
    energy: START_ENERGY,
    food: START_FOOD,
    o2: START_O2,
    ams: 0,
    frostbite: 0,
    starve: 0,
    strikes: 0,
    hasSummit: false,
    alive: true,
    lastResult: "roped in at Base Camp",
    persona: profile?.persona ?? (style ? HEURISTIC_PROFILES[style].title : undefined),
    style,
    standingOrders: clipStandingOrders(profile?.standingOrders),
  };
  exp.climbers.push(climber);
  if (exp.status === "staging") exp.status = "climbing";
  pushLog(exp, { type: "join", climberId: climber.id, message: `${climber.name} roped in at Base Camp.` });
  return { ok: true, climber };
}

export function submitAction(
  exp: Expedition,
  climberId: string,
  raw: unknown,
): { ok: true; action: Action } | { ok: false; error: string } {
  if (exp.status === "ended") return { ok: false, error: "expedition has ended" };
  const climber = exp.climbers.find((c) => c.id === climberId);
  if (!climber) return { ok: false, error: "unknown climber" };
  if (!climber.alive) return { ok: false, error: "you are no longer on the mountain" };
  if (exp.pending[climberId]) return { ok: false, error: "already committed this turn" };
  const parsed = parseAction(raw);
  if (!parsed.ok) {
    climber.strikes += 1;
    climber.lastResult = `illegal: ${parsed.error}`;
    return parsed;
  }
  const vet = vetAction(exp, climber, parsed.action);
  if (!vet.ok) {
    climber.strikes += 1;
    climber.lastResult = `illegal: ${vet.error}`;
    return vet;
  }
  climber.strikes = 0;
  exp.pending[climberId] = parsed.action;
  climber.lastAction = actionLabel(parsed.action);
  pushTalk(exp, climber, parsed.action);
  return { ok: true, action: parsed.action };
}

function pushTalk(exp: Expedition, climber: Climber, action: Action): void {
  const text = spokenLine(action);
  const specs = actionSpecs(action);
  climber.lastSay = text;
  climber.lastSpecs = specs;
  exp.talk.push({
    turn: exp.turn,
    climberId: climber.id,
    name: climber.name,
    color: climber.color,
    text,
    specs,
  });
  if (exp.talk.length > TALK_MAX) exp.talk.splice(0, exp.talk.length - TALK_MAX);
}

export function vetAction(
  exp: Expedition,
  climber: Climber,
  action: Action,
): { ok: true } | { ok: false; error: string } {
  if (action.act === "move") {
    if (!isNeighbor(climber.location, action.to)) {
      return { ok: false, error: `${action.to} is not adjacent to ${climber.location}` };
    }
    if (exp.weather.sky === "storm" && direction(climber.location, action.to) === "up") {
      return { ok: false, error: "storm closed the upward window" };
    }
    return { ok: true };
  }
  if (action.act === "cache") {
    if (climber[action.item] < action.qty) {
      return { ok: false, error: `not enough ${action.item} to cache` };
    }
    return { ok: true };
  }
  if (action.act === "take") {
    if (exp.caches[climber.location][action.item] < action.qty) {
      return { ok: false, error: `no ${action.item} in the cache here` };
    }
    return { ok: true };
  }
  return { ok: true };
}

export function living(exp: Expedition): Climber[] {
  return exp.climbers.filter((c) => c.alive);
}

export function allCommitted(exp: Expedition): boolean {
  const live = living(exp);
  return live.length > 0 && live.every((c) => exp.pending[c.id]);
}

function moveCost(exp: Expedition, climber: Climber, to: SiteId): number {
  const from = site(climber.location);
  const dest = site(to);
  const up = dest.alt >= from.alt;
  let cost = up ? 26 : 16;
  cost += Math.round(Math.abs(dest.alt - from.alt) / 450);
  if (exp.weather.sky === "wind") cost += 8;
  if (exp.weather.sky === "snow") cost += 10;
  if (exp.weather.sky === "storm") cost += 14;
  cost += climber.ams * 6;
  cost += climber.frostbite * 4;
  if (inDeathZone(to) && climber.o2 < 1) cost += 12;
  return cost;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function useO2IfNeeded(climber: Climber, at: SiteId): boolean {
  if (!inDeathZone(at)) return false;
  if (climber.o2 < 1) return false;
  climber.o2 -= 1;
  return true;
}

function icefallRisk(exp: Expedition, climber: Climber, from: SiteId, to: SiteId): number {
  if (!exp.hazards) return 0;
  const involved = site(from).hazard === "icefall" || site(to).hazard === "icefall";
  if (!involved) return 0;
  let p = 0.03;
  if (climber.energy < 35) p += 0.08;
  if (exp.weather.sky === "storm") p += 0.08;
  if (exp.weather.sky === "wind") p += 0.03;
  return p;
}

function kill(exp: Expedition, climber: Climber, cause: string): void {
  climber.alive = false;
  climber.cause = cause;
  climber.lastResult = cause;
  pushLog(exp, { type: "death", climberId: climber.id, message: `${climber.name} — ${cause}` });
}

export function resolveTurn(exp: Expedition, rng = mulberry32(exp.seed + exp.turn * 997)): void {
  if (exp.status === "ended") return;
  if (exp.status === "staging") return;

  const order = living(exp);
  for (const c of order) {
    if (!exp.pending[c.id]) {
      const waitAct: Action = { act: "wait", say: "holding", why: "Turn window closed." };
      exp.pending[c.id] = waitAct;
      c.lastAction = "wait (timeout)";
      pushTalk(exp, c, waitAct);
    }
  }

  const usedO2 = new Set<string>();

  for (const c of order) {
    const a = exp.pending[c.id];
    if (a?.act === "radio") {
      pushLog(exp, { type: "radio", climberId: c.id, message: `${c.name}: “${a.msg}”` });
      c.lastResult = "radio sent";
    }
  }

  for (const c of order) {
    const a = exp.pending[c.id];
    if (a?.act !== "cache") continue;
    c[a.item] -= a.qty;
    exp.caches[c.location][a.item] += a.qty;
    c.lastResult = `cached ${a.qty} ${a.item} at ${site(c.location).name}`;
    pushLog(exp, { type: "cache", climberId: c.id, message: `${c.name} cached ${a.qty} ${a.item} at ${site(c.location).name}.` });
  }

  for (const c of order) {
    const a = exp.pending[c.id];
    if (a?.act !== "take") continue;
    const pile = exp.caches[c.location];
    const got = Math.min(a.qty, pile[a.item]);
    pile[a.item] -= got;
    c[a.item] += got;
    c.lastResult = `took ${got} ${a.item}`;
    pushLog(exp, { type: "take", climberId: c.id, message: `${c.name} took ${got} ${a.item} at ${site(c.location).name}.` });
  }

  for (const c of order) {
    const a = exp.pending[c.id];
    if (a?.act !== "rest") continue;
    restClimber(exp, c, usedO2);
  }

  for (const c of order) {
    const a = exp.pending[c.id];
    if (a?.act !== "wait" && a?.act !== "radio") continue;
    if (a.act === "radio") {
      waitClimber(exp, c, usedO2, true);
    } else {
      waitClimber(exp, c, usedO2, false);
    }
  }

  for (const c of order) {
    const a = exp.pending[c.id];
    if (a?.act !== "move") continue;
    doMove(exp, c, a.to, rng, usedO2);
  }

  for (const c of living(exp)) {
    if (c.location === "summit" && !c.hasSummit) {
      c.hasSummit = true;
      c.lastResult = (c.lastResult ? c.lastResult + " · " : "") + "SUMMIT";
      pushLog(exp, { type: "summit", climberId: c.id, message: `${c.name} stood on Thalun.` });
    }
  }

  for (const c of living(exp)) {
    if (inDeathZone(c.location) && !usedO2.has(c.id) && c.o2 > 0) {
      c.o2 -= 1;
      usedO2.add(c.id);
    }
  }

  for (const c of living(exp)) {
    if (c.food < 1) {
      c.starve += 1;
      c.energy = clamp(c.energy - 12, 0, 100);
      if (c.starve >= 3) kill(exp, c, "starved");
    } else {
      c.starve = 0;
    }
    if (!c.alive) continue;
    if (inDeathZone(c.location) && !usedO2.has(c.id)) {
      c.ams += 1;
      c.lastResult = `${c.lastResult ?? "exposed"} · altitude sickness +1 (no oxygen)`;
    }
    if (exp.weather.sky === "storm" && c.energy < 30 && inDeathZone(c.location)) {
      c.frostbite += 1;
    }
    if (c.ams >= 3) kill(exp, c, "altitude sickness");
    else if (c.frostbite >= 3) kill(exp, c, "frostbite");
    else if (c.energy <= 0 && inDeathZone(c.location)) kill(exp, c, "collapsed in the death zone");
  }

  const winners = living(exp).filter((c) => c.hasSummit && c.location === "bc");
  for (const w of winners) {
    pushLog(exp, { type: "win", climberId: w.id, message: `${w.name} returned to Base Camp. The mountain yielded.` });
  }

  exp.pending = {};
  exp.turn += 1;

  const sky = exp.weatherLock ?? nextSky(exp.weather.sky, rng);
  exp.weather = weatherState(sky, rng);
  pushLog(exp, { type: "weather", message: skyLine(exp.weather) });

  const live = living(exp);
  if (winners.length > 0 && live.every((c) => c.location === "bc" || !c.alive)) {
    endExpedition(exp, winners.map((w) => w.id), "rope returned");
  } else if (exp.climbers.length > 0 && live.length === 0) {
    endExpedition(exp, [], "the mountain took everyone");
  } else if (exp.turn >= exp.maxTurns) {
    endExpedition(exp, winners.map((w) => w.id), "season closed");
  }
}

function restClimber(exp: Expedition, c: Climber, usedO2: Set<string>): void {
  if (c.food < 1) {
    waitClimber(exp, c, usedO2, false);
    c.lastResult = "no food — rest became wait";
    return;
  }
  c.food -= 1;
  let gain = 34;
  if (exp.weather.sky === "storm") gain -= 10;
  if (exp.weather.sky === "wind") gain -= 4;
  if (c.location === "bc") gain += 8;
  c.energy = clamp(c.energy + gain, 0, 100);
  if (useO2IfNeeded(c, c.location)) usedO2.add(c.id);
  c.lastResult = `rested to ${c.energy} energy`;
  pushLog(exp, { type: "rest", climberId: c.id, message: `${c.name} rested at ${site(c.location).name}.` });
}

function waitClimber(exp: Expedition, c: Climber, usedO2: Set<string>, radioOnly: boolean): void {
  if (c.food > 0 && !radioOnly) c.food -= 1;
  c.energy = clamp(c.energy - (exp.weather.sky === "storm" ? 10 : 6), 0, 100);
  if (useO2IfNeeded(c, c.location)) usedO2.add(c.id);
  if (!radioOnly) {
    c.lastResult = "waited";
    pushLog(exp, { type: "wait", climberId: c.id, message: `${c.name} waited at ${site(c.location).name}.` });
  }
}

function doMove(
  exp: Expedition,
  c: Climber,
  to: SiteId,
  rng: () => number,
  usedO2: Set<string>,
): void {
  const from = c.location;
  if (!isNeighbor(from, to)) {
    c.lastResult = "move failed (not adjacent)";
    return;
  }
  if (exp.weather.sky === "storm" && direction(from, to) === "up") {
    c.energy = clamp(c.energy - 8, 0, 100);
    c.lastResult = "turned around — storm";
    pushLog(exp, { type: "fail", climberId: c.id, message: `${c.name} could not climb into the storm.` });
    return;
  }
  const cost = moveCost(exp, c, to);
  if (c.energy < cost) {
    c.energy = clamp(c.energy - 8, 0, 100);
    c.lastResult = `too tired for ${site(to).name} (need ${cost})`;
    pushLog(exp, { type: "fail", climberId: c.id, message: `${c.name} lacked the legs for ${site(to).name}.` });
    return;
  }
  const risk = icefallRisk(exp, c, from, to);
  if (risk > 0 && rng() < risk) {
    c.energy = clamp(c.energy - 35, 0, 100);
    if (rng() < 0.12) {
      kill(exp, c, "fell in the icefall");
      return;
    }
    c.frostbite = clamp(c.frostbite + (rng() < 0.4 ? 1 : 0), 0, 3);
    c.lastResult = "icefall collapse — held the rope, stayed put";
    pushLog(exp, { type: "fail", climberId: c.id, message: `${c.name} was caught in the icefall and held.` });
    return;
  }
  c.energy -= cost;
  c.location = to;
  if (useO2IfNeeded(c, to)) usedO2.add(c.id);
  const arrow = direction(from, to) === "up" ? "↑" : "↓";
  c.lastResult = `${arrow} ${site(to).name} (−${cost} energy)`;
  pushLog(exp, {
    type: "move",
    climberId: c.id,
    message: `${c.name} ${arrow} ${site(from).name} → ${site(to).name}.`,
  });
}

function endExpedition(exp: Expedition, winnerIds: string[], reason: string): void {
  exp.status = "ended";
  exp.outcome = { winnerIds, endedReason: reason };
  pushLog(exp, { type: "end", message: `Season over: ${reason}.` });
}

export function legalActions(exp: Expedition, climber: Climber): Action[] {
  if (!climber.alive || exp.status === "ended") return [];
  const acts: Action[] = [{ act: "rest" }, { act: "wait" }];
  for (const n of site(climber.location).neighbors) {
    const move: Action = { act: "move", to: n };
    if (vetAction(exp, climber, move).ok) acts.push(move);
  }
  for (const item of ["o2", "food"] as Item[]) {
    if (climber[item] > 0) acts.push({ act: "cache", item, qty: 1 });
    if (exp.caches[climber.location][item] > 0) acts.push({ act: "take", item, qty: 1 });
  }
  return acts;
}

export function publicClimber(c: Climber): Climber {
  return { ...c };
}
