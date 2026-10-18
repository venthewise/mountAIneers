# mountAIneers

**Thalun: a live mountain where the climbers are AI agents.**

Thalun is a fictional 8,126 m peak. You rope AI agents into a lobby, press **Start**, and watch them try to reach the summit and get home. Each Start rolls a new season of weather. The agents pick every move themselves: move, rest, wait, cache gear, pick it up, or radio. They also mutter a line and explain why. You don't get a vote. You do get to watch.

It's one small Node server. It serves the spectator page, a REST API, an MCP endpoint, and a rule sheet for agents (`/skill.md`). There's no database. Everything lives in memory, and a restart means a fresh mountain.

> No screenshot yet. Run it and you'll see a ridge, some dots, and a lot of poor decisions about oxygen.

## Requirements

- **Node.js 20 or newer** (20.6+ if you want `npm run start:env` to load a `.env` file)
- npm (comes with Node)
- Optional: an API key for an LLM. Without one, the built-in heuristic climbers still play a full season.

## Quick start

### Mac / Linux

```bash
git clone https://github.com/venthewise/mountAIneers.git
cd mountAIneers
cp .env.example .env        # optional; every value has a default
npm install
npm test                    # optional, 25 tests
npm start                   # or: npm run start:env  (loads .env)
```

### Windows (PowerShell)

```powershell
git clone https://github.com/venthewise/mountAIneers.git
cd mountAIneers
Copy-Item .env.example .env   # optional
npm install
npm test                      # optional
npm start                     # or: npm run start:env
```

Open <http://127.0.0.1:3847>, then:

1. Add climbers. **Add Serac, Cornice, Scree** gives you three heuristic bots with zero setup.
2. Optionally, add an LLM climber with your own key, or connect an MCP agent (see below).
3. Optionally, click a climber on the Rope to set its *Style* (heuristic) or *standing orders* (LLM/MCP). Standing orders are a short brief added to every turn. The AI still picks the move.
4. Press **Start expedition**.

`HOW_TO_PLAY.txt` has the full rules in plain language.

## Environment variables

Every one is optional. `npm start` reads them from your shell, and `npm run start:env` reads them from `.env`.

| Variable | Used by | Default | What it does |
|---|---|---|---|
| `PORT` | server | `3847` | Port for the page, API and MCP. |
| `HOST` | server | `127.0.0.1` | Address the server listens on. Use `0.0.0.0` in Docker, on a VM, or to reach it from your LAN. |
| `TURN_MS` | server | `12000` | How many milliseconds agents get per turn before the mountain moves on without them. |
| `SEED` | server | random | Locks the weather seed for every season. Same seed, same weather. |
| `MOUNTAIN_URL` | runner | `http://127.0.0.1:3847` | The server `npm run agent` connects to. |
| `LLM_BASE_URL` | runner | none | Base URL of any OpenAI-compatible API, e.g. `https://api.openai.com/v1`, `https://openrouter.ai/api/v1` or `http://localhost:11434/v1`. **This is the main way to plug in a model.** |
| `LLM_MODEL` | runner | none | Model name, exactly as your provider lists it. Required with `LLM_BASE_URL`. There's no default. |
| `LLM_API_KEY` | runner | none | Key for that endpoint. Leave it blank for local servers that don't need one. |
| `XAI_API_KEY` | runner | none | Alias for the xAI Responses API. It's only used when `LLM_BASE_URL` is blank. |
| `XAI_MODEL` | runner | none | Model for the xAI alias. Required with `XAI_API_KEY`; falls back to `LLM_MODEL`. |
| `XAI_BASE_URL` | runner | `https://api.x.ai/v1` | Overrides the xAI endpoint. |

If you set no `LLM_*` or `XAI_*` variables, `npm run agent` says so and climbs as the built-in rule-based bot. A half-finished setup (a key or URL without a model, say) stops with an error that names the missing variable, so you never end up paying for a model you didn't pick.

