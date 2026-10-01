import { describe, expect, it } from "vitest";
import { parseAction } from "./actions.ts";
import {
  createExpedition,
  legalActions,
  registerClimber,
  resolveTurn,
  submitAction,
} from "./expedition.ts";
import { decideHeuristic } from "./heuristic.ts";
import { formatBriefing, observe } from "./observe.ts";
import { PEAK, inDeathZone } from "./peak.ts";

describe("peak graph", () => {
  it("is a single ridge from base camp to summit", () => {
    expect(PEAK.route).toEqual(["bc", "c1", "c2", "c3", "c4", "summit"]);
    for (let i = 0; i < PEAK.route.length - 1; i++) {
      const a = PEAK.route[i];
      const b = PEAK.route[i + 1];
      expect(PEAK.sites[a].neighbors).toContain(b);
      expect(PEAK.sites[b].neighbors).toContain(a);
    }
    expect(inDeathZone("c3")).toBe(false);
    expect(inDeathZone("c4")).toBe(true);
    expect(inDeathZone("summit")).toBe(true);
  });
});

describe("parseAction", () => {
  it("accepts the published schema and extracts JSON from chatter", () => {
    expect(parseAction({ act: "rest" })).toEqual({ ok: true, action: { act: "rest" } });
    expect(parseAction({ act: "move", to: "c1" }).ok).toBe(true);
    expect(parseAction({ act: "move", to: "mars" }).ok).toBe(false);
    const fromText = parseAction('I will camp.\n{"act":"cache","item":"o2","qty":1}');
    expect(fromText).toEqual({ ok: true, action: { act: "cache", item: "o2", qty: 1 } });
    const spoken = parseAction({ act: "rest", say: "  Legs first.  " });
    expect(spoken).toEqual({ ok: true, action: { act: "rest", say: "Legs first." } });
    const long = "x".repeat(200);
    const clipped = parseAction({ act: "wait", say: long });
    expect(clipped.ok).toBe(true);
    if (clipped.ok) expect(clipped.action.say?.length).toBe(100);
  });
});

