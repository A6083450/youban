import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const userRoot = Bun.argv.at(-1);
if (!userRoot) throw new Error("Hermes lifecycle fixture root is required");
mkdirSync(userRoot, { recursive: true });
writeFileSync(join(userRoot, "worker.pid"), String(process.pid));

const input = JSON.parse(readFileSync(0, "utf8"));
if (input.text === "stderr-flood") {
  await new Promise((resolve, reject) => {
    process.stderr.write("x".repeat(2 * 1024 * 1024), (error) => error ? reject(error) : resolve());
  });
}

if (input.text === "ignore-termination") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}

console.log(JSON.stringify({
  ok: true,
  output: input.action === "recall" ? "fixture-output" : "",
  items: [],
}));
