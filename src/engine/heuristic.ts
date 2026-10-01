import { clipSay, clipWhy } from "./actions.ts";
import { downhill, inDeathZone, PEAK, uphill } from "./peak.ts";
import type { Action, HeuristicStyle, Observation } from "./types.ts";

export type { HeuristicStyle };

export type HeuristicProfile = {
  id: HeuristicStyle;
  title: string;
  approach: string;
};

export const HEURISTIC_PROFILES: Record<HeuristicStyle, HeuristicProfile> = {
  serac: {
    id: "serac",
    title: "patient alpinist",
    approach: "Waits out weather. Rests often. Never enters the death zone without oxygen.",
  },
  cornice: {
    id: "cornice",
    title: "summit pusher",
    approach: "Climbs on a poor window. Rests little. Will gamble the col with thin tanks.",
  },
  scree: {
    id: "scree",
    title: "siege porter",
    approach: "Stashes food and oxygen on the way up, radios the rope, and crosses the icefall only when fresh.",
  },
};

export function parseHeuristicStyle(raw: unknown): HeuristicStyle | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase().replaceAll("é", "e");
  if (key === "serac" || key === "cornice" || key === "scree") return key;
  return undefined;
}

export function heuristicStyleFor(name: string): HeuristicStyle {
  return parseHeuristicStyle(name) ?? hashStyle(name);
}

function hashStyle(name: string): HeuristicStyle {
  const key = name.trim().toLowerCase().replaceAll("é", "e");
  let h = 0;
  for (const ch of key) h = (h + ch.charCodeAt(0)) % 3;
  return (["serac", "cornice", "scree"] as const)[h];
}

export function heuristicProfileFor(name: string): HeuristicProfile {
  return HEURISTIC_PROFILES[heuristicStyleFor(name)];
}

/** House alpinists. Style comes from the profile, then the name. */
export function decideHeuristic(obs: Observation): Action {
  const style = obs.you.style ?? heuristicStyleFor(obs.you.name);
  const action =
    style === "cornice" ? decideCornice(obs) : style === "scree" ? decideScree(obs) : decideSerac(obs);
  const say =
    action.act === "radio" ? (clipSay(action.say) ?? clipSay(action.msg) ?? heuristicSay(style, action, obs)) : heuristicSay(style, action, obs);
  return { ...action, say, why: heuristicWhy(style, action, obs) };
}

const SAY_LINES: Record<HeuristicStyle, Record<string, string[]>> = {
  serac: {
    rest: ["Legs first.", "I sit. The mountain isn't going anywhere.", "Weather can wait."],
    wait: ["Holding.", "Not my window."],
    move: ["One camp. No hurry.", "Steady.", "I'll still be standing tomorrow."],
    cache: ["Leave it. We'll want it later.", "Stash and keep the pace slow."],
    take: ["I'll take that.", "Fuel for the slow way up."],
    radio: ["Holding. Slow is how you leave with both feet."],
  },
  cornice: {
    rest: ["One breath. Then up.", "Fine. Seconds only."],
    wait: ["This is wasting a window.", "Move already."],
    move: ["Still going.", "Col's up there.", "Not turning around."],
    cache: ["Drop it. I'm not a mule.", "Leave it, keep moving."],
    take: ["Mine. Going up."],
    radio: ["Pushing. Don't wait on me."],
  },
  scree: {
    rest: ["Icefall wants fresh legs.", "I rest so the rope doesn't have to."],
    wait: ["Siege is patience.", "Holding the dump."],
    move: ["Next dump.", "Carry it higher.", "Slow freight."],
    cache: ["For the walk home.", "Leave a bottle. That's the job."],
    take: ["I'll take the cache.", "Packed. Moving."],
    radio: ["Siege start. Caching on the way up."],
  },
};

function heuristicSay(style: HeuristicStyle, action: Action, obs: Observation): string {
  const bucket = action.act === "move" ? "move" : action.act;
  const lines = SAY_LINES[style][bucket] ?? SAY_LINES[style].wait;
  let line = lines[(obs.turn + obs.you.name.length) % lines.length];
  if (action.act === "move") {
    if (style === "cornice" && action.to === "c4") line = "South Col. Thin air, still going.";
    else if (style === "cornice" && action.to === "summit") line = "The top. Tag it.";
    else if (style === "serac" && action.to === "c4") line = "The col. I'll take it slow.";
    else if (style === "serac" && action.to === "summit") line = "The top. Then straight down.";
  }
  return clipSay(line) ?? "holding";
}

