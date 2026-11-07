// Test-only service-role RPC adapter. The fixture's webpack alias is the only
// consumer; production imports and hosted Supabase configuration are unchanged.
import { spawnSync } from "node:child_process";

const specs = Object.freeze({
  consume_public_booking_quota: {
    columns: "quota_action text, ip_digest text, browser_digest text, salon_slug text",
    args: "quota_action, ip_digest, browser_digest, salon_slug",
  },
  consume_public_booking_capability_quota: {
    columns: "quota_action text, browser_digest text, intent_digest text, salon_slug text",
    args: "quota_action, browser_digest, intent_digest, salon_slug",
  },
  prepare_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, service_id uuid, staff_id uuid, requested_start timestamptz, client_full_name text, client_phone text, client_email text, client_locale text, expected_generation uuid",
    args: "salon_slug, browser_token_hash, service_id, staff_id, requested_start, client_full_name, client_phone, client_email, client_locale, expected_generation",
  },
  reconcile_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, intent_id uuid",
    args: "salon_slug, browser_token_hash, intent_id",
  },
  commit_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, intent_id uuid",
    args: "salon_slug, browser_token_hash, intent_id",
  },
  cancel_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, intent_id uuid",
    args: "salon_slug, browser_token_hash, intent_id",
  },
  acknowledge_public_booking_intent: {
    columns: "salon_slug text, browser_token_hash text, intent_id uuid",
    args: "salon_slug, browser_token_hash, intent_id",
  },
});

function disposableUrl() {
  const value = process.env.GLOWFLOW_ROUTE_POSTGIS_TEST_DATABASE_URL;
  let url;
  try { url = new URL(value); } catch { throw new Error("Disposable loopback PostgreSQL URL required."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/glowflow_route_postgis_test_[0-9_]+$/.test(url.pathname)
    || url.search || url.hash) throw new Error("Only a generated loopback PostgreSQL test database is allowed.");
  return value;
}

export function createAdminClient() {
  return {
    // Optional published confirmation enrichment is outside this seam.
    from() { throw new Error("Test adapter does not emulate PostgREST reads."); },
    async rpc(name, values) {
      const spec = Object.hasOwn(specs, name) ? specs[name] : null;
      if (!spec) throw new Error("Unexpected test RPC.");
      const query = `set role service_role;\nselect public.${name}(${spec.args}) from jsonb_to_record(:'payload'::jsonb) as input(${spec.columns});`;
      const result = spawnSync(process.env.PSQL_BIN || "psql", [
        "-X", "-w", "-q", "-At", "-v", "ON_ERROR_STOP=1",
        "-v", "payload=" + JSON.stringify(values), "-d", disposableUrl(),
      ], { input: query, encoding: "utf8", timeout: 90_000, maxBuffer: 1024 * 1024 });
      if (result.status !== 0) return { data: null, error: { message: "Disposable RPC failed." } };
      try { return { data: JSON.parse(result.stdout.trim().split("\n").at(-1)), error: null }; }
      catch { return { data: null, error: { message: "Disposable RPC returned invalid JSON." } }; }
    },
  };
}
