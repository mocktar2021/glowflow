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

test("emits a solid visible focus outline that overrides outline-none", async () => {
  const css = await readCssTree(path.join(root, ".next", "static"));
  const none = css.match(/\.outline-none\{[^}]*--tw-outline-style:none;[^}]*outline-style:none/);
  const solid = css.match(/\.focus-visible\\:outline-solid:focus-visible\{[^}]*--tw-outline-style:solid;[^}]*outline-style:solid/);
  assert.ok(none, "the base outline-none utility is present");
  assert.ok(solid, "focus-visible must restore a solid outline style");
  assert.ok(css.indexOf(solid[0]) > css.indexOf(none[0]), "the focus-visible style overrides outline-none");
  assert.match(css, /\.focus-visible\\:outline-2:focus-visible\{[^}]*outline-width:2px/);
  assert.ok(css.includes(String.raw`.focus-visible\:outline-\[\#b77a42\]:focus-visible{outline-color:#b77a42}`), "the compiled focus outline uses the marketplace color");
});

test("emits light and dark focus outlines for marketplace distance controls", async () => {
  const css = await readCssTree(path.join(root, ".next", "static"));
  assert.ok(css.includes(String.raw`.focus-visible\:outline-\[\#8a5728\]:focus-visible{outline-color:#8a5728}`));
  assert.ok(css.includes(String.raw`.dark\:focus-visible\:outline-\[\#efc992\]`));
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
