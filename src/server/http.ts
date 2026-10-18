import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Game, Provider } from "./game.ts";
import { handleMcp } from "./mcp.ts";
import { OPENAPI } from "./openapi.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-agent-token, MCP-Protocol-Version, Mcp-Session-Id",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function tokenOf(req: IncomingMessage, url: URL): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const alt = req.headers["x-agent-token"];
  if (typeof alt === "string" && alt) return alt;
  return url.searchParams.get("token");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export function createHttpServer(game: Game, publicDir: string) {
  const publicRoot = resolve(publicDir);

  return createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "localhost";
      const url = new URL(req.url ?? "/", `http://${host}`);
      cors(res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        json(res, 200, { ok: true, game: "mountaineers", peak: "Thalun", phase: game.phase });
        return;
      }
      if (req.method === "GET" && url.pathname === "/openapi.json") {
        json(res, 200, OPENAPI);
        return;
      }
      if (req.method === "GET" && (url.pathname === "/api/expedition" || url.pathname === "/api/lobby")) {
        json(res, 200, game.snapshot());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/lobby/climbers") {
        const body = (await readJson(req)) as {
          name?: string;
          provider?: string;
          model?: string;
          apiKey?: string;
          baseUrl?: string;
          style?: string;
          standingOrders?: string;
        };
        // "spacexai" is accepted as a legacy alias for "xai".
        const provider = (body.provider === "spacexai" ? "xai" : body.provider) as Provider | undefined;
        if (provider !== "heuristic" && provider !== "openai-compat" && provider !== "xai") {
          return json(res, 400, { error: "provider must be heuristic | openai-compat | xai" });
        }
        json(res, 201, game.addConfigured({ ...body, name: body.name ?? "", provider }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/lobby/team") {
        json(res, 201, { roster: game.addHeuristicTeam() });
        return;
      }
      if (req.method === "PATCH" && url.pathname.startsWith("/api/lobby/climbers/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/lobby/climbers/".length));
        const body = (await readJson(req)) as {
          name?: string;
          style?: string;
          standingOrders?: string;
        };
        json(res, 200, game.patchClimber(id, body));
        return;
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/api/lobby/climbers/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/lobby/climbers/".length));
        game.removeClimber(id);
        json(res, 200, game.snapshot());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/start") {
        const body = (await readJson(req)) as { seed?: number; fairWeather?: boolean };
        json(res, 200, game.start({ seed: body.seed, fairWeather: body.fairWeather }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/lobby") {
        json(res, 200, game.returnToLobby());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/tick") {
        json(res, 200, game.tick("force"));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/agents") {
        const body = (await readJson(req)) as { name?: string; kind?: string; standingOrders?: string };
        if (body.kind === "human") {
          return json(res, 400, { error: "climbers must be AI agents" });
        }
        const result = game.addExternalClimber(body.name ?? "agent", {
          standingOrders: body.standingOrders,
        });
        json(res, 201, {
          ...result,
          observation_url: "/api/observation",
          action_url: "/api/action",
          hint: "Wait until observation.phase is climbing, then act. Authorization: Bearer <token>.",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/observation") {
        const token = tokenOf(req, url);
        if (!token) return json(res, 401, { error: "missing token" });
        json(res, 200, game.observation(token));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/action") {
        const token = tokenOf(req, url);
        if (!token) return json(res, 401, { error: "missing token" });
        const body = await readJson(req);
        json(res, 200, game.act(token, body));
        return;
      }
      if (req.method === "GET" && url.pathname === "/mcp") {
        json(res, 200, {
          name: "mountaineers",
          transport: "json-rpc POST /mcp",
          tools: ["register_climber", "get_observation", "submit_action", "get_expedition"],
          hint: "POST JSON-RPC initialize, then tools/call register_climber. Wait for Start.",
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/mcp") {
        const body = await readJson(req);
        const out = handleMcp(game, body);
        if (out.status === 202) {
          cors(res);
          res.writeHead(202);
          res.end();
          return;
        }
        json(res, out.status, out.body);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        req.socket.setTimeout(0);
        const send = (snap: ReturnType<Game["snapshot"]>) => {
          res.write(`data: ${JSON.stringify(snap)}\n\n`);
        };
        send(game.snapshot());
        const unsub = game.subscribe(send);
        req.on("close", unsub);
        return;
      }

      await servePublic(res, publicRoot, url.pathname);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : "server error";
      if (status >= 500) console.error(err);
      json(res, status, { error: message });
    }
  });
}

async function servePublic(res: ServerResponse, publicRoot: string, pathname: string): Promise<void> {
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = decodeURIComponent(rel);
  const target = resolve(join(publicRoot, normalize(rel)));
  if (!target.startsWith(publicRoot)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (!existsSync(target)) {
    cors(res);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  const data = await readFile(target);
  res.writeHead(200, { "Content-Type": MIME[extname(target)] ?? "application/octet-stream" });
  res.end(data);
}
