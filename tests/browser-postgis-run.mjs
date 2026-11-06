import { randomBytes, randomInt } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

// CI-only runner. The platform fixture can create cluster roles, so the
// loopback PostgreSQL INSTANCE must be disposable, not merely this database.
const supplied = process.env.GLOWFLOW_RLS_ADMIN_DATABASE_URL;
let admin;
try { admin = new URL(supplied); } catch { throw new Error("Disposable loopback PostgreSQL admin URL required."); }
if (!["postgres:", "postgresql:"].includes(admin.protocol)
  || !["localhost", "127.0.0.1", "[::1]"].includes(admin.hostname)
  || admin.pathname !== "/postgres" || admin.search || admin.hash) {
  throw new Error("Only a disposable loopback PostgreSQL admin URL ending in /postgres is allowed.");
}
const psql = process.env.PSQL_BIN || "psql";
const scenario = process.env.GLOWFLOW_BROWSER_POSTGIS_SCENARIO ?? "current_v2";
if (!["current_v2", "recovery_only", "recovery_only_noncommitted"].includes(scenario)) {
  throw new Error("Unsupported disposable browser-PostGIS scenario.");
}
const database = `glowflow_route_postgis_test_${Date.now()}_${randomInt(1_000_000)}`;
const testUrl = new URL(admin);
testUrl.pathname = `/${database}`;
function command(query) {
  try {
    execFileSync(psql, ["-X", "-w", "-q", "-v", "ON_ERROR_STOP=1", "-d", admin.href, "-c", query],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  } catch { throw new Error("Disposable PostgreSQL setup or cleanup failed."); }
}
function sql(input, step) {
  const result = spawnSync(psql, ["-X", "-w", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", testUrl.href],
    { input, encoding: "utf8", timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Disposable PostgreSQL fixture failed: " + step);
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
  sql(readFileSync("tests/public-booking-v2-postgis-fixture.sql", "utf8"), "fictional booking fixture");
  if (sql("select private.transition_public_booking_mode('legacy','frozen'); "
    + "select private.transition_public_booking_mode('frozen','v2')", "open disposable v2 gate") !== "v2") {
    throw new Error("Disposable gate did not open v2 mode.");
  }
  const slot = sql(`set role service_role;
    select jsonb_build_object('start', min(slot_start), 'alternateStart', max(slot_start),
      'localDate', to_char(min(slot_start) at time zone 'America/New_York', 'YYYY-MM-DD'))
    from (select slot_start from public.get_public_booking_slots('route-fixture',
      '40000000-0000-0000-0000-000000000001',
      current_date + (8 - extract(dow from current_date)::integer))
    where staff_id = '20000000-0000-0000-0000-000000000002'
    order by slot_start limit 2) as choices`, "future fictional slots");
  const parsedSlot = JSON.parse(slot);
  if (!parsedSlot?.start || !parsedSlot.alternateStart
    || parsedSlot.start === parsedSlot.alternateStart
    || !/^\d{4}-\d{2}-\d{2}$/.test(parsedSlot.localDate)) {
    throw new Error("Fictional fixture did not expose two future slots.");
  }
  const runnerNonce = randomBytes(32).toString("hex");
  sql(`create table private.glowflow_browser_postgis_runner_marker (
    singleton boolean primary key check (singleton),
    nonce text not null check (nonce ~ '^[0-9a-f]{64}$')
  );
  insert into private.glowflow_browser_postgis_runner_marker
    (singleton, nonce) values (true, '${runnerNonce}')`, "runner-issued disposable marker");
  const childEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, CI: process.env.CI,
    TMPDIR: process.env.TMPDIR, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
    PSQL_BIN: process.env.PSQL_BIN,
    GLOWFLOW_ROUTE_POSTGIS_TEST_DATABASE_URL: testUrl.href,
    GLOWFLOW_BROWSER_POSTGIS_SLOT: JSON.stringify(parsedSlot),
    GLOWFLOW_BROWSER_POSTGIS_RUNNER_NONCE: runnerNonce,
    GLOWFLOW_BROWSER_POSTGIS_SCENARIO: scenario,
    GLOWFLOW_PUBLIC_BOOKING_V2_COOKIE_SIGNING_KEY: randomBytes(32).toString("base64url"),
    GLOWFLOW_PUBLIC_BOOKING_QUOTA_HMAC_KEY: randomBytes(32).toString("base64url"),
  };
  const result = spawnSync(process.execPath, ["--test", "tests/browser/booking-postgis.browser.mjs"], {
    cwd: process.cwd(), stdio: "inherit", timeout: 600_000,
    env: Object.fromEntries(Object.entries(childEnv).filter(([, value]) => value !== undefined)),
  });
  if (result.error) throw new Error("Disposable browser test failed to finish.");
  process.exitCode = result.status ?? 1;
} finally {
  if (created) command(`DROP DATABASE "${database}" WITH (FORCE)`);
}