function heuristicWhy(_style: HeuristicStyle, action: Action, obs: Observation): string {
  const you = obs.you;
  const here = obs.site.name;
  const sky = obs.weather.sky;
  let line = `Holding at ${here}. Energy ${you.energy}, ${sky}.`;
  if (action.act === "rest") {
    line = `Energy ${you.energy} with food left. Rest at ${here}.`;
  } else if (action.act === "wait") {
    if (you.hasSummit && you.location === "bc") line = "Summit tag, home. Waiting out the season.";
    else if (sky === "storm") line = `Storm. Staying at ${here}.`;
    else line = `Holding at ${here}. Weather ${sky}.`;
  } else if (action.act === "move") {
    const dest = PEAK.sites[action.to];
    const dir = dest.alt >= obs.site.alt ? "up" : "down";
    if (action.to === "c4") line = `South Col is open. Energy ${you.energy}, O2 ${you.o2}.`;
    else if (action.to === "summit") line = `Summit is legal. Energy ${you.energy}, O2 ${you.o2}.`;
    else if (you.hasSummit) line = `Walking down to ${dest.name} with the summit tag.`;
    else line = `${dest.name} is next ${dir}. Energy ${you.energy}, ${sky}.`;
  } else if (action.act === "cache") {
    line = `Stashing ${action.qty} ${action.item} at ${here}.`;
  } else if (action.act === "take") {
    line = `Cache has ${action.item}. Taking ${action.qty}.`;
  } else {
    line = `Radio to the rope from ${here}.`;
  }
  return clipWhy(line) ?? "Chose this turn from the ridge.";
}

type Ctx = ReturnType<typeof context>;

function context(obs: Observation) {
  const you = obs.you;
  const storm = obs.weather.sky === "storm";
  const snow = obs.weather.sky === "snow";
  const wind = obs.weather.sky === "wind";
  const cache = obs.cacheHere;
  const up = uphill(you.location);
  const down = downhill(you.location);
  const death = inDeathZone(you.location);
  const nextUpDeath = up ? inDeathZone(up) : false;
  const atIce = you.location === "c1";
  const pick = (action: Action | null | undefined): Action | null => {
    if (!action) return null;
    if (action.act === "radio") return action;
    return obs.legal.some((a) => sameAction(a, action)) ? action : null;
  };
  return { obs, you, storm, snow, wind, cache, up, down, death, nextUpDeath, atIce, pick };
}

function finish(ctx: Ctx, chosen: Action | null): Action {
  return chosen ?? ctx.pick({ act: "wait" }) ?? ctx.obs.legal[0] ?? { act: "wait" };
}

/** Conservative. Turns around when the math sours. */
function decideSerac(obs: Observation): Action {
  const ctx = context(obs);
  const { you, storm, snow, cache, up, down, death, nextUpDeath, atIce, pick } = ctx;
  if (!you.alive || obs.ended) return { act: "wait" };

  const chosen =
    pick(cache.food > 0 && you.food < 3 ? { act: "take", item: "food", qty: 1 } : null) ??
    pick(cache.o2 > 0 && you.o2 < (death || nextUpDeath ? 3 : 2) ? { act: "take", item: "o2", qty: 1 } : null) ??
    (you.hasSummit
      ? pick(you.location === "bc" ? { act: "wait" } : null) ??
        pick(you.energy < 35 && you.food > 0 ? { act: "rest" } : null) ??
        pick(storm && you.energy < 45 && you.food > 0 ? { act: "rest" } : null) ??
        pick(down ? { act: "move", to: down } : null)
      : null) ??
    pick(
      you.food === 0 && cache.food === 0 && you.energy < 40 && down && you.location !== "bc"
        ? { act: "move", to: down }
        : null,
    ) ??
    pick(atIce && you.energy < 45 && you.food > 0 ? { act: "rest" } : null) ??
    pick(you.energy < 38 && you.food > 0 ? { act: "rest" } : null) ??
    pick(storm && you.food > 0 && (death || nextUpDeath) ? { act: "rest" } : null) ??
    pick(snow && you.energy < 55 && you.food > 0 && up ? { act: "rest" } : null) ??
    pick(nextUpDeath && you.o2 < 1 && down ? { act: "move", to: down } : null) ??
    pick(up && you.o2 < 1 && nextUpDeath ? (you.food > 0 ? { act: "rest" } : { act: "wait" }) : null) ??
    pick(up && you.energy >= 38 ? { act: "move", to: up } : null) ??
    pick(you.food > 0 && you.energy < 80 ? { act: "rest" } : null) ??
    pick(down && you.energy < 30 ? { act: "move", to: down } : null);

  return finish(ctx, chosen);
}

