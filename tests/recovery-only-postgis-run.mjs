import { randomBytes, randomInt } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

// Versioned gate migration on a disposable loopback PostGIS INSTANCE only.
const supplied = process.env.GLOWFLOW_RLS_ADMIN_DATABASE_URL;
let admin;
try { admin = new URL(supplied); } catch { throw new Error("Disposable loopback PostgreSQL admin URL required."); }
if (!["postgres:", "postgresql:"].includes(admin.protocol)
  || !["127.0.0.1", "localhost", "[::1]"].includes(admin.hostname)
  || admin.pathname !== "/postgres" || admin.search || admin.hash) {
  throw new Error("Only a disposable loopback PostgreSQL admin URL ending in /postgres is allowed.");
}
const psql = process.env.PSQL_BIN || "psql";
const database = `glowflow_route_postgis_test_${Date.now()}_${randomInt(1_000_000)}`;
const testUrl = new URL(admin);
testUrl.pathname = `/${database}`;
function command(query) {
  try {
    execFileSync(psql, ["-X", "-w", "-q", "-v", "ON_ERROR_STOP=1", "-d", admin.href, "-c", query],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  } catch { throw new Error("Disposable PostgreSQL create/drop failed."); }
}
function sql(input, step) {
  const result = spawnSync(psql, ["-X", "-w", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", testUrl.href],
    { input, encoding: "utf8", timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Disposable PostgreSQL step failed: " + step);
  return result.stdout.trim().split("\n").at(-1);
}

let created = false;
try {
  command(`CREATE DATABASE "${database}"`);
  created = true;
  sql(readFileSync("tests/supabase-platform-fixture.sql", "utf8"), "platform fixture");
  sql(readFileSync("supabase/schema.sql", "utf8"), "baseline schema");
  for (const migration of readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort()) {
    sql(readFileSync(`supabase/migrations/${migration}`, "utf8"), migration);
  }
  sql(readFileSync("tests/public-booking-v2-postgis-fixture.sql", "utf8"), "fictional fixture");
  // The ordered migration set installed the legacy-mode contract gate.
  assertState("legacy");
  sql("select private.transition_public_booking_mode('legacy','frozen')", "freeze local contract");
  sql("select private.transition_public_booking_mode('frozen','v2')", "open local v2 preparation");
  assertState("v2");
  const slots = JSON.parse(sql(`set role service_role;
    select coalesce(jsonb_agg(slot_start order by slot_start), '[]'::jsonb)
    from (select slot_start from public.get_public_booking_slots('route-fixture',
      '40000000-0000-0000-0000-000000000001',
      current_date + (8 - extract(dow from current_date)::integer))
      where staff_id='20000000-0000-0000-0000-000000000002'
      order by slot_start limit 3) as choices`, "future fictional slots"));
  if (slots.length !== 3 || new Set(slots).size !== 3) throw new Error("Three fictional slots are required.");
  const nonce = randomBytes(32).toString("hex");
  sql(`create table private.glowflow_recovery_only_runner_marker (
    singleton boolean primary key check (singleton), nonce text not null check (nonce ~ '^[0-9a-f]{64}$')
  ); insert into private.glowflow_recovery_only_runner_marker values (true,'${nonce}')`, "runner marker");
  const childEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, CI: process.env.CI,
    TMPDIR: process.env.TMPDIR, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    PSQL_BIN: process.env.PSQL_BIN,
    GLOWFLOW_ROUTE_POSTGIS_TEST_DATABASE_URL: testUrl.href,
    GLOWFLOW_RECOVERY_ONLY_RUNNER_NONCE: nonce,
    GLOWFLOW_RECOVERY_ONLY_SLOTS: JSON.stringify(slots),
    GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY: randomBytes(32).toString("base64url"),
    GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY: randomBytes(32).toString("base64url"),
  };
  const result = spawnSync(process.execPath, ["--test", "tests/recovery-only-next-postgis.test.mjs"], {
    cwd: process.cwd(), stdio: "inherit", timeout: 600_000,
    env: Object.fromEntries(Object.entries(childEnv).filter(([, value]) => value !== undefined)),
  });
  if (result.error) throw new Error("Disposable recovery-only route test did not finish.");
  process.exitCode = result.status ?? 1;
} finally {
  if (created) command(`DROP DATABASE "${database}" WITH (FORCE)`);
}

function assertState(expected) {
  if (sql("select mode from private.public_booking_contract_gate where singleton", "gate state") !== expected) {
    throw new Error("Disposable booking gate did not reach the expected state.");
  }
}
