import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/[locale]/dashboard/payments/actions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(failure, { loggerFails = false } = {}) {
  const logs = [];
  const redirects = [];
  const redirectSignal = Symbol("redirect");
  const modules = {
    "next/navigation": { redirect(path) { redirects.push(path); throw redirectSignal; } },
    "next/cache": { revalidatePath() { throw new Error("unexpected revalidation"); } },
    zod: { z: {} },
    "@/lib/i18n": { isLocale: locale => ["fr", "en", "es"].includes(locale) },
    "@/lib/payments/recording": { parseMinorAmount() { throw new Error("unexpected payment recording"); } },
    "@/lib/stripe-sandbox": {
      async sandboxOnboardingUrl() { throw failure; },
      sandboxOwner() { throw new Error("unexpected owner lookup"); },
    },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "console", compiled)(
    name => {
      assert.ok(Object.hasOwn(modules, name), `unexpected import: ${name}`);
      return modules[name];
    },
    loaded,
    loaded.exports,
    { error(line) { if (loggerFails) throw new Error("private logger failure"); logs.push(line); } },
  );
  return { action: loaded.exports.startSandboxOnboarding, logs, redirects, redirectSignal };
}

async function expectRedirect(f, path, locale = "fr") {
  await assert.rejects(f.action(locale), error => error === f.redirectSignal);
  assert.deepEqual(f.redirects, [path]);
}

test("known sandbox failure logs only fixed fields and keeps its safe redirect", async () => {
  const error = Object.assign(new Error("market_unavailable"), {
    type: "StripeCardError", code: "client_private", requestId: "req_private", statusCode: 503,
  });
  const f = fixture(error);
  await expectRedirect(f, "/fr/dashboard/payments?error=market_unavailable");
  assert.deepEqual(f.logs.map(JSON.parse), [{
    event: "stripe_sandbox_onboarding_failed", reason: "market_unavailable", statusCode: 503,
  }]);
  assert.ok(!f.logs[0].includes("client_private"));
  assert.ok(!f.logs[0].includes("req_private"));
});

test("throwing provider getters and proxy traps cannot escape or leak into logs", async () => {
  const secret = "client@example.invalid bearer_private";
  const hostile = new Proxy(new Error("provider failure"), {
    get(target, property) {
      if (["message", "statusCode", "type", "code", "requestId"].includes(property)) {
        throw new Error(secret);
      }
      return Reflect.get(target, property);
    },
  });
  const f = fixture(hostile);
  await expectRedirect(f, "/fr/dashboard/payments?error=sandbox_unavailable");
  assert.deepEqual(f.logs.map(JSON.parse), [{
    event: "stripe_sandbox_onboarding_failed", reason: "sandbox_unavailable",
  }]);
  assert.ok(!f.logs[0].includes(secret));
  assert.ok(!JSON.stringify(f.redirects).includes(secret));
});

test("a changing error message cannot inject an unapproved reason into logs or redirects", async () => {
  const error = new Error("owner_required");
  let reads = 0;
  Object.defineProperty(error, "message", { get() { return ++reads === 1 ? "owner_required" : "client_private"; } });
  const f = fixture(error);
  await expectRedirect(f, "/fr/dashboard/payments?error=owner_required");
  assert.equal(reads, 1);
  assert.deepEqual(f.logs.map(JSON.parse), [{
    event: "stripe_sandbox_onboarding_failed", reason: "owner_required",
  }]);
});

test("a failed logger never replaces the generic failure redirect", async () => {
  const f = fixture(new Error("client@example.invalid"), { loggerFails: true });
  await expectRedirect(f, "/fr/dashboard/payments?error=sandbox_unavailable");
  assert.deepEqual(f.logs, []);
});

test("generic failures preserve English and Spanish return routes", async () => {
  for (const locale of ["en", "es"]) {
    const f = fixture(new Error("client@example.invalid"));
    await expectRedirect(f, `/${locale}/dashboard/payments?error=sandbox_unavailable`, locale);
    assert.deepEqual(f.logs.map(JSON.parse), [{
      event: "stripe_sandbox_onboarding_failed", reason: "sandbox_unavailable",
    }]);
  }
});
