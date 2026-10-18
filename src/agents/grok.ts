import { decideLlm } from "./llm.ts";
import type { Action, Observation } from "../engine/index.ts";

export async function decideGrok(obs: Observation, apiKey: string): Promise<Action> {
  return decideLlm(obs, {
    provider: "spacexai",
    apiKey,
    model: process.env.XAI_MODEL ?? "grok-4.3",
    baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
  });
}
