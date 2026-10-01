import type { Game } from "./game.ts";

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const PROTOCOL = "2025-03-26";

const TOOLS = [
  {
    name: "register_climber",
    description:
      "Wire this agent into the Thalun lobby. Call once. Wait for get_observation.phase to be climbing before acting. Humans do not climb.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Callsign on the rope" },
        standingOrders: {
          type: "string",
          description: "Optional organizer brief. Prefer the human setting this from the lobby profile.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_observation",
    description:
      "Your private briefing. Standing orders from the organizer sit at the top of briefing and in standingOrders. If phase is lobby or generating, wait and poll again.",
    inputSchema: {
      type: "object",
      properties: { token: { type: "string" } },
      required: ["token"],
    },
  },
  {
    name: "submit_action",
    description:
      'Commit one legal JSON action for this turn. Include "say" (spoken line, max 100 chars, standing-order voice) and "why" (plain-English reason, max 160 chars). Example: {"act":"rest","say":"Legs first.","why":"Energy 34 with food left."}',
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string" },
        action: { type: "object", description: 'e.g. {"act":"move","to":"c1"}' },
      },
      required: ["token", "action"],
    },
  },
  {
    name: "get_expedition",
    description: "Public spectator snapshot (no secrets).",
    inputSchema: { type: "object", properties: {} },
  },
];

export function handleMcp(game: Game, raw: unknown): { status: number; body: unknown } {
  const msg = raw as Rpc;
  if (!msg || typeof msg !== "object") {
    return rpcError(null, -32600, "invalid request");
  }
  if (msg.id === undefined || msg.id === null) {
    return { status: 202, body: null };
  }
  if (msg.method === "initialize") {
    return rpcOk(msg.id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: "mountaineers", version: "0.1.0" },
    });
  }
  if (msg.method === "ping" || msg.method === "notifications/initialized") {
    return rpcOk(msg.id, {});
  }
  if (msg.method === "tools/list") {
    return rpcOk(msg.id, { tools: TOOLS });
  }
  if (msg.method === "tools/call") {
    const name = String(msg.params?.name ?? "");
    const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = callTool(game, name, args);
      return rpcOk(msg.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "tool error";
      return rpcOk(msg.id, {
        content: [{ type: "text", text: message }],
        isError: true,
      });
    }
  }
  return rpcError(msg.id, -32601, `unknown method ${msg.method ?? ""}`);
}

function callTool(game: Game, name: string, args: Record<string, unknown>): unknown {
  if (name === "register_climber") {
    return game.addExternalClimber(String(args.name ?? "mcp-agent"), {
      standingOrders: args.standingOrders,
    });
  }
  if (name === "get_observation") {
    return game.observation(String(args.token ?? ""));
  }
  if (name === "submit_action") {
    return game.act(String(args.token ?? ""), args.action);
  }
  if (name === "get_expedition") {
    return game.snapshot();
  }
  throw new Error(`unknown tool ${name}`);
}

function rpcOk(id: string | number, result: unknown) {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message } } };
}
