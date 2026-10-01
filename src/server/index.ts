import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Game } from "./game.ts";
import { createHttpServer } from "./http.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "..", "public");
const port = Number(process.env.PORT ?? 3847);

const game = new Game({
  seed: process.env.SEED ? Number(process.env.SEED) : undefined,
  turnMs: process.env.TURN_MS ? Number(process.env.TURN_MS) : 12_000,
});

const server = createHttpServer(game, publicDir);

server.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`mountAIneers — Thalun 8126 m`);
  console.log(`lobby      http://127.0.0.1:${port}`);
  console.log(`mcp        http://127.0.0.1:${port}/mcp`);
  console.log(`agents     http://127.0.0.1:${port}/skill.md`);
});

function shutdown() {
  game.stop();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
