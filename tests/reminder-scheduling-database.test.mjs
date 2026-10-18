import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const connection = process.env.GLOWFLOW_REMINDER_SCHEDULING_TEST_DATABASE_URL;
const root = new URL("../", import.meta.url);
const psql = process.env.PSQL_BIN || "psql";

test("confirmed appointments enqueue only consented email revisions without sending", { skip: !connection }, () => {
  const url = new URL(connection);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/glowflow_reminder_test[0-9_]*$/);
  assert.ok(!url.search && !url.hash);

  function sql(input) {
    const result = spawnSync(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-d", connection], {
      input, encoding: "utf8", timeout: 60_000,
    });
    if (result.status !== 0) {
      let message = result.stderr || "Local PostgreSQL command failed.";
      for (const value of [connection, url.password, decodeURIComponent(url.password)]) {
        if (value) message = message.replaceAll(value, "[redacted]");
      }
      throw new Error(message.slice(0, 3000));
    }
    return result.stdout.trim();
  }

  assert.equal(sql("select count(*) from pg_tables where schemaname='public'"), "0");
  sql(readFileSync(new URL("tests/supabase-platform-fixture.sql", root), "utf8"));
  sql(readFileSync(new URL("supabase/schema.sql", root), "utf8"));
  for (const migration of readdirSync(new URL("supabase/migrations/", root)).filter(name => name.endsWith(".sql")).sort()) {
    sql(readFileSync(new URL(`supabase/migrations/${migration}`, root), "utf8"));
  }

  const tenantA = "10000000-0000-0000-0000-000000000001";
  const tenantB = "10000000-0000-0000-0000-000000000002";
  const ownerA = "20000000-0000-0000-0000-000000000001";
  const staffA = "20000000-0000-0000-0000-000000000002";
  const ownerB = "20000000-0000-0000-0000-000000000003";
  const clientA = "30000000-0000-0000-0000-000000000001";
  const clientNoEmail = "30000000-0000-0000-0000-000000000002";
  const clientB = "30000000-0000-0000-0000-000000000003";
  const serviceA = "40000000-0000-0000-0000-000000000001";
  const serviceB = "40000000-0000-0000-0000-000000000002";
  const appointmentA = "50000000-0000-0000-0000-000000000001";
  const appointmentB = "50000000-0000-0000-0000-000000000005";
  const noConsent = "50000000-0000-0000-0000-000000000002";
  const noEmail = "50000000-0000-0000-0000-000000000003";
  const rolledBack = "50000000-0000-0000-0000-000000000004";

  sql(`
    insert into auth.users(id,email) values
      ('${ownerA}','owner-a@example.invalid'),
      ('${staffA}','staff-a@example.invalid'),
      ('${ownerB}','owner-b@example.invalid');
    insert into public.tenants(id,name,slug,owner_id,country_code,currency,time_zone) values
      ('${tenantA}','Tenant A','reminder-a','${ownerA}','US','USD','America/New_York'),
      ('${tenantB}','Tenant B','reminder-b','${ownerB}','US','USD','America/New_York');
    insert into public.users(id,tenant_id,full_name,email,role) values
      ('${ownerA}','${tenantA}','Owner A','owner-a@example.invalid','owner'),
      ('${staffA}','${tenantA}','Staff A','staff-a@example.invalid','staff'),
      ('${ownerB}','${tenantB}','Owner B','owner-b@example.invalid','owner');
    insert into public.clients(id,tenant_id,full_name,email) values
      ('${clientA}','${tenantA}','Consented Client','client-a@example.invalid'),
      ('${clientNoEmail}','${tenantA}','No Email Client',null),
      ('${clientB}','${tenantB}','Tenant B Client','client-b@example.invalid');
    insert into public.services(id,tenant_id,title_json,duration_minutes,price,category,currency)
    values
      ('${serviceA}','${tenantA}','{"fr":"Coupe"}',60,5000,'hair','USD'),
      ('${serviceB}','${tenantB}','{"fr":"Coupe"}',60,5000,'hair','USD');
  `);

  function appointment(id, client, days) {
    return `insert into public.appointments(id,tenant_id,client_id,service_id,staff_id,start_time,end_time,status)
      values ('${id}','${tenantA}','${client}','${serviceA}','${staffA}',
        now()+interval '${days} days',now()+interval '${days} days 1 hour','confirmed')`;
  }
  function consent(client, status, key) {
    return `set role service_role;
      select public.record_client_notification_consent(
        '${tenantA}','${client}','email','${status}','${key}',now())`;
  }
  function count(id = appointmentA) {
    return Number(sql(`select count(*) from public.notification_outbox where appointment_id='${id}'`));
  }
  function generation() {
    return Number(sql(`select notification_schedule_generation from public.appointments where id='${appointmentA}'`));
  }
  function currentCount() {
    return Number(sql(`select count(*) from public.notification_outbox as outbox
      join public.appointments as appointment on appointment.id=outbox.appointment_id
      where outbox.appointment_id='${appointmentA}'
        and outbox.schedule_generation=appointment.notification_schedule_generation`));
  }

  sql(appointment(noConsent, clientA, 4));
  assert.equal(count(noConsent), 0, "unknown consent cannot queue a message");
  sql(consent(clientA, "consented", "60000000-0000-0000-0000-000000000001"));
  assert.equal(count(noConsent), 0, "late consent does not backfill an old booking");
  sql(consent(clientNoEmail, "consented", "60000000-0000-0000-0000-000000000002"));
  sql(appointment(noEmail, clientNoEmail, 5));
  assert.equal(count(noEmail), 0, "missing contact cannot queue a message");

  sql(appointment(appointmentA, clientA, 6));
  assert.equal(count(), 3);
  assert.equal(currentCount(), 3);
  assert.equal(sql(`select string_agg(notification_kind,',' order by notification_kind)
    from public.notification_outbox where appointment_id='${appointmentA}'`),
  "confirmation,reminder24h,reminder2h");
  assert.equal(sql(`select count(*) from public.notification_outbox as outbox
    join public.appointments as appointment on appointment.id=outbox.appointment_id
    where outbox.appointment_id='${appointmentA}'
      and ((outbox.notification_kind='reminder24h' and outbox.scheduled_for=appointment.start_time-interval '24 hours')
        or (outbox.notification_kind='reminder2h' and outbox.scheduled_for=appointment.start_time-interval '2 hours'))`), "2");
  assert.equal(sql(`select count(distinct request_key) from public.notification_outbox where appointment_id='${appointmentA}'`), "1");
  assert.equal(sql(`select count(*) from public.notification_outbox where appointment_id='${appointmentA}'
    and request_key=md5('glowflow:g27:email:${appointmentA}:0')::uuid`), "3");
  assert.equal(sql(`select count(*) from public.notification_outbox where appointment_id='${appointmentA}'
    and channel<>'email'`), "0", "SMS is not automatically scheduled");
  sql(`set role service_role; select public.record_client_notification_consent(
    '${tenantB}','${clientB}','email','consented','60000000-0000-0000-0000-000000000005',now())`);
  sql(`insert into public.appointments(id,tenant_id,client_id,service_id,staff_id,start_time,end_time,status)
    values ('${appointmentB}','${tenantB}','${clientB}','${serviceB}','${ownerB}',
      now()+interval '6 days',now()+interval '6 days 1 hour','confirmed')`);
  assert.equal(count(appointmentB), 3, "other tenant schedules independently");
  assert.equal(sql("select has_function_privilege('anon','private.enqueue_confirmed_appointment_email()','execute')"), "f");
  assert.equal(sql("select has_function_privilege('authenticated','private.enqueue_confirmed_appointment_email()','execute')"), "f");
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${ownerA}';
    select count(*) from public.notification_outbox`).split("\n").at(-1), "3");
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${ownerB}';
    select count(*) from public.notification_outbox`).split("\n").at(-1), "3");
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${ownerB}';
    select count(*) from public.get_notification_status_rows('${tenantA}',100)`).split("\n").at(-1), "0");
  assert.throws(() => sql("set role anon;select count(*) from public.notification_outbox"), /permission denied/);

  sql(`update public.appointments set start_time=start_time where id='${appointmentA}'`);
  assert.equal(generation(), 0);
  assert.equal(count(), 3, "no-op retries do not enqueue duplicates");
  const oldReminder = sql(`select id from public.notification_outbox where appointment_id='${appointmentA}'
    and notification_kind='reminder24h' and schedule_generation=0`);

  sql(consent(clientA, "opted_out", "60000000-0000-0000-0000-000000000003"));
  sql(`update public.appointments set start_time=start_time+interval '1 day' where id='${appointmentA}'`);
  assert.equal(generation(), 1);
  assert.equal(count(), 3, "opt-out suppresses the new revision");
  assert.equal(currentCount(), 0);
  assert.equal(sql(`select private.notification_delivery_eligible('${oldReminder}',now()+interval '20 days')`), "f");

  sql(consent(clientA, "consented", "60000000-0000-0000-0000-000000000004"));
  sql(`update public.appointments set start_time=start_time+interval '1 day' where id='${appointmentA}'`);
  assert.equal(generation(), 2);
  assert.equal(count(), 6);
  assert.equal(currentCount(), 3);
  assert.equal(sql(`select count(*) from public.notification_outbox as outbox
    join public.appointments as appointment on appointment.id=outbox.appointment_id
    where outbox.appointment_id='${appointmentA}'
      and outbox.schedule_generation=appointment.notification_schedule_generation
      and outbox.appointment_start_time=appointment.start_time`), "3");
  assert.equal(sql(`select private.notification_delivery_eligible('${oldReminder}',now()+interval '20 days')`), "f");

  sql(`update public.appointments set status='canceled' where id='${appointmentA}'`);
  assert.equal(generation(), 3);
  assert.equal(count(), 6, "cancellation only invalidates, never erases history");
  assert.equal(currentCount(), 0);
  assert.equal(sql(`select private.notification_delivery_eligible('${oldReminder}',now()+interval '20 days')`), "f");
  sql(`update public.appointments set status='confirmed' where id='${appointmentA}'`);
  assert.equal(generation(), 4);
  assert.equal(count(), 9);
  assert.equal(currentCount(), 3);

  sql(`begin; ${appointment(rolledBack, clientA, 7)}; rollback;`);
  assert.equal(count(rolledBack), 0, "rollback removes both appointment and queued revision");
  assert.equal(sql(`select count(*) from public.appointments where id='${rolledBack}'`), "0");

  const rollback = readFileSync(new URL("supabase/rollbacks/20261018000135_stop_confirmed_appointment_email.sql", root), "utf8");
  sql(rollback);
  assert.equal(sql("select to_regprocedure('private.enqueue_confirmed_appointment_email()') is null"), "t");
  assert.equal(count(), 9, "operational rollback preserves immutable history");
  sql(`update public.appointments set start_time=start_time+interval '1 day' where id='${appointmentA}'`);
  assert.equal(count(), 9, "rollback stops new automatic scheduling");
});
