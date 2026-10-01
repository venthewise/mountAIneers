import { describe, expect, it } from "vitest";
import { createExpedition, registerClimber, resolveTurn, submitAction } from "./expedition.ts";
import { decideHeuristic, heuristicStyleFor } from "./heuristic.ts";
import { observe } from "./observe.ts";
import type { Climber, Expedition } from "./types.ts";

function rope(name: string, loc: Climber["location"], stats: Partial<Climber> = {}) {
  const exp = createExpedition({ seed: 11, weatherLock: "snow", hazards: false });
  const reg = registerClimber(exp, name, "heuristic");
  if (!reg.ok) throw new Error(reg.error);
  Object.assign(reg.climber, {
    location: loc,
    energy: 52,
    food: 8,
    o2: 5,
    hasSummit: false,
    ...stats,
  });
  const obs = observe(exp, reg.climber.id);
  if (!obs) throw new Error("obs");
  return { exp, climber: reg.climber, action: decideHeuristic(obs) };
}

function playOut(name: string): { exp: Expedition; climber: Climber } {
  const exp = createExpedition({ seed: 42, weatherLock: "clear", maxTurns: 60, hazards: false });
  const reg = registerClimber(exp, name, "heuristic");
  if (!reg.ok) throw new Error(reg.error);
  let guard = 0;
  while (exp.status !== "ended" && guard++ < 80) {
    const obs = observe(exp, reg.climber.id);
    if (!obs) throw new Error("obs");
    const action = decideHeuristic(obs);
    const submitted = submitAction(exp, reg.climber.id, action);
    if (!submitted.ok) submitAction(exp, reg.climber.id, { act: "wait" });
    resolveTurn(exp);
  }
  return { exp, climber: reg.climber };
}

describe("house heuristic styles", () => {
  it("maps the three house names onto three styles", () => {
    expect(heuristicStyleFor("Serac")).toBe("serac");
    expect(heuristicStyleFor("Cornice")).toBe("cornice");
    expect(heuristicStyleFor("Scree")).toBe("scree");
  });

  it("picks three different moves from the same snowy Camp 3", () => {
    const serac = rope("Serac", "c3").action;
    const cornice = rope("Cornice", "c3").action;
    const scree = rope("Scree", "c3").action;
    expect(serac).toMatchObject({ act: "rest" });
    expect(cornice).toMatchObject({ act: "move", to: "c4" });
    expect(scree).toMatchObject({ act: "cache", item: "o2", qty: 1 });
    expect(serac.say).toBeTruthy();
    expect(cornice.say).toBeTruthy();
    expect(scree.say).toBeTruthy();
    expect(serac.why).toMatch(/energy/i);
    expect(cornice.why).toMatch(/south col/i);
    expect(scree.why).toMatch(/stashing/i);
    const set = new Set([serac, cornice, scree].map((a) => JSON.stringify(a)));
    expect(set.size).toBe(3);
  });

  it("lets Cornice push the icefall while Serac and Scree rest", () => {
    const stats = { energy: 36, food: 8, o2: 5 };
    const serac = rope("Serac", "c1", stats).action;
    const cornice = rope("Cornice", "c1", stats).action;
    const scree = rope("Scree", "c1", stats).action;
    expect(serac).toMatchObject({ act: "rest" });
    expect(cornice).toMatchObject({ act: "move", to: "c2" });
    expect(scree).toMatchObject({ act: "rest" });
  });

  it("lets Scree open with a radio from Base Camp", () => {
    const exp = createExpedition({ seed: 3, weatherLock: "clear", hazards: false });
    const reg = registerClimber(exp, "Scree", "heuristic");
    if (!reg.ok) throw new Error(reg.error);
    const obs = observe(exp, reg.climber.id);
    if (!obs) throw new Error("obs");
    expect(decideHeuristic(obs)).toMatchObject({ act: "radio" });
  });

  it.each(["Serac", "Cornice", "Scree"] as const)(
    "%s summits and walks home in locked clear weather",
    (name) => {
      const { exp, climber } = playOut(name);
      expect(climber.hasSummit).toBe(true);
      expect(climber.alive).toBe(true);
      expect(climber.location).toBe("bc");
      expect(exp.outcome?.winnerIds).toContain(climber.id);
    },
  );
});

describe("heuristic personas", () => {
  it("stamps the house title on the climber", () => {
    const exp = createExpedition({ seed: 1 });
    const reg = registerClimber(exp, "Cornice", "heuristic");
    if (!reg.ok) throw new Error(reg.error);
    expect(reg.climber.persona).toBe("summit pusher");
    expect(reg.climber.style).toBe("cornice");
  });

  it("lets a profile override the name's house style", () => {
    const exp = createExpedition({ seed: 11, weatherLock: "snow", hazards: false });
    const reg = registerClimber(exp, "Serac", "heuristic", undefined, { style: "cornice" });
    if (!reg.ok) throw new Error(reg.error);
    Object.assign(reg.climber, { location: "c3", energy: 52, food: 8, o2: 5 });
    const obs = observe(exp, reg.climber.id);
    if (!obs) throw new Error("obs");
    expect(reg.climber.style).toBe("cornice");
    expect(decideHeuristic(obs)).toMatchObject({ act: "move", to: "c4" });
  });
});
