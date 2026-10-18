import { randomBytes } from "node:crypto";
import { decideLlm } from "../agents/llm.ts";
import {
  HOUSE_BOTS,
  PEAK,
  TALK_MAX,
  allCommitted,
  clock,
  createExpedition,
  clipStandingOrders,
  decideHeuristic,
  HEURISTIC_PROFILES,
  heuristicStyleFor,
  living,
  observe,
  parseHeuristicStyle,
  registerClimber,
  resolveTurn,
  submitAction,
  type CreateOpts,
  type Expedition,
  type HeuristicStyle,
} from "../engine/index.ts";

export type Phase = "lobby" | "generating" | "climbing" | "ended";
export type Provider = "heuristic" | "spacexai" | "openai-compat";
export type Source = "configured" | "external";

export type RosterPublic = {
  id: string;
  name: string;
  source: Source;
  provider: Provider | "external";
  model?: string;
  baseUrl?: string;
  hasKey: boolean;
  color: string;
  lastError?: string;
  persona?: string;
  style?: HeuristicStyle;
  standingOrders?: string;
};

type RosterEntry = RosterPublic & {
  token: string;
  apiKey?: string;
  climberId?: string;
  busy?: boolean;
};

export type Snapshot = {
  phase: Phase;
  peak: {
    id: string;
    name: string;
    range: string;
    summitAlt: number;
    deathZoneAlt: number;
    sites: (typeof PEAK.sites)[keyof typeof PEAK.sites][];
    route: typeof PEAK.route;
  };
  lobby: {
    roster: RosterPublic[];
    canStart: boolean;
    mcpPath: string;
    fairWeather: boolean;
  };
  expedition: null | {
    id: string;
    seed: number;
    turn: number;
    maxTurns: number;
    status: Expedition["status"];
    weather: Expedition["weather"];
    clock: ReturnType<typeof clock>;
    caches: Expedition["caches"];
    climbers: Expedition["climbers"];
    log: Expedition["log"];
    talk: Expedition["talk"];
    outcome?: Expedition["outcome"];
    committedIds: string[];
    living: number;
    hazards: boolean;
  };
  turnMs: number;
  turnEndsAt: number | null;
};

export type AddConfigured = {
  name: string;
  provider: Provider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  style?: string;
  standingOrders?: string;
};

export type PatchClimber = {
  name?: string;
  style?: string;
  standingOrders?: string;
};

export class Game {
  phase: Phase = "lobby";
  expedition: Expedition | null = null;
  tokens = new Map<string, string>();
  listeners = new Set<(snap: Snapshot) => void>();
  turnMs: number;
  generateMs: number;
  defaultSeed: number | undefined;
  turnEndsAt: number | null = null;
  fairWeather = false;
  private roster: RosterEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private genTimer: ReturnType<typeof setTimeout> | null = null;
  private bots = new Set<ReturnType<typeof setInterval>>();

  constructor(opts: { turnMs?: number; generateMs?: number; seed?: number } = {}) {
    this.turnMs = opts.turnMs ?? 12_000;
    this.generateMs = opts.generateMs ?? 1_600;
    this.defaultSeed = opts.seed;
  }

  snapshot(): Snapshot {
    const exp = this.expedition;
    return {
      phase: this.phase,
      peak: {
        id: PEAK.id,
        name: PEAK.name,
        range: PEAK.range,
        summitAlt: PEAK.summitAlt,
        deathZoneAlt: PEAK.deathZoneAlt,
        sites: PEAK.route.map((id) => PEAK.sites[id]),
        route: PEAK.route,
      },
      lobby: {
        roster: this.roster.map(publicRoster),
        canStart: this.roster.length > 0 && this.phase === "lobby",
        mcpPath: "/mcp",
        fairWeather: this.fairWeather,
      },
      expedition: exp
        ? {
            id: exp.id,
            seed: exp.seed,
            turn: exp.turn,
            maxTurns: exp.maxTurns,
            status: exp.status,
            weather: exp.weather,
            clock: clock(exp.turn, exp.hoursPerTurn),
            caches: exp.caches,
            climbers: exp.climbers.map((c) => ({ ...c })),
            log: exp.log.slice(-80),
            talk: exp.talk.slice(-TALK_MAX),
            outcome: exp.outcome,
            committedIds: Object.keys(exp.pending),
            living: living(exp).length,
            hazards: exp.hazards,
          }
        : null,
      turnMs: this.turnMs,
      turnEndsAt: this.turnEndsAt,
    };
  }

