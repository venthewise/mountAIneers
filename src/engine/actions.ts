import type { Action, Item, SiteId } from "./types.ts";
import { PEAK, RADIO_MAX, SAY_MAX, WHY_MAX } from "./peak.ts";

const SITES = new Set<string>(Object.keys(PEAK.sites));
const ITEMS = new Set<Item>(["o2", "food"]);

export function parseAction(raw: unknown): { ok: true; action: Action } | { ok: false; error: string } {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      const extracted = extractJson(raw);
      if (!extracted) return { ok: false, error: "action must be JSON" };
      raw = extracted;
    }
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "action must be an object" };
  const a = raw as Record<string, unknown>;
  const act = a.act;
  if (act === "rest") return { ok: true, action: withSidecars({ act: "rest" }, a) };
  if (act === "wait") return { ok: true, action: withSidecars({ act: "wait" }, a) };
  if (act === "move") {
    if (typeof a.to !== "string" || !SITES.has(a.to)) {
      return { ok: false, error: `move.to must be one of ${[...SITES].join(", ")}` };
    }
    return { ok: true, action: withSidecars({ act: "move", to: a.to as SiteId }, a) };
  }
  if (act === "cache" || act === "take") {
    if (typeof a.item !== "string" || !ITEMS.has(a.item as Item)) {
      return { ok: false, error: `${act}.item must be o2 or food` };
    }
    const qty = a.qty === undefined ? 1 : Number(a.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 8) {
      return { ok: false, error: `${act}.qty must be an integer 1–8` };
    }
    return { ok: true, action: withSidecars({ act, item: a.item as Item, qty }, a) };
  }
  if (act === "radio") {
    if (typeof a.msg !== "string" || !a.msg.trim()) {
      return { ok: false, error: "radio.msg must be a non-empty string" };
    }
    const msg = a.msg.trim().slice(0, RADIO_MAX);
    return { ok: true, action: withSidecars({ act: "radio", msg }, a) };
  }
  return {
    ok: false,
    error: 'act must be move | rest | wait | cache | take | radio',
  };
}

export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function clipSay(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, SAY_MAX);
  return t || undefined;
}

export function clipWhy(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, WHY_MAX);
  return t || undefined;
}

function withSidecars<T extends Action>(action: T, raw: Record<string, unknown>): T {
  const say = clipSay(raw.say);
  const why = clipWhy(raw.why);
  return { ...action, ...(say ? { say } : {}), ...(why ? { why } : {}) };
}

export function fallbackSay(action: Action): string {
  if (action.act === "move") return `heading to ${PEAK.sites[action.to].name}`;
  if (action.act === "rest") return "resting";
  if (action.act === "wait") return "waiting";
  if (action.act === "cache") return `stashing ${action.item}`;
  if (action.act === "take") return `grabbing ${action.item}`;
  return action.msg.trim().slice(0, SAY_MAX);
}

export function fallbackWhy(action: Action): string {
  if (action.act === "move") return `Heading to ${PEAK.sites[action.to].name}.`;
  if (action.act === "rest") return "Resting to recover energy.";
  if (action.act === "wait") return "Waiting this turn.";
  if (action.act === "cache") return `Stashing ${action.qty} ${action.item}.`;
  if (action.act === "take") return `Taking ${action.qty} ${action.item} from the cache.`;
  return "Calling the rope.";
}

export function spokenLine(action: Action): string {
  return clipSay(action.say) ?? fallbackSay(action);
}

export function reasonLine(action: Action): string {
  return clipWhy(action.why) ?? fallbackWhy(action);
}

export function actionSpecs(action: Action): string {
  const parts = [`ACT: ${action.act}`];
  if (action.act === "move") parts.push(`TO: ${action.to}`);
  if (action.act === "cache" || action.act === "take") {
    parts.push(`ITEM: ${action.item}`, `QTY: ${action.qty}`);
  }
  if (action.act === "radio") {
    const msg = action.msg.replace(/\s+/g, " ").trim().slice(0, 80);
    if (msg) parts.push(`MSG: ${msg}`);
  }
  parts.push(`SAY: ${spokenLine(action)}`);
  parts.push(`WHY: ${reasonLine(action)}`);
  return parts.join(" · ");
}

export function actionLabel(action: Action): string {
  switch (action.act) {
    case "move":
      return `move → ${PEAK.sites[action.to].name}`;
    case "rest":
      return "rest";
    case "wait":
      return "wait";
    case "cache":
      return `cache ${action.qty} ${action.item}`;
    case "take":
      return `take ${action.qty} ${action.item}`;
    case "radio":
      return `radio: ${action.msg}`;
  }
}
