import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const connection = process.env.GLOWFLOW_SANDBOX_TEST_DATABASE_URL;
const psql = process.env.PSQL_BIN || "psql";
const root = new URL("../", import.meta.url);
const execAsync = promisify(execFile);

function safeError(error) {
  let message = String(error.stderr || "Local PostgreSQL command failed.");
  for (const value of [connection, connection && new URL(connection).password, connection && decodeURIComponent(new URL(connection).password)]) {
    if (value) message = message.replaceAll(value, "[redacted]");
  }
  return new Error(message.slice(0, 2500));
}

function sql(input) {
  const result = spawnSync(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection], { input, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0) throw safeError(result);
  return result.stdout.trim();
}

async function asyncSql(input) {
  try {
    return await execAsync(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection, "-c", input], { encoding: "utf8", timeout: 60_000 });
  } catch (error) {
    throw safeError(error);
  }
}

test("notification consent, outbox, retries, immutability, and RLS", { skip: !connection }, async () => {
  const url = new URL(connection);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/glowflow_sandbox_test[0-9_]*$/);
  assert.ok(!url.search && !url.hash);
  assert.equal(sql("select count(*) from pg_tables where schemaname='public'"), "0");

  sql(readFileSync(new URL("tests/supabase-platform-fixture.sql", root), "utf8"));
  sql(readFileSync(new URL("supabase/schema.sql", root), "utf8"));
  for (const migration of readdirSync(new URL("supabase/migrations/", root)).filter((name) => name.endsWith(".sql")).sort()) {
    sql(readFileSync(new URL(`supabase/migrations/${migration}`, root), "utf8"));
  }

  const rollback = readFileSync(new URL("supabase/rollbacks/20260925213000_drop_empty_notification_persistence.sql", root), "utf8");
  const forward = readFileSync(new URL("supabase/migrations/20260925213000_add_notification_persistence.sql", root), "utf8");
  sql(rollback);
  assert.equal(sql("select to_regclass('public.notification_outbox') is null"), "t");
  sql(forward);

  assert.equal(sql("select string_agg(relname,',' order by relname) from pg_class where oid in ('public.client_notification_consent_events'::regclass,'public.notification_outbox'::regclass,'public.notification_delivery_attempts'::regclass) and relrowsecurity"), "client_notification_consent_events,notification_delivery_attempts,notification_outbox");
  assert.equal(sql("select has_table_privilege('anon','public.notification_outbox','select')"), "f");
  assert.equal(sql("select has_table_privilege('authenticated','public.notification_outbox','select') and not has_table_privilege('authenticated','public.notification_outbox','insert')"), "t");
  assert.equal(sql("select has_function_privilege('authenticated','public.claim_notification_delivery(uuid,uuid,timestamptz)','execute')"), "f");
  assert.equal(sql("select has_function_privilege('service_role','public.claim_notification_delivery(uuid,uuid,timestamptz)','execute')"), "t");

  const tenantA = "10000000-0000-0000-0000-000000000001";
  const tenantB = "10000000-0000-0000-0000-000000000002";
  const ownerA = "20000000-0000-0000-0000-000000000001";
  const staffA = "20000000-0000-0000-0000-000000000002";
  const ownerB = "20000000-0000-0000-0000-000000000003";
  const clientA = "30000000-0000-0000-0000-000000000001";
  const serviceA = "40000000-0000-0000-0000-000000000001";
  const appointmentA = "50000000-0000-0000-0000-000000000001";
  sql(`
    insert into auth.users(id,email) values
      ('${ownerA}','owner-a@example.test'),('${staffA}','staff-a@example.test'),('${ownerB}','owner-b@example.test');
    insert into public.tenants(id,name,slug,owner_id,country_code,currency,time_zone) values
      ('${tenantA}','Tenant A','tenant-a','${ownerA}','US','USD','America/New_York'),
      ('${tenantB}','Tenant B','tenant-b','${ownerB}','US','USD','America/New_York');
    insert into public.users(id,tenant_id,full_name,email,role) values
      ('${ownerA}','${tenantA}','Owner A','owner-a@example.test','owner'),
      ('${staffA}','${tenantA}','Staff A','staff-a@example.test','staff'),
      ('${ownerB}','${tenantB}','Owner B','owner-b@example.test','owner');
    insert into public.clients(id,tenant_id,full_name,email,phone) values
      ('${clientA}','${tenantA}','Client A','client-a@example.test','+15555550100');
    insert into public.services(id,tenant_id,title_json,duration_minutes,price,category,currency) values
      ('${serviceA}','${tenantA}','{"fr":"Coupe"}',60,5000,'hair','USD');
    insert into public.appointments(id,tenant_id,client_id,service_id,staff_id,start_time,end_time,status)
      values ('${appointmentA}','${tenantA}','${clientA}','${serviceA}','${staffA}',now()+interval '10 days',now()+interval '10 days 1 hour','confirmed');
  `);

  const consentKey = "60000000-0000-0000-0000-000000000001";
  const consentAt = sql("select date_trunc('second',now())");
  const consentCall = `select public.record_client_notification_consent('${tenantA}','${clientA}','email','consented','${consentKey}','${consentAt}')`;
  const concurrentConsent = await Promise.all([
    asyncSql(`set role service_role;${consentCall}`),
    asyncSql(`set role service_role;${consentCall}`),
  ]);
  const concurrentConsentIds = concurrentConsent.map((result) => result.stdout.trim().split("\n").at(-1));
  assert.equal(new Set(concurrentConsentIds).size, 1);
  const consentId = concurrentConsentIds[0];
  assert.equal(sql(`set role service_role;${consentCall}`).split("\n").at(-1), consentId);
  assert.throws(() => sql(`set role service_role;select public.record_client_notification_consent('${tenantA}','${clientA}','sms','consented','${consentKey}','${consentAt}')`), /notification_consent_request_mismatch/);

  const scheduleKey = "60000000-0000-0000-0000-000000000002";
  assert.equal(sql(`set role service_role;select count(*) from public.schedule_appointment_notifications('${appointmentA}','email','${scheduleKey}')`).split("\n").at(-1), "3");
  assert.equal(sql(`set role service_role;select count(*) from public.schedule_appointment_notifications('${appointmentA}','email','${scheduleKey}')`).split("\n").at(-1), "3");
  assert.throws(() => sql(`set role service_role;select * from public.schedule_appointment_notifications('${appointmentA}','email','60000000-0000-0000-0000-000000000099')`), /notification_schedule_request_mismatch/);
  assert.equal(sql(`select count(*) from public.notification_outbox where appointment_id='${appointmentA}'`), "3");

  const confirmation = sql(`select id from public.notification_outbox where appointment_id='${appointmentA}' and notification_kind='confirmation'`);
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${ownerA}';select count(*) from public.notification_outbox`).split("\n").at(-1), "3");
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${staffA}';select count(*) from public.notification_outbox`).split("\n").at(-1), "3");
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${ownerB}';select count(*) from public.notification_outbox`).split("\n").at(-1), "0");
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${ownerA}';select count(*) from public.get_notification_status_rows('${tenantA}',100)`).split("\n").at(-1), "3");
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${ownerB}';select count(*) from public.get_notification_status_rows('${tenantA}',100)`).split("\n").at(-1), "0");
  assert.throws(() => sql("set role anon;select count(*) from public.notification_outbox"), /permission denied/);
  assert.throws(() => sql(`set role authenticated;set request.jwt.claim.sub='${ownerA}';insert into public.notification_outbox(tenant_id,appointment_id,client_id,notification_kind,channel,scheduled_for,request_key) values('${tenantA}','${appointmentA}','${clientA}','confirmation','sms',now(),'70000000-0000-0000-0000-000000000001')`), /permission denied/);

  const claimAt = sql("select date_trunc('second',now())");
  const claims = await Promise.allSettled([
    asyncSql(`set role service_role;select public.claim_notification_delivery('${confirmation}','70000000-0000-0000-0000-000000000002','${claimAt}')`),
    asyncSql(`set role service_role;select public.claim_notification_delivery('${confirmation}','70000000-0000-0000-0000-000000000003','${claimAt}')`),
  ]);
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(claims.filter((result) => result.status === "rejected").length, 1);
  assert.match(claims.find((result) => result.status === "rejected").reason.message, /notification_not_eligible/);
  const claimId = sql(`select id from public.notification_delivery_attempts where outbox_id='${confirmation}' and event_type='claimed'`);

  const resultAt = sql("select date_trunc('second',now())");
  const retryAt = sql("select date_trunc('second',now()) + interval '1 second'");
  const retryCall = `select public.record_notification_delivery_result('${claimId}','retryable','70000000-0000-0000-0000-000000000004','${resultAt}','${retryAt}','temporary_unavailable',null)`;
  const retryId = sql(`set role service_role;${retryCall}`).split("\n").at(-1);
  assert.equal(sql(`set role service_role;${retryCall}`).split("\n").at(-1), retryId);
  assert.throws(() => sql(`set role service_role;select public.claim_notification_delivery('${confirmation}','70000000-0000-0000-0000-000000000005','${resultAt}')`), /notification_not_eligible/);

  const optOutAt = sql("select date_trunc('second',now())");
  sql(`set role service_role;select public.record_client_notification_consent('${tenantA}','${clientA}','email','opted_out','70000000-0000-0000-0000-000000000006','${optOutAt}')`);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const afterRetry = sql("select date_trunc('second',now())");
  assert.throws(() => sql(`set role service_role;select public.claim_notification_delivery('${confirmation}','70000000-0000-0000-0000-000000000007','${afterRetry}')`), /notification_not_eligible/);

  const reconsentAt = sql("select date_trunc('second',now())");
  sql(`set role service_role;select public.record_client_notification_consent('${tenantA}','${clientA}','email','consented','70000000-0000-0000-0000-000000000008','${reconsentAt}')`);
  const secondClaim = sql(`set role service_role;select public.claim_notification_delivery('${confirmation}','70000000-0000-0000-0000-000000000009','${reconsentAt}')`).split("\n").at(-1);
  sql(`set role service_role;select public.record_notification_delivery_result('${secondClaim}','delivered','70000000-0000-0000-0000-000000000010','${reconsentAt}',null,null,'provider-neutral-reference')`);
  assert.throws(() => sql(`set role service_role;select public.claim_notification_delivery('${confirmation}','70000000-0000-0000-0000-000000000011','${reconsentAt}')`), /notification_not_eligible/);

  const oldReminder = sql(`select id from public.notification_outbox where appointment_id='${appointmentA}' and notification_kind='reminder24h'`);
  sql(`update public.appointments set start_time=start_time+interval '1 day' where id='${appointmentA}'`);
  assert.throws(() => sql(`set role service_role;select * from public.schedule_appointment_notifications('${appointmentA}','email','${scheduleKey}')`), /notification_schedule_request_mismatch/);
  const rescheduleKey = "70000000-0000-0000-0000-000000000012";
  assert.equal(sql(`set role service_role;select count(*) from public.schedule_appointment_notifications('${appointmentA}','email','${rescheduleKey}')`).split("\n").at(-1), "3");
  assert.equal(sql(`select count(*) from public.notification_outbox where appointment_id='${appointmentA}'`), "6");
  assert.equal(sql(`select count(*) from public.notification_outbox o join public.appointments a on a.id=o.appointment_id and a.tenant_id=o.tenant_id where o.appointment_id='${appointmentA}' and o.appointment_start_time=a.start_time and ((o.notification_kind='confirmation') or (o.notification_kind='reminder24h' and o.scheduled_for=a.start_time-interval '24 hours') or (o.notification_kind='reminder2h' and o.scheduled_for=a.start_time-interval '2 hours'))`), "3");
  assert.equal(sql(`select private.notification_delivery_eligible('${oldReminder}',now()+interval '20 days')`), "f");
  assert.throws(() => sql(`update public.notification_outbox set scheduled_for=now() where id='${confirmation}'`), /notification_history_is_append_only/);
  assert.throws(() => sql(`delete from public.client_notification_consent_events where id='${consentId}'`), /notification_history_is_append_only/);
  assert.throws(() => sql(rollback), /notification_history_not_empty_preserve_audit_history/);
});
