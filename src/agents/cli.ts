import { decideGrok } from "./grok.ts";
import { decideLlm } from "./llm.ts";
import { decideHeuristic, type Observation } from "../engine/index.ts";

const base = (process.env.MOUNTAIN_URL ?? "http://127.0.0.1:3847").replace(/\/$/, "");

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function json(path: string, opts: RequestInit & { token?: string } = {}) {
  const headers = new Headers(opts.headers);
  if (opts.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  const res = await fetch(`${base}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as never;
}

async function playOne(name: string, kind: "heuristic" | "llm") {
  const key = process.env.XAI_API_KEY;
  // Any OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama, LM Studio, vLLM...) wins if fully set.
  const compat =
    process.env.LLM_BASE_URL && process.env.LLM_MODEL
      ? { baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL, apiKey: process.env.LLM_API_KEY ?? "" }
      : null;
  const useCompat = kind === "llm" && Boolean(compat);
  const useGrok = kind === "llm" && !useCompat && Boolean(key);
  const useLlm = useCompat || useGrok;
  const reg = await json("/api/agents", {
    method: "POST",
    body: JSON.stringify({ name, kind: useLlm ? "llm" : "heuristic" }),
  });
  const token = (reg as { token: string }).token;
  const label = useCompat
    ? `openai-compat/${compat!.model}`
    : useGrok
      ? "SpaceXAI/" + (process.env.XAI_MODEL ?? "grok-4.3")
      : "heuristic";
  console.log(`roped in ${name} as ${label}`);

  let lastTurn = -1;
  let announcedWait = false;
  while (true) {
    const obs = (await json("/api/observation", { token })) as {
      phase?: string;
      ended: boolean;
      committed: boolean;
      waiting?: boolean;
      view: Observation | null;
    };
    if (obs.waiting || obs.phase === "lobby" || obs.phase === "generating") {
      if (!announcedWait) {
        console.log(`${name}: waiting for Start`);
        announcedWait = true;
      }
      await sleep(400);
      continue;
    }
    if (obs.ended || obs.phase === "ended") {
      console.log(`${name}: season over`);
      return;
    }
    if (!obs.view?.you.alive) {
      console.log(`${name}: ${obs.view?.you.cause ?? "off the mountain"}`);
      return;
    }
    if (obs.committed) {
      await sleep(400);
      continue;
    }
    const turn = obs.view.turn;
    if (turn !== lastTurn) {
      lastTurn = turn;
      const action =
        useCompat && compat
          ? await decideLlm(obs.view, { provider: "openai-compat", ...compat })
          : useGrok && key
            ? await decideGrok(obs.view, key)
            : decideHeuristic(obs.view);
      try {
        await json("/api/action", { method: "POST", token, body: JSON.stringify(action) });
        console.log(`T${turn} ${name}: ${JSON.stringify(action)}`);
      } catch (err) {
        console.log(`T${turn} ${name} rejected (${(err as Error).message}), waiting`);
        try {
          await json("/api/action", { method: "POST", token, body: JSON.stringify({ act: "wait" }) });
        } catch {
          /* committed */
        }
      }
    }
    await sleep(350);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const botCount = Number(arg("--bots") ?? (has("--bots") ? "3" : "0"));
const name = arg("--name") ?? (botCount ? undefined : "Grok");
const kind = has("--heuristic") ? "heuristic" : "llm";

if (botCount > 0) {
  const names = ["Serac", "Cornice", "Scree", "Bergschrund"].slice(0, botCount);
  await Promise.all(names.map((n) => playOne(n, "heuristic")));
} else if (name) {
  await playOne(name, kind);
} else {
  console.error("usage: npm run agent -- --name MyBot   or   npm run bots");
  process.exit(1);
}