  subscribe(fn: (snap: Snapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  addConfigured(body: AddConfigured): RosterPublic {
    this.assertLobby();
    const name = body.name.trim().slice(0, 24);
    if (!name) throw Object.assign(new Error("name required"), { status: 400 });
    if (this.roster.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      throw Object.assign(new Error("name already on the rope"), { status: 400 });
    }
    if (this.roster.length >= 16) throw Object.assign(new Error("rope is full"), { status: 400 });
    if (body.provider === "spacexai" && !body.apiKey?.trim()) {
      throw Object.assign(new Error("SpaceXAI climber needs an API key"), { status: 400 });
    }
    if (body.provider === "openai-compat") {
      if (!body.apiKey?.trim() || !body.baseUrl?.trim() || !body.model?.trim()) {
        throw Object.assign(new Error("OpenAI-compatible climber needs api key, base URL, and model"), { status: 400 });
      }
    }
    const house = HOUSE_BOTS.find((h) => h.name.toLowerCase() === name.toLowerCase());
    const color = house?.color ?? HOUSE_BOTS[this.roster.length % HOUSE_BOTS.length]?.color ?? "#6ea8fe";
    const style =
      body.provider === "heuristic" ? (parseHeuristicStyle(body.style) ?? heuristicStyleFor(name)) : undefined;
    const entry: RosterEntry = {
      id: `slot_${randomBytes(4).toString("hex")}`,
      token: `tok_${randomBytes(18).toString("hex")}`,
      name,
      source: "configured",
      provider: body.provider,
      style,
      persona: style ? HEURISTIC_PROFILES[style].title : undefined,
      standingOrders: clipStandingOrders(body.standingOrders),
      model: body.model?.trim() || defaultModel(body.provider),
      baseUrl: body.baseUrl?.trim() || undefined,
      hasKey: Boolean(body.apiKey?.trim()),
      apiKey: body.apiKey?.trim() || undefined,
      color,
    };
    this.roster.push(entry);
    this.emit();
    return publicRoster(entry);
  }

  addExternalClimber(
    name: string,
    profile: { standingOrders?: unknown } = {},
  ): { token: string; climberId: string; name: string; phase: Phase } {
    if (this.phase === "generating") {
      throw Object.assign(new Error("mountain is still loading — wait for climbing"), { status: 409 });
    }
    const trimmed = name.trim().slice(0, 24) || "agent";
    const standingOrders = clipStandingOrders(profile.standingOrders);
    if (this.phase === "lobby") {
      if (this.roster.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
        throw Object.assign(new Error("name already on the rope"), { status: 400 });
      }
      if (this.roster.length >= 16) throw Object.assign(new Error("rope is full"), { status: 400 });
      const color = HOUSE_BOTS[this.roster.length % HOUSE_BOTS.length]?.color ?? "#6ea8fe";
      const entry: RosterEntry = {
        id: `slot_${randomBytes(4).toString("hex")}`,
        token: `tok_${randomBytes(18).toString("hex")}`,
        name: trimmed,
        source: "external",
        provider: "external",
        hasKey: false,
        color,
        standingOrders,
      };
      this.roster.push(entry);
      this.emit();
      return { token: entry.token, climberId: entry.id, name: entry.name, phase: this.phase };
    }
    if (!this.expedition) throw Object.assign(new Error("no expedition"), { status: 409 });
    const mounted = this.mountClimber(trimmed, "llm", undefined, { standingOrders });
    return { token: mounted.token, climberId: mounted.climberId, name: mounted.name, phase: this.phase };
  }

  removeClimber(id: string): void {
    this.assertLobby();
    this.roster = this.roster.filter((r) => r.id !== id);
    this.emit();
  }

  patchClimber(id: string, patch: PatchClimber): RosterPublic {
    this.assertLobby();
    const entry = this.roster.find((r) => r.id === id);
    if (!entry) throw Object.assign(new Error("climber not on the rope"), { status: 404 });
    if (patch.name !== undefined) {
      const name = patch.name.trim().slice(0, 24);
      if (!name) throw Object.assign(new Error("name required"), { status: 400 });
      if (this.roster.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) {
        throw Object.assign(new Error("name already on the rope"), { status: 400 });
      }
      entry.name = name;
    }
    if ("standingOrders" in patch) {
      entry.standingOrders = clipStandingOrders(patch.standingOrders);
    }
    if (entry.provider === "heuristic" && patch.style !== undefined) {
      const style = parseHeuristicStyle(patch.style) ?? heuristicStyleFor(entry.name);
      entry.style = style;
      entry.persona = HEURISTIC_PROFILES[style].title;
    }
    this.emit();
    return publicRoster(entry);
  }

  addHeuristicTeam(): RosterPublic[] {
    this.assertLobby();
    const added: RosterPublic[] = [];
    for (const house of HOUSE_BOTS.slice(0, 3)) {
      if (this.roster.some((r) => r.name === house.name)) continue;
      added.push(this.addConfigured({ name: house.name, provider: "heuristic" }));
    }
    return added;
  }

  start(opts: CreateOpts & { fairWeather?: boolean } = {}): Snapshot {
    this.assertLobby();
    if (this.roster.length === 0) {
      throw Object.assign(new Error("wire at least one AI climber before starting"), { status: 400 });
    }
    const fair = Boolean(opts.fairWeather);
    this.fairWeather = fair;
    const exp = createExpedition({
      seed: opts.seed ?? this.defaultSeed,
      weatherLock: fair ? "clear" : opts.weatherLock,
      hazards: fair ? false : opts.hazards,
    });
    this.expedition = exp;
    for (const slot of this.roster) {
      const kind = slot.provider === "heuristic" ? "heuristic" : "llm";
      const result = registerClimber(exp, slot.name, kind, slot.color, {
        standingOrders: slot.standingOrders,
        style: slot.style,
        persona: slot.persona,
      });
      if (!result.ok) throw Object.assign(new Error(result.error), { status: 400 });
      slot.climberId = result.climber.id;
      this.tokens.set(slot.token, result.climber.id);
    }
    this.phase = "generating";
    this.emit();
    if (this.genTimer) clearTimeout(this.genTimer);
    if (this.generateMs <= 0) {
      this.beginClimb();
    } else {
      this.genTimer = setTimeout(() => this.beginClimb(), this.generateMs);
    }
    return this.snapshot();
  }

  returnToLobby(): Snapshot {
    this.stopLoops();
    this.tokens.clear();
    this.expedition = null;
    this.phase = "lobby";
    for (const slot of this.roster) {
      slot.climberId = undefined;
      slot.lastError = undefined;
      slot.busy = false;
    }
    this.emit();
    return this.snapshot();
  }

  private beginClimb(): void {
    if (this.phase !== "generating" || !this.expedition) return;
    this.phase = "climbing";
    this.startRunners();
    this.armTimer();
    this.emit();
  }

  private startRunners(): void {
    for (const slot of this.roster) {
      if (slot.source !== "configured") continue;
      const token = slot.token;
      const interval = setInterval(() => {
        void this.runConfiguredTurn(slot, token);
      }, 280);
      this.bots.add(interval);
    }
  }

  private async runConfiguredTurn(slot: RosterEntry, token: string): Promise<void> {
    if (this.phase !== "climbing" || !this.expedition) return;
    if (this.expedition.status === "ended") return;
    const climber = this.climberFor(token);
    if (!climber?.alive) return;
    if (this.expedition.pending[climber.id]) return;
    if (slot.busy) return;
    const obs = observe(this.expedition, climber.id);
    if (!obs) return;
    slot.busy = true;
    try {
      const action =
        slot.provider === "heuristic"
          ? decideHeuristic(obs)
          : await decideLlm(obs, {
              provider: slot.provider === "openai-compat" ? "openai-compat" : "spacexai",
              apiKey: slot.apiKey ?? "",
              model: slot.model ?? defaultModel("spacexai") ?? "",
              baseUrl: slot.baseUrl,
            });
      this.act(token, action);
      slot.lastError = undefined;
    } catch (err) {
      slot.lastError = err instanceof Error ? err.message : "agent error";
      try {
        this.act(token, { act: "wait" });
      } catch {
        /* committed */
      }
      this.emit();
    } finally {
      slot.busy = false;
    }
  }

  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.phase !== "climbing" || !this.expedition || this.expedition.status !== "climbing") {
      this.turnEndsAt = null;
      return;
    }
    if (living(this.expedition).length === 0) {
      this.turnEndsAt = null;
      return;
    }
    this.turnEndsAt = Date.now() + this.turnMs;
    this.timer = setTimeout(() => this.tick("timeout"), this.turnMs);
  }

