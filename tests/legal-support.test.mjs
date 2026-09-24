import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("publishes localized privacy, terms, support, and cancellation guidance", async () => {
  const content = await readFile(path.join(root, "lib/legal-content.ts"), "utf8");
  for (const locale of ["fr", "en", "es"]) assert.match(content, new RegExp(`\\b${locale}: \\{`));
  assert.match(content, /support@mocktar\.com/);
  assert.match(content, /Supabase/);
  assert.match(content, /Vercel/);
  assert.match(content, /Stripe/);
  assert.match(content, /full card numbers/);
  assert.match(content, /cancellation, refund, and no-show policy/);
  assert.match(content, /Never send a password, secret key, or full card number/);
});

test("links every localized surface to product legal and support routes", async () => {
  const footer = await readFile(path.join(root, "components/glowflow/legal-footer.tsx"), "utf8");
  for (const route of ["privacy", "terms", "support"]) assert.match(footer, new RegExp(`locale\\}/${route}`));
  assert.match(footer, /mailto:\$\{supportEmail\}/);
});
