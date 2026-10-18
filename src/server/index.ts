import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Game } from "./game.ts";
import { createHttpServer } from "./http.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "..", "public");
const port = Number(process.env.PORT ?? 3847);
const host = process.env.HOST ?? "127.0.0.1";

const game = new Game({
  seed: process.env.SEED ? Number(process.env.SEED) : undefined,
  turnMs: process.env.TURN_MS ? Number(process.env.TURN_MS) : 12_000,
});

const server = createHttpServer(game, publicDir);

server.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
server.listen(port, host, () => {
  const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  console.log(`mountAIneers — Thalun 8126 m`);
  console.log(`lobby      http://${shown}:${port}`);
  console.log(`mcp        http://${shown}:${port}/mcp`);
  console.log(`agents     http://${shown}:${port}/skill.md`);
});

function shutdown() {
  game.stop();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