  tick(reason: "timeout" | "all-in" | "force"): Snapshot {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.turnEndsAt = null;
    if (this.phase === "climbing" && this.expedition?.status === "climbing") {
      resolveTurn(this.expedition);
      // resolveTurn mutates status; widen so TS doesn't keep the narrowed "climbing" type.
      if ((this.expedition.status as string) === "ended") this.phase = "ended";
    }
    if (this.phase === "climbing") this.armTimer();
    this.emit();
    void reason;
    return this.snapshot();
  }

  private maybeTick(): void {
    if (this.phase !== "climbing" || !this.expedition) return;
    if (allCommitted(this.expedition)) this.tick("all-in");
  }

  climberFor(token: string) {
    const id = this.tokens.get(token);
    if (!id || !this.expedition) return null;
    return this.expedition.climbers.find((c) => c.id === id) ?? null;
  }

  slotForToken(token: string): RosterEntry | undefined {
    return this.roster.find((r) => r.token === token);
  }

  act(token: string, raw: unknown) {
    if (this.phase === "lobby") {
      throw Object.assign(new Error("expedition has not started"), { status: 409 });
    }
    if (this.phase === "generating") {
      throw Object.assign(new Error("mountain is still loading"), { status: 409 });
    }
    const climber = this.climberFor(token);
    if (!climber) throw Object.assign(new Error("unknown token"), { status: 401 });
    if (!this.expedition) throw Object.assign(new Error("no expedition"), { status: 409 });
    const result = submitAction(this.expedition, climber.id, raw);
    if (!result.ok) throw Object.assign(new Error(result.error), { status: 400 });
    this.emit();
    this.maybeTick();
    return { ok: true as const, action: result.action, turn: this.expedition.turn, phase: this.phase };
  }

