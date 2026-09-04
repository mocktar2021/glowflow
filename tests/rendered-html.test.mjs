import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 32000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  {
    cwd: root,
    env: { ...process.env, HOSTNAME: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

after(() => {
  server.kill("SIGTERM");
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited before startup:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${origin}/fr/login`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not start in time:\n${serverOutput}`);
}

test("renders localized authentication and booking routes in production", { timeout: 30000 }, async () => {
  await waitForServer();

  for (const route of [
    "/fr/login",
    "/en/register",
    "/es/forgot-password",
    "/fr/book/atelier-belle",
  ]) {
    const response = await fetch(`${origin}${route}`, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.match(await response.text(), /GlowFlow/);
  }
});
