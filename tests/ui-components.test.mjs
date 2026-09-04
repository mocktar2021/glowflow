import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits the catalog's animation and scrolling utilities", async () => {
  const css = await readCssTree(path.join(root, ".next", "static"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /scroll-fade-reveal-b/);
  assert.match(css, /mask-image:/);
  assert.match(css, /tw-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const source = await readFile(path.join(root, "components", "ui", "progress.tsx"), "utf8");

  assert.match(source, /ProgressPrimitive\.Root/);
  assert.match(source, /value=\{value\}/);
  assert.match(source, /ProgressPrimitive\.Indicator/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const source = await readFile(path.join(root, "components", "ui", "chart.tsx"), "utf8");

  assert.match(source, /data-chart=/);
  assert.match(source, /dark: "\(prefers-color-scheme: dark\)"/);
  assert.match(source, /@media \$\{media\}/);
});

test("renders sidebar skeletons deterministically", async () => {
  const source = await readFile(path.join(root, "components", "ui", "sidebar.tsx"), "utf8");

  assert.match(source, /--skeleton-width/);
  assert.match(source, /70%/);
  assert.doesNotMatch(source, /Math\.random/);
});
