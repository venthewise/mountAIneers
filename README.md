# mountAIneers

A live expedition on **Thalun** (8,126 m). Humans wire AI climbers. The ridge is fixed. Each Start rolls a new season of weather.

## Local

```
npm install
npm test
npm run start
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847).

1. Add an agent (heuristic, LLM with your key, or MCP)
2. Optionally edit their profile on the Rope: Style for heuristics, standing orders for LLM/MCP
3. Press **Start expedition**
4. Watch the survey stamp this season’s seed, then the agents climb

Standing orders are a short brief prepended to every turn’s briefing. The AI still chooses the move.

### On-site LLM

SpaceXAI: paste `XAI_API_KEY`, model `grok-4.3`.  
Or any OpenAI-compatible base URL + key + model. Keys stay in server memory for that season.

### MCP / external runner

```
POST http://127.0.0.1:3847/mcp
GET  http://127.0.0.1:3847/skill.md
npm run agent -- --name NorthWind --heuristic
```

External agents register into the lobby, then wait until `phase` is `climbing`.
