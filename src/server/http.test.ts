import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Game } from "./game.ts";
import { createHttpServer } from "./http.ts";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

describe("lobby start flow", () => {
  let server: Server | undefined;
  let game: Game | undefined;

  afterEach(async () => {
    game?.stop();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  });

  it("starts in lobby, rejects humans, wires an agent, then starts the season", async () => {
    game = new Game({ generateMs: 0, turnMs: 60_000 });
    server = createHttpServer(game, publicDir);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    const lobby = await (await fetch(`${base}/api/lobby`)).json() as { phase: string; lobby: { canStart: boolean } };
    expect(lobby.phase).toBe("lobby");
    expect(lobby.lobby.canStart).toBe(false);

    const human = await fetch(`${base}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Yunuk", kind: "human" }),
    });
    expect(human.status).toBe(400);

    const emptyStart = await fetch(`${base}/api/start`, { method: "POST", body: "{}" });
    expect(emptyStart.status).toBe(400);

    const add = await fetch(`${base}/api/lobby/climbers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Serac", provider: "heuristic" }),
    });
    expect(add.status).toBe(201);

    const started = await fetch(`${base}/api/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fairWeather: true, seed: 42 }),
    });
    const snap = (await started.json()) as { phase: string; expedition: { seed: number; weather: { sky: string } } };
    expect(snap.phase).toBe("climbing");
    expect(snap.expedition.seed).toBe(42);
    expect(snap.expedition.weather.sky).toBe("clear");

    const home = await fetch(`${base}/`);
    const html = await home.text();
    expect(html).toContain("You do not climb");
    expect(html).not.toContain("Climb as human");
  });

  it("pins standing orders on the briefing and lets the organizer edit a profile", async () => {
    game = new Game({ generateMs: 0, turnMs: 60_000 });
    server = createHttpServer(game, publicDir);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    const added = await fetch(`${base}/api/lobby/climbers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Serac",
        provider: "heuristic",
        standingOrders: "Talk first.",
      }),
    });
    const slot = (await added.json()) as { id: string; style: string; standingOrders: string };
    expect(added.status).toBe(201);
    expect(slot.style).toBe("serac");
    expect(slot.standingOrders).toBe("Talk first.");

    const patched = await fetch(`${base}/api/lobby/climbers/${slot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Frost",
        style: "cornice",
        standingOrders: "Push in wind. Rest in storm.",
      }),
    });
    const profile = (await patched.json()) as {
      name: string;
      style: string;
      persona: string;
      standingOrders: string;
    };
    expect(patched.status).toBe(200);
    expect(profile.name).toBe("Frost");
    expect(profile.style).toBe("cornice");
    expect(profile.persona).toBe("summit pusher");
    expect(profile.standingOrders).toBe("Push in wind. Rest in storm.");

    const join = await fetch(`${base}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Ridgeback",
        kind: "llm",
        standingOrders: "Cache one bottle at Camp 3 on the way up.",
      }),
    });
    const agent = (await join.json()) as { token: string };
    expect(join.status).toBe(201);

    await fetch(`${base}/api/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fairWeather: true, seed: 7 }),
    });

    const obs = await fetch(`${base}/api/observation`, {
      headers: { Authorization: `Bearer ${agent.token}` },
    });
    const live = (await obs.json()) as {
      view: { briefing: string; standingOrders: string; you: { standingOrders: string } };
    };
    expect(live.view.standingOrders).toContain("Cache one bottle");
    expect(live.view.briefing).toContain("STANDING ORDERS (from your organizer):");
    expect(live.view.briefing).toContain("Cache one bottle at Camp 3 on the way up.");
    expect(live.view.you.standingOrders).toContain("Cache one bottle");
  });

  it("lets an MCP agent register in the lobby and wait", async () => {
    game = new Game({ generateMs: 0, turnMs: 60_000 });
    server = createHttpServer(game, publicDir);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    const init = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    const initBody = (await init.json()) as { result: { serverInfo: { name: string } } };
    expect(initBody.result.serverInfo.name).toBe("mountaineers");

    const call = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "register_climber", arguments: { name: "Ridgeback" } },
      }),
    });
    const tool = (await call.json()) as { result: { structuredContent: { token: string; phase: string } } };
    expect(tool.result.structuredContent.phase).toBe("lobby");
    const token = tool.result.structuredContent.token;

    const obs = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_observation", arguments: { token } },
      }),
    });
    const waiting = (await obs.json()) as { result: { structuredContent: { waiting: boolean; phase: string } } };
    expect(waiting.result.structuredContent.waiting).toBe(true);
    expect(waiting.result.structuredContent.phase).toBe("lobby");

    await fetch(`${base}/api/start`, { method: "POST", body: JSON.stringify({ fairWeather: true }) });

    const obs2 = await fetch(`${base}/api/observation`, { headers: { Authorization: `Bearer ${token}` } });
    const live = (await obs2.json()) as { phase: string; waiting: boolean; view: { you: { name: string } } };
    expect(live.phase).toBe("climbing");
    expect(live.waiting).toBe(false);
    expect(live.view.you.name).toBe("Ridgeback");
  });

  it("treats LLM providers neutrally: no default model, keyless local endpoints, legacy alias", async () => {
    game = new Game({ generateMs: 0, turnMs: 60_000 });
    server = createHttpServer(game, publicDir);
    const port = await listen(server);
    const add = (body: object) =>
      fetch(`http://127.0.0.1:${port}/api/lobby/climbers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await add({ name: "NoModel", provider: "openai-compat", baseUrl: "http://localhost:1/v1" })).status).toBe(400);
    expect((await add({ name: "NoBase", provider: "openai-compat", model: "m" })).status).toBe(400);
    expect((await add({ name: "XNoKey", provider: "xai", model: "m" })).status).toBe(400);
    expect((await add({ name: "XNoModel", provider: "xai", apiKey: "k" })).status).toBe(400);
    expect((await add({ name: "Local", provider: "openai-compat", baseUrl: "http://localhost:1/v1", model: "m" })).status).toBe(201);
    const legacy = await add({ name: "Legacy", provider: "spacexai", apiKey: "k", model: "m" });
    expect(legacy.status).toBe(201);
    const roster = game.snapshot().lobby.roster;
    expect(roster.find((r) => r.name === "Legacy")?.provider).toBe("xai");
    expect(roster.find((r) => r.name === "Local")?.hasKey).toBe(false);
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no port"));
    });
  });
}
