import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixture = { clientCalls: 0, claims: null, updated: null, updateError: null };
globalThis.__glowflowLocaleApiFixture = {
  fixture,
  async createClient() {
    fixture.clientCalls += 1;
    return {
      auth: { async getClaims() { return { data: { claims: fixture.claims } }; } },
      from() {
        return {
          update(value) {
            return {
              async eq(column, userId) {
                fixture.updated = { value, column, userId };
                return { error: fixture.updateError };
              },
            };
          },
        };
      },
    };
  },
};

let source = await readFile(new URL("../app/api/preferences/locale/route.ts", import.meta.url), "utf8");
source = source
  .replace('import { NextResponse } from "next/server";', 'const NextResponse = { json: Response.json };')
  .replace('import { z } from "zod";', `const z = {
    enum: values => values,
    object: shape => ({ safeParse(value) {
      return value && typeof value === "object" && shape.locale.includes(value.locale)
        ? { success: true, data: value } : { success: false };
    } }),
  };`)
  .replace('import { createClient } from "@/lib/supabase/server";',
    'const createClient = () => globalThis.__glowflowLocaleApiFixture.createClient();')
  .replace("request: Request", "request");
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("malformed JSON and a hostile parser error fail as generic 400 without logging or database access", async () => {
  const logs = [];
  const original = console.error;
  console.error = (...values) => logs.push(values);
  fixture.clientCalls = 0;
  try {
    const malformed = await POST(new Request("https://example.invalid/api/preferences/locale", {
      method: "POST", body: '{"locale":"fr","email":"private@example.invalid"',
    }));
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { stored: false });

    const hostile = await POST({ async json() { throw new Error("private@example.invalid Bearer secret"); } });
    assert.equal(hostile.status, 400);
    assert.deepEqual(await hostile.json(), { stored: false });
    assert.equal(fixture.clientCalls, 0);
    assert.deepEqual(logs, []);
  } finally {
    console.error = original;
  }
});

test("invalid locale remains 400 and a valid authenticated locale still persists", async () => {
  fixture.clientCalls = 0;
  fixture.claims = { sub: "owner-id" };
  fixture.updated = null;
  const invalid = await POST(new Request("https://example.invalid/api/preferences/locale", {
    method: "POST", body: JSON.stringify({ locale: "de" }),
  }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { stored: false });
  assert.equal(fixture.clientCalls, 0);

  const valid = await POST(new Request("https://example.invalid/api/preferences/locale", {
    method: "POST", body: JSON.stringify({ locale: "es" }),
  }));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { stored: true });
  assert.deepEqual(fixture.updated, { value: { locale: "es" }, column: "id", userId: "owner-id" });
});
