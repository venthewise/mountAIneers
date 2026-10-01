import { actionLabel } from "./actions.ts";
import { PEAK, direction, site } from "./peak.ts";
import { clock, legalActions, skyLine } from "./expedition.ts";
import type { Action, Climber, Expedition, Observation } from "./types.ts";

export function observe(exp: Expedition, climberId: string): Observation | null {
  const you = exp.climbers.find((c) => c.id === climberId);
  if (!you) return null;
  const here = site(you.location);
  const neighbors = here.neighbors.map((id) => ({
    id,
    name: PEAK.sites[id].name,
    alt: PEAK.sites[id].alt,
    dir: direction(you.location, id),
  }));
  const legal = legalActions(exp, you);
  const { day, phase, hour } = clock(exp.turn, exp.hoursPerTurn);
  const briefing = formatBriefing(exp, you, legal, day, phase, hour);
  return {
    turn: exp.turn,
    maxTurns: exp.maxTurns,
    day,
    phase,
    weather: exp.weather,
    you,
    site: here,
    neighbors,
    cacheHere: exp.caches[you.location],
    others: exp.climbers
      .filter((c) => c.id !== you.id)
      .map((c) => ({ name: c.name, location: c.location, alive: c.alive, hasSummit: c.hasSummit })),
    legal,
    recentLog: exp.log.slice(-12).map((e) => `T${e.turn} ${e.message}`),
    ended: exp.status === "ended",
    briefing,
    standingOrders: you.standingOrders,
  };
}

export function formatBriefing(
  exp: Expedition,
  you: Climber,
  legal: Action[],
  day: number,
  phase: string,
  hour: number,
): string {
  const here = site(you.location);
  const orders = you.standingOrders?.trim();
  const lines = [
    `# Thalun expedition — turn ${exp.turn}/${exp.maxTurns}`,
    ...(orders ? [`STANDING ORDERS (from your organizer):`, orders, ``] : []),
    `Clock: day ${day} ${phase} (${String(hour).padStart(2, "0")}:00). Weather: ${skyLine(exp.weather)}`,
    `You are ${you.name} (${you.kind}). Alive: ${you.alive}. Summit tag: ${you.hasSummit ? "YES" : "no"}.`,
    `Location: ${here.name} (${here.alt} m). ${here.blurb}`,
    `Energy ${you.energy} | food ${you.food} | O2 ${you.o2} | altitude sickness ${you.ams}/3 | frostbite ${you.frostbite}/3 | starve ${you.starve}`,
    `Cache here: O2 ${exp.caches[you.location].o2}, food ${exp.caches[you.location].food}`,
    `Neighbors: ${here.neighbors.map((id) => `${id} ${PEAK.sites[id].name} ${PEAK.sites[id].alt}m`).join("; ") || "none"}`,
    `Last result: ${you.lastResult ?? "—"}`,
    `Ridge: bc → c1 → c2 → c3 → c4 South Col → summit. South Col is a camp on the route. One oxygen bottle pays for one turn there. Three turns without oxygen is the limit, not one.`,
    `Win: stand on the summit, then return to bc alive. South Col (c4) is the only way up.`,
    ...pushLines(you, legal),
    `Legal actions this turn:`,
    ...legal.map((a) => `- ${JSON.stringify(a)}  (${legalHint(you, a)})`),
    `Recent log:`,
    ...exp.log.slice(-8).map((e) => `- T${e.turn} ${e.message}`),
    `SPEAK: every action MUST include "say": a short spoken line (max 100 characters) in the voice of your standing orders (witty, reckless, patient, dumb, brave, etc.). If standing orders are empty, speak as a climber on the ridge. say is color. It is not a second action. radio is a shout to the log.`,
    `WHY: every action MUST include "why": a short plain-English reason (max 160 characters) for this turn's choice, from energy, food, oxygen, weather, and the next camp. why is for spectators. It is not spoken. If you omit why, the mountain fills a dull one.`,
    `Reply with one JSON object including say and why, e.g. {"act":"rest","say":"Legs first.","why":"Energy 34 with food left."} or {"act":"move","to":"c4","say":"Col's right there.","why":"South Col is legal, energy 71."}`,
  ];
  if (exp.status === "ended") {
    lines.unshift(`EXPEDITION ENDED: ${exp.outcome?.endedReason ?? "season over"}`);
  }
  return lines.join("\n");
}

const REST_ENERGY = 35;

function canRest(you: Climber, legal: Action[]): boolean {
  return you.food > 0 && you.energy < REST_ENERGY && legal.some((a) => a.act === "rest");
}

function pushLines(you: Climber, legal: Action[]): string[] {
  if (you.hasSummit) {
    if (you.location === "bc") return [`You have the summit tag and you are home. Wait.`];
    if (canRest(you, legal)) {
      return [`Energy ${you.energy} is too low to walk down. PUSH: {"act":"rest"}. Then descend.`];
    }
    return [`You have the summit tag. Walk down. Do not go back up.`];
  }
  if (canRest(you, legal)) {
    return [
      `Energy ${you.energy} is too low to climb. PUSH: {"act":"rest"} — this spends 1 food and recovers energy. Do not wait, and do not move until you have rested.`,
    ];
  }
  const toCol = legal.some((a) => a.act === "move" && a.to === "c4");
  const toSummit = legal.some((a) => a.act === "move" && a.to === "summit");
  if (toSummit) {
    return [`PUSH: {"act":"move","to":"summit"} is legal. Take it.`];
  }
  if (toCol) {
    return [
      `PUSH: {"act":"move","to":"c4"} is legal. That is the South Col, the only door to the summit. Take it. Do not rest here to stock oxygen.`,
    ];
  }
  return [];
}

function legalHint(you: Climber, action: Action): string {
  const label = actionLabel(action);
  if (canRest(you, [{ act: "rest" }]) && action.act === "rest") {
    return `${label} — you are tired, take it`;
  }
  if (you.energy >= REST_ENERGY && action.act === "move" && action.to === "c4" && !you.hasSummit) {
    return `${label} — summit route, take it`;
  }
  if (you.energy >= REST_ENERGY && action.act === "move" && action.to === "summit" && !you.hasSummit) {
    return `${label} — the top, take it`;
  }
  return label;
}