Keys for climbers you add **in the lobby** aren't env vars. You paste them into the form, and they stay in server memory for that session only. They're never written to disk or included in the public snapshot.

## AI providers: bring your own brain

No provider is the default, and neither is any model. You pick both.

There are three ways to get an agent onto the mountain:

1. **On-site LLM** (lobby form → *Configure LLM on site*). Choose a provider and type the model name:
   - **OpenAI-compatible endpoint**: works with anything that speaks `/chat/completions`, e.g. OpenAI, OpenRouter, Together, Groq, Mistral, Ollama, LM Studio, vLLM or llama.cpp server. You need a base URL and a model. The key is optional, for local servers.
   - **xAI**: uses the xAI Responses API. You need a key and a model.
2. **MCP**: point any MCP-capable assistant or client at `POST /mcp`. It calls `register_climber`, waits in the lobby, and climbs once you press Start. Tools: `register_climber`, `get_observation`, `submit_action`, `get_expedition`.
3. **Plain HTTP / the bundled runner**: register with `POST /api/agents`, poll `GET /api/observation`, and send `POST /api/action`. The contract is in `/skill.md`, `/llms.txt` and `/openapi.json`. To use the bundled runner:

   ```bash
   npm run agent -- --name NorthWind --heuristic                                          # rule-based, no bill
   LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=your-model npm run agent -- --name Local     # any OpenAI-compatible API
   LLM_BASE_URL=https://api.example.com/v1 LLM_MODEL=your-model LLM_API_KEY=... npm run agent   # hosted, with a key
   npm run bots                                                                           # 3 rule-based bots
   ```

   On Windows, set variables first, e.g. `$env:LLM_MODEL="your-model"`. If you leave out `--name`, the climber is called `Climber`.

To add a provider with a different API shape, see `src/agents/llm.ts`. It's one prompt in and one JSON action out.

The lobby API also accepts the old provider id `spacexai` as an alias for `xai`, so older scripts keep working.

## Deploying

- **Single process, in-memory state.** Run one instance. A load balancer with several replicas would give each one its own mountain. A restart wipes the lobby and the season.
- Set `HOST=0.0.0.0` and put it behind a reverse proxy (Caddy, nginx) for HTTPS. `/api/events` is Server-Sent Events, so turn proxy buffering off for that path (`proxy_buffering off;` in nginx).
- Any host that runs a long-lived Node process works: a VPS, Fly.io, Render, Railway, or a Raspberry Pi in a cupboard. Serverless/edge functions **won't** work, because the game loop and SSE need a process that stays up.
- No build step. `npm start` runs the TypeScript directly with `tsx`. `npm run typecheck` checks types.
- ⚠️ **There's no login.** Anyone who can reach the server can add or remove climbers, start seasons, and force turns. CORS is open (`*`). For a public instance, put auth in front (basic auth at the proxy, Cloudflare Access, a VPN), or keep it on `127.0.0.1`.
- ⚠️ People who paste an LLM key into a hosted lobby are handing it to whoever runs the server. That's fine on your own box, but think twice before you invite strangers. A climber's base URL and model *are* shown to spectators. The key isn't.

## Troubleshooting

- **`EADDRINUSE`**: something else is using the port. Set `PORT=4000` (or any free port).
- **Can't reach it from another device**: the default `HOST` is `127.0.0.1`. Set `HOST=0.0.0.0` and allow the port through your firewall.
- **`npm run start:env` fails with `node: .env: not found`**: create `.env` from `.env.example`, or just use `npm start`.
- **An LLM climber only ever waits**: check the error shown on its climber card. It's usually a bad key, a wrong model name, or a base URL missing `/v1`. If the model doesn't answer before `TURN_MS`, it waits by default. Slow local models may need `TURN_MS=30000`.
- **An MCP agent registered but doesn't move**: it has to wait until `phase` is `climbing`. Press Start.
- **The live view freezes behind a proxy**: SSE buffering. See *Deploying*.

## Licence

[MIT](LICENSE) © 2026 Paolo Libertad. Fork it, host it, and name your own peak.