describe("expedition", () => {
  it("rejects a non-adjacent move and keeps the climber at bc", () => {
    const exp = createExpedition({ seed: 1, weatherLock: "clear" });
    const reg = registerClimber(exp, "Pike", "heuristic");
    if (!reg.ok) throw new Error(reg.error);
    const bad = submitAction(exp, reg.climber.id, { act: "move", to: "summit" });
    expect(bad.ok).toBe(false);
    expect(exp.pending[reg.climber.id]).toBeUndefined();
    expect(reg.climber.location).toBe("bc");
  });

  it("lets rest recover energy", () => {
    const exp = createExpedition({ seed: 2, weatherLock: "clear" });
    const reg = registerClimber(exp, "Pike", "heuristic");
    if (!reg.ok) throw new Error(reg.error);
    reg.climber.energy = 40;
    submitAction(exp, reg.climber.id, { act: "rest" });
    resolveTurn(exp);
    expect(reg.climber.energy).toBeGreaterThan(40);
    expect(reg.climber.food).toBe(9);
  });

  it("blocks upward travel in a storm", () => {
    const exp = createExpedition({ seed: 3, weatherLock: "storm" });
    const reg = registerClimber(exp, "Pike", "heuristic");
    if (!reg.ok) throw new Error(reg.error);
    const attempt = submitAction(exp, reg.climber.id, { act: "move", to: "c1" });
    expect(attempt.ok).toBe(false);
    expect(legalActions(exp, reg.climber).some((a) => a.act === "move" && a.to === "c1")).toBe(false);
  });

  it("burns oxygen in the death zone and altitude sickness without it", () => {
    const exp = createExpedition({ seed: 4, weatherLock: "clear" });
    const withO2 = registerClimber(exp, "With", "heuristic");
    const without = registerClimber(exp, "Without", "heuristic");
    if (!withO2.ok || !without.ok) throw new Error("register");
    withO2.climber.location = "c4";
    without.climber.location = "c4";
    without.climber.o2 = 0;
    submitAction(exp, withO2.climber.id, { act: "wait" });
    submitAction(exp, without.climber.id, { act: "wait" });
    const o2Before = withO2.climber.o2;
    resolveTurn(exp);
    expect(withO2.climber.o2).toBe(o2Before - 1);
    expect(without.climber.ams).toBe(1);
  });

  it("awards the summit tag and a win on return to base camp", () => {
    const exp = createExpedition({ seed: 5, weatherLock: "clear", hazards: false });
    const reg = registerClimber(exp, "Pike", "heuristic");
    if (!reg.ok) throw new Error(reg.error);
    const c = reg.climber;
    c.location = "c4";
    c.energy = 100;
    c.o2 = 5;
    submitAction(exp, c.id, { act: "move", to: "summit" });
    resolveTurn(exp);
    expect(c.hasSummit).toBe(true);
    expect(c.location).toBe("summit");
    c.energy = 100;
    submitAction(exp, c.id, { act: "move", to: "c4" });
    resolveTurn(exp);
    for (const step of ["c3", "c2", "c1", "bc"] as const) {
      c.energy = 100;
      submitAction(exp, c.id, { act: "move", to: step });
      resolveTurn(exp);
    }
    expect(c.location).toBe("bc");
    expect(exp.status).toBe("ended");
    expect(exp.outcome?.winnerIds).toContain(c.id);
  });

  it("pins standing orders at the top of the briefing", () => {
    const exp = createExpedition({ seed: 8, weatherLock: "clear" });
    const reg = registerClimber(exp, "NorthWind", "llm", undefined, {
      standingOrders: "Never go above Camp 3 with fewer than 3 oxygen bottles.",
    });
    if (!reg.ok) throw new Error(reg.error);
    const obs = observe(exp, reg.climber.id);
    if (!obs) throw new Error("obs");
    expect(obs.standingOrders).toContain("3 oxygen bottles");
    expect(obs.briefing).toMatch(/STANDING ORDERS[\s\S]*3 oxygen bottles/);
    expect(obs.briefing.indexOf("STANDING ORDERS")).toBeLessThan(obs.briefing.indexOf("Clock:"));
    const empty = formatBriefing(exp, { ...reg.climber, standingOrders: undefined }, [], 1, "day", 12);
    expect(empty).not.toContain("STANDING ORDERS");
  });

  it("pushes a climber at Camp 3 onto the South Col", () => {
    const exp = createExpedition({ seed: 9, weatherLock: "clear" });
    const reg = registerClimber(exp, "Feather", "llm");
    if (!reg.ok) throw new Error(reg.error);
    reg.climber.location = "c3";
    const obs = observe(exp, reg.climber.id);
    if (!obs) throw new Error("obs");
    expect(obs.briefing).toContain('PUSH: {"act":"move","to":"c4"}');
    expect(obs.briefing).toContain("South Col, the only door to the summit");
    expect(obs.briefing).toMatch(/"to":"c4"[\s\S]*summit route, take it/);
    expect(obs.site.blurb.toLowerCase()).toContain("south col");
  });

  it("stores a spoken line on commit, and fills one in if the agent stays quiet", () => {
    const exp = createExpedition({ seed: 12, weatherLock: "clear" });
    const reg = registerClimber(exp, "Feather", "llm");
    if (!reg.ok) throw new Error(reg.error);
    const withLine = submitAction(exp, reg.climber.id, { act: "rest", say: "Legs first." });
    expect(withLine.ok).toBe(true);
    expect(reg.climber.lastSay).toBe("Legs first.");
    resolveTurn(exp);
    const silent = submitAction(exp, reg.climber.id, { act: "move", to: "c1" });
    expect(silent.ok).toBe(true);
    expect(reg.climber.lastSay).toBe("heading to Camp 1");
    expect(exp.talk.map((t) => t.text)).toEqual(["Legs first.", "heading to Camp 1"]);
  });

  it("stores why and action specs on ridge talk", () => {
    const exp = createExpedition({ seed: 13, weatherLock: "clear" });
    const reg = registerClimber(exp, "Feather", "llm");
    if (!reg.ok) throw new Error(reg.error);
    const reasoned = submitAction(exp, reg.climber.id, {
      act: "rest",
      say: "Legs first.",
      why: "Energy 22 with food left.",
    });
    expect(reasoned.ok).toBe(true);
    expect(exp.talk[0].text).toBe("Legs first.");
    expect(exp.talk[0].specs).toBe("ACT: rest · SAY: Legs first. · WHY: Energy 22 with food left.");
    resolveTurn(exp);
    const silent = submitAction(exp, reg.climber.id, { act: "move", to: "c1" });
    expect(silent.ok).toBe(true);
    expect(exp.talk.at(-1)?.specs).toBe("ACT: move · TO: c1 · SAY: heading to Camp 1 · WHY: Heading to Camp 1.");
  });

  it("pushes rest when energy is too low to climb", () => {
    const exp = createExpedition({ seed: 10, weatherLock: "clear" });
    const reg = registerClimber(exp, "Feather", "llm");
    if (!reg.ok) throw new Error(reg.error);
    Object.assign(reg.climber, { location: "c3", energy: 22, food: 6 });
    const obs = observe(exp, reg.climber.id);
    if (!obs) throw new Error("obs");
    expect(obs.briefing).toContain('PUSH: {"act":"rest"}');
    expect(obs.briefing).toContain("SPEAK:");
    expect(obs.briefing).toContain('"say"');
    expect(obs.briefing).toContain("WHY:");
    expect(obs.briefing).toContain('"why"');
    expect(obs.briefing).not.toContain('PUSH: {"act":"move","to":"c4"}');
    expect(obs.briefing).toMatch(/"act":"rest"[\s\S]*you are tired, take it/);
  });

  it("lets the heuristic summit and walk down in locked clear weather", () => {
    const exp = createExpedition({ seed: 42, weatherLock: "clear", maxTurns: 60, hazards: false });
    const reg = registerClimber(exp, "Serac", "heuristic");
    if (!reg.ok) throw new Error(reg.error);
    let guard = 0;
    while (exp.status !== "ended" && guard++ < 80) {
      const obs = observe(exp, reg.climber.id);
      if (!obs) throw new Error("obs");
      const action = decideHeuristic(obs);
      const submitted = submitAction(exp, reg.climber.id, action);
      if (!submitted.ok) {
        submitAction(exp, reg.climber.id, { act: "wait" });
      }
      resolveTurn(exp);
    }
    expect(reg.climber.hasSummit).toBe(true);
    expect(reg.climber.alive).toBe(true);
    expect(reg.climber.location).toBe("bc");
    expect(exp.outcome?.winnerIds).toContain(reg.climber.id);
  });
});