/** Aggressive. Climbs on wind and snow; rests only when nearly empty. */
function decideCornice(obs: Observation): Action {
  const ctx = context(obs);
  const { you, storm, cache, up, down, death, nextUpDeath, pick } = ctx;
  if (!you.alive || obs.ended) return { act: "wait" };

  const chosen =
    pick(cache.food > 0 && you.food < 2 ? { act: "take", item: "food", qty: 1 } : null) ??
    pick(cache.o2 > 0 && you.o2 < 1 && (death || nextUpDeath) ? { act: "take", item: "o2", qty: 1 } : null) ??
    (you.hasSummit
      ? pick(you.location === "bc" ? { act: "wait" } : null) ??
        pick(you.energy < 18 && you.food > 0 ? { act: "rest" } : null) ??
        pick(storm && death && you.food > 0 ? { act: "rest" } : null) ??
        pick(down ? { act: "move", to: down } : null)
      : null) ??
    pick(
      you.food === 0 && down && you.location !== "bc" && you.energy < 30
        ? { act: "move", to: down }
        : null,
    ) ??
    pick(you.energy < 22 && you.food > 0 ? { act: "rest" } : null) ??
    pick(storm && death && you.food > 0 ? { act: "rest" } : null) ??
    pick(nextUpDeath && you.o2 < 1 && down ? { act: "move", to: down } : null) ??
    pick(up && you.o2 < 1 && nextUpDeath ? (you.food > 0 ? { act: "rest" } : { act: "wait" }) : null) ??
    pick(up && you.energy >= 22 ? { act: "move", to: up } : null) ??
    pick(you.food > 0 && you.energy < 55 ? { act: "rest" } : null) ??
    pick(down ? { act: "move", to: down } : null);

  return finish(ctx, chosen);
}

/** Expedition style. Caches gear going up, cautious on the icefall, talks on the radio. */
function decideScree(obs: Observation): Action {
  const ctx = context(obs);
  const { you, storm, snow, cache, up, down, death, nextUpDeath, atIce, pick } = ctx;
  if (!you.alive || obs.ended) return { act: "wait" };

  const radioed = obs.recentLog.some((line) => line.includes(`${you.name}:`));
  const siegeOpen =
    !you.hasSummit && you.location === "bc" && you.energy >= 90 && !radioed
      ? pick({ act: "radio", msg: "Siege start. Caching on the way up." })
      : null;

  const chosen =
    siegeOpen ??
    pick(cache.food > 0 && you.food < 4 ? { act: "take", item: "food", qty: 1 } : null) ??
    pick(cache.o2 > 0 && you.o2 < 3 ? { act: "take", item: "o2", qty: 1 } : null) ??
    (you.hasSummit
      ? pick(you.location === "bc" ? { act: "wait" } : null) ??
        pick(you.energy < 38 && you.food > 0 ? { act: "rest" } : null) ??
        pick(storm && you.food > 0 ? { act: "rest" } : null) ??
        pick(down ? { act: "move", to: down } : null)
      : null) ??
    pick(!you.hasSummit && you.location === "c2" && you.food >= 6 && cache.food < 1 ? { act: "cache", item: "food", qty: 1 } : null) ??
    pick(!you.hasSummit && you.location === "c3" && you.o2 >= 3 && cache.o2 < 1 ? { act: "cache", item: "o2", qty: 1 } : null) ??
    pick(
      you.food === 0 && cache.food === 0 && down && you.location !== "bc"
        ? { act: "move", to: down }
        : null,
    ) ??
    pick(atIce && you.energy < 50 && you.food > 0 ? { act: "rest" } : null) ??
    pick(you.energy < 42 && you.food > 0 ? { act: "rest" } : null) ??
    pick(storm && you.food > 0 ? { act: "rest" } : null) ??
    pick(snow && you.energy < 50 && you.food > 0 && up ? { act: "rest" } : null) ??
    pick(nextUpDeath && you.o2 < 2 && you.o2 >= 1 && you.food > 0 ? { act: "rest" } : null) ??
    pick(nextUpDeath && you.o2 < 1 && down ? { act: "move", to: down } : null) ??
    pick(up && you.o2 < 1 && nextUpDeath ? (you.food > 0 ? { act: "rest" } : { act: "wait" }) : null) ??
    pick(up && you.energy >= 42 ? { act: "move", to: up } : null) ??
    pick(you.food > 0 && you.energy < 85 ? { act: "rest" } : null) ??
    pick(!radioed ? { act: "radio", msg: radioLine(you.location, you.hasSummit) } : null) ??
    pick(down && you.energy < 35 ? { act: "move", to: down } : null);

  return finish(ctx, chosen);
}

function radioLine(location: string, hasSummit: boolean): string {
  if (hasSummit) return "Walking home. Gear is on the ridge.";
  if (location === "c3") return "Camp 3. Oxygen for the walk home.";
  if (location === "c1") return "Icefall. Legs first, then weather.";
  return "Holding. Slow is how you leave with both feet.";
}

function sameAction(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