  observation(token: string) {
    const slot = this.slotForToken(token);
    if (!slot && !this.tokens.has(token)) {
      throw Object.assign(new Error("unknown token"), { status: 401 });
    }
    if (this.phase === "lobby" || this.phase === "generating") {
      const orders = slot?.standingOrders?.trim();
      const wait =
        this.phase === "lobby"
          ? "You are wired into the lobby. Wait until the human presses Start and phase becomes climbing."
          : "Thalun is being surveyed. Wait until phase is climbing, then act.";
      const briefing = orders
        ? `${wait}\n\nSTANDING ORDERS (from your organizer):\n${orders}`
        : wait;
      return {
        phase: this.phase,
        ended: false,
        committed: false,
        waiting: true,
        view: null,
        standingOrders: orders || undefined,
        briefing,
      };
    }
    const climber = this.climberFor(token);
    if (!climber || !this.expedition) {
      throw Object.assign(new Error("unknown token"), { status: 401 });
    }
    const view = observe(this.expedition, climber.id);
    return {
      phase: this.phase,
      ended: this.expedition.status === "ended",
      committed: Boolean(this.expedition.pending[climber.id]),
      waiting: false,
      view,
    };
  }

  private mountClimber(
    name: string,
    kind: "heuristic" | "llm",
    color?: string,
    profile?: { standingOrders?: string; style?: HeuristicStyle; persona?: string },
  ) {
    if (!this.expedition) throw Object.assign(new Error("no expedition"), { status: 409 });
    const result = registerClimber(this.expedition, name, kind, color, profile);
    if (!result.ok) throw Object.assign(new Error(result.error), { status: 400 });
    const token = `tok_${randomBytes(18).toString("hex")}`;
    this.tokens.set(token, result.climber.id);
    if (this.phase === "climbing" && this.turnEndsAt === null) this.armTimer();
    this.emit();
    return { token, climberId: result.climber.id, name: result.climber.name };
  }

  private assertLobby(): void {
    if (this.phase !== "lobby") {
      throw Object.assign(new Error("return to lobby to change the rope"), { status: 409 });
    }
  }

  private stopLoops(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.genTimer) clearTimeout(this.genTimer);
    this.timer = null;
    this.genTimer = null;
    this.turnEndsAt = null;
    for (const id of this.bots) clearInterval(id);
    this.bots.clear();
  }

  stop(): void {
    this.stopLoops();
    this.listeners.clear();
  }
}

function publicRoster(entry: RosterEntry): RosterPublic {
  return {
    id: entry.id,
    name: entry.name,
    source: entry.source,
    provider: entry.provider,
    model: entry.model,
    baseUrl: entry.baseUrl,
    hasKey: entry.hasKey,
    color: entry.color,
    lastError: entry.lastError,
    persona: entry.persona,
    style: entry.style,
    standingOrders: entry.standingOrders,
  };
}

function defaultModel(provider: Provider): string | undefined {
  if (provider === "spacexai") return process.env.XAI_MODEL || "grok-4.3";
  return undefined;
}
