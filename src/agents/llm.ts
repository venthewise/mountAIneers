import { extractJson, fallbackSay, fallbackWhy, parseAction, type Action, type Observation } from "../engine/index.ts";

export type LlmConfig = {
  provider: "openai-compat" | "xai";
  apiKey: string;
  model: string;
  baseUrl?: string;
};

const CLIMB_COACH = `You are the climber. Output one legal JSON action. Every action MUST include "say" and "why".
"say": a short spoken line (max 100 characters) in the voice of your standing orders. Witty, dumb, brave, reckless — match whatever the organizer wrote. If standing orders are empty, talk like a climber. say is the mutter, not a second action.
"why": a short plain-English reason (max 160 characters) for this turn's choice, from energy, food, oxygen, weather, and the next camp. why is for spectators. It is not spoken.
If energy is under 35 and you have food, output {"act":"rest","say":"...","why":"..."}. Rest is how energy comes back. Wait does not rest.
After you are at 35+ energy: South Col is site "c4", the only door to the summit. If {"act":"move","to":"c4"} is legal and you have no summit tag, output that with say and why. If {"act":"move","to":"summit"} is legal and you have no summit tag, output that.
One oxygen bottle pays for one turn on the col or summit. Do not sit at Camp 3 stocking a full rack of oxygen.
Storms are the only hard stop on going up. Wind and snow are still a go.`;

export async function decideLlm(obs: Observation, cfg: LlmConfig): Promise<Action> {
  const prompt = `${CLIMB_COACH}\n\n${obs.briefing}\n\nReturn only the JSON action object.`;
  const text = cfg.provider === "xai" ? await callXaiResponses(prompt, cfg) : await callChatCompletions(prompt, cfg);
  const parsed = parseAction(extractJson(text) ?? text);
  if (!parsed.ok) return { act: "wait", say: "holding", why: "Could not parse a legal action." };
  return {
    ...parsed.action,
    say: parsed.action.say ?? fallbackSay(parsed.action),
    why: parsed.action.why ?? fallbackWhy(parsed.action),
  };
}

async function callXaiResponses(prompt: string, cfg: LlmConfig): Promise<string> {
  const base = (cfg.baseUrl ?? "https://api.x.ai/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: cfg.model, input: prompt }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`xAI ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    output_text?: string;
    output?: { content?: { type?: string; text?: string }[] }[];
  };
  return (
    data.output_text ??
    data.output?.flatMap((o) => o.content ?? []).find((c) => c.text)?.text ??
    ""
  );
}

async function callChatCompletions(prompt: string, cfg: LlmConfig): Promise<string> {
  const base = (cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}
