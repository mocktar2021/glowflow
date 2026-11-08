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
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal(sql(`select has_function_privilege('${role}',
      'private.notification_delivery_current_context(uuid,timestamptz)','execute')`), "f",
    "the shared current-context predicate must remain private");
  }
  for (const role of ["anon", "authenticated"]) {
    assert.equal(sql(`select has_function_privilege('${role}',
      'public.claim_notification_delivery(uuid,uuid,timestamptz)','execute')`), "f");
  }
  assert.equal(sql(`select has_function_privilege('service_role',
    'public.claim_notification_delivery(uuid,uuid,timestamptz)','execute')`), "t");

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
  const threeHoursAway = "50000000-0000-0000-0000-000000000006";
  const oneHourAway = "50000000-0000-0000-0000-000000000007";
  const futureClient = "30000000-0000-0000-0000-000000000004";
  const futureBooking = "50000000-0000-0000-0000-000000000008";
  const driftBooking = "50000000-0000-0000-0000-000000000009";
  const canceledBooking = "50000000-0000-0000-0000-000000000010";
  const optedOutBooking = "50000000-0000-0000-0000-000000000011";
  const freshDriftBooking = "50000000-0000-0000-0000-000000000012";
  const earlyReminderBooking = "50000000-0000-0000-0000-000000000013";
  const completedClaimBooking = "50000000-0000-0000-0000-000000000014";

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

  sql(`insert into public.appointments(id,tenant_id,client_id,service_id,staff_id,start_time,end_time,status)
    values ('${threeHoursAway}','${tenantA}','${clientA}','${serviceA}','${staffA}',
      now()+interval '3 hours',now()+interval '4 hours','confirmed')`);
  assert.equal(count(threeHoursAway), 2, "only confirmation and future 2-hour reminder are queued");
  sql(`insert into public.appointments(id,tenant_id,client_id,service_id,staff_id,start_time,end_time,status)
    values ('${oneHourAway}','${tenantA}','${clientA}','${serviceA}','${staffA}',
      now()+interval '1 hour',now()+interval '2 hours','confirmed')`);
  assert.equal(count(oneHourAway), 1, "an imminent booking gets confirmation only");

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

  // A client clock may be up to five minutes ahead. Future opt-in is stored
  // for audit but cannot authorize scheduling or a claim before DB time.
  sql(`insert into public.clients(id,tenant_id,full_name,email)
    values ('${futureClient}','${tenantA}','Future Consent','future@example.invalid')`);
  sql(appointment(futureBooking, futureClient, 20));
  assert.equal(count(futureBooking), 0, "unknown consent cannot enqueue");
  const manualKey = "60000000-0000-0000-0000-000000000102";
  sql(`set role service_role; select count(*) from public.schedule_appointment_notifications(
    '${futureBooking}','email','${manualKey}')`);
  const futureConfirmation = sql(`select id from public.notification_outbox
    where appointment_id='${futureBooking}' and notification_kind='confirmation'`);
  assert.equal(sql(`select private.notification_delivery_eligible('${futureConfirmation}',now())`), "f",
    "unknown consent must return false, not SQL NULL");
  assert.throws(() => sql(`set role service_role;select public.claim_notification_delivery(
    '${futureConfirmation}','60000000-0000-0000-0000-000000000107',now())`),
  /notification_not_eligible/);
  sql(`set role service_role; select public.record_client_notification_consent(
    '${tenantA}','${futureClient}','email','consented',
    '60000000-0000-0000-0000-000000000101',now()+interval '4 minutes')`);
  assert.equal(sql(`select private.notification_delivery_eligible('${futureConfirmation}',now()+interval '4 minutes')`), "f",
    "even a future claim time cannot make future opt-in effective early");
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${ownerA}';
    select coalesce(consent_status,'missing') from public.get_notification_status_rows('${tenantA}',100)
    where id='${futureConfirmation}'`).split("\n").at(-1), "missing");
  assert.throws(() => sql(`set role service_role;select public.claim_notification_delivery(
    '${futureConfirmation}','60000000-0000-0000-0000-000000000103',now()+interval '4 minutes')`),
  /notification_not_eligible/);

  // A future opt-out must override current consent immediately, even if a
  // later-dated future opt-in is also present. Preserve the audit timestamps.
  const latestConfirmation = sql(`select id from public.notification_outbox
    where appointment_id='${appointmentA}' and notification_kind='confirmation'
      and schedule_generation=4`);
  assert.equal(sql(`select private.notification_delivery_eligible('${latestConfirmation}',now())`), "t");

  // A delivery worker can claim the due-now confirmation and retry the same
  // request within its lease. A changed appointment must not let that replay
  // authorize a stale send. Keep these fixtures separate from appointmentA so
  // the existing generation, status, and consent tests retain their meaning.
  sql(appointment(driftBooking, clientA, 21));
  sql(appointment(canceledBooking, clientA, 22));
  sql(appointment(optedOutBooking, clientA, 23));
  sql(appointment(freshDriftBooking, clientA, 24));
  sql(appointment(completedClaimBooking, clientA, 25));
  const driftConfirmation = sql(`select id from public.notification_outbox
    where appointment_id='${driftBooking}' and notification_kind='confirmation'`);
  const driftReminder = sql(`select id from public.notification_outbox
    where appointment_id='${driftBooking}' and notification_kind='reminder24h'`);
  const canceledConfirmation = sql(`select id from public.notification_outbox
    where appointment_id='${canceledBooking}' and notification_kind='confirmation'`);
  const optedOutConfirmation = sql(`select id from public.notification_outbox
    where appointment_id='${optedOutBooking}' and notification_kind='confirmation'`);
  const freshDriftConfirmation = sql(`select id from public.notification_outbox
    where appointment_id='${freshDriftBooking}' and notification_kind='confirmation'`);
  const completedClaimConfirmation = sql(`select id from public.notification_outbox
    where appointment_id='${completedClaimBooking}' and notification_kind='confirmation'`);
  const claimAt = sql("select now()");
  const driftClaimKey = "60000000-0000-0000-0000-000000000201";
  const canceledClaimKey = "60000000-0000-0000-0000-000000000202";
  const optedOutClaimKey = "60000000-0000-0000-0000-000000000203";
  const claim = (outboxId, key) => sql(`set role service_role;select public.claim_notification_delivery(
    '${outboxId}','${key}','${claimAt}')`).split("\n").at(-1);
  assert.equal(sql(`select private.notification_delivery_eligible('${driftReminder}',now()+interval '30 days')`), "t",
    "a matching appointment start keeps a due reminder eligible");
  const driftClaim = claim(driftConfirmation, driftClaimKey);
  assert.equal(claim(driftConfirmation, driftClaimKey), driftClaim,
    "an in-lease same-key retry returns the original claim");
  assert.equal(sql(`select count(*) from public.notification_delivery_attempts
    where outbox_id='${driftConfirmation}' and event_type='claimed'`), "1",
    "a valid replay must not append a second attempt");
  claim(canceledConfirmation, canceledClaimKey);
  claim(optedOutConfirmation, optedOutClaimKey);
  const completedClaimKey = "60000000-0000-0000-0000-000000000207";
  const completedClaim = claim(completedClaimConfirmation, completedClaimKey);
  sql(`set role service_role;select public.record_notification_delivery_result(
    '${completedClaim}','canceled','60000000-0000-0000-0000-000000000208','${claimAt}')`);
  assert.throws(() => claim(completedClaimConfirmation, completedClaimKey),
    /notification_not_eligible/, "a completed claim cannot be replayed as send authorization");
  assert.equal(sql(`select count(*) from public.notification_delivery_attempts
    where outbox_id='${completedClaimConfirmation}' and event_type='claimed'`), "1");

  // A caller timestamp within the allowed five-minute skew is not a clock
  // advance. The 24-hour reminder is scheduled three minutes from DB now.
  sql(`insert into public.appointments(id,tenant_id,client_id,service_id,staff_id,start_time,end_time,status)
    values ('${earlyReminderBooking}','${tenantA}','${clientA}','${serviceA}','${staffA}',
      now()+interval '24 hours 3 minutes',now()+interval '25 hours 3 minutes','confirmed')`);
  const earlyReminder = sql(`select id from public.notification_outbox
    where appointment_id='${earlyReminderBooking}' and notification_kind='reminder24h'`);
  const futureClaimAt = sql("select now()+interval '4 minutes'");
  assert.equal(sql(`select scheduled_for > now() from public.notification_outbox
    where id='${earlyReminder}'`), "t", "the reminder must not yet be due in DB time");
  assert.throws(() => sql(`set role service_role;select public.claim_notification_delivery(
    '${earlyReminder}','60000000-0000-0000-0000-000000000206','${futureClaimAt}')`),
  /notification_not_eligible/, "a future caller claim time cannot accelerate a reminder");
  assert.equal(sql(`select count(*) from public.notification_delivery_attempts
    where outbox_id='${earlyReminder}'`), "0");

  // Privileged synthetic corruption models an appointment start changed by a
  // path that failed to bump its generation. Disable only the bump trigger in
  // this disposable database; the scheduler still observes the update.
  sql(`begin;
    alter table public.appointments disable trigger appointments_bump_notification_schedule_generation;
    update public.appointments set start_time=start_time+interval '30 minutes'
      where id in ('${driftBooking}','${freshDriftBooking}');
    alter table public.appointments enable trigger appointments_bump_notification_schedule_generation;
    commit;`);
  assert.equal(sql(`select notification_schedule_generation from public.appointments
    where id='${driftBooking}'`), "0", "the synthetic drift must leave generation unchanged");
  assert.equal(sql(`select notification_schedule_generation from public.appointments
    where id='${freshDriftBooking}'`), "0");
  assert.equal(sql(`select count(*) from public.notification_outbox
    where appointment_id='${driftBooking}'`), "3", "drift does not append a new schedule");
  assert.equal(sql(`select private.notification_delivery_eligible('${driftReminder}',now()+interval '30 days')`), "f",
    "an outbox reminder for an old start is ineligible even when generation matches");
  assert.throws(() => claim(freshDriftConfirmation, "60000000-0000-0000-0000-000000000205"),
    /notification_not_eligible/, "a first claim cannot authorize an unclaimed but stale confirmation");
  assert.equal(sql(`select count(*) from public.notification_delivery_attempts
    where outbox_id='${freshDriftConfirmation}'`), "0");
  assert.throws(() => claim(driftConfirmation, "60000000-0000-0000-0000-000000000204"),
    /notification_not_eligible/, "a new claim key cannot authorize the stale confirmation");
  assert.throws(() => claim(driftConfirmation, driftClaimKey),
    /notification_not_eligible/, "the original claim key cannot bypass the changed-start gate");
  assert.equal(sql(`select count(*) from public.notification_delivery_attempts
    where outbox_id='${driftConfirmation}' and event_type='claimed'`), "1",
    "rejected claims do not mutate append-only attempt history");

  sql(`update public.appointments set status='canceled' where id='${canceledBooking}'`);
  assert.throws(() => claim(canceledConfirmation, canceledClaimKey),
    /notification_not_eligible/, "canceling an appointment invalidates an in-lease claim replay");
  assert.equal(sql(`select count(*) from public.notification_delivery_attempts
    where outbox_id='${canceledConfirmation}' and event_type='claimed'`), "1");
  sql(`set role service_role;select public.record_client_notification_consent(
    '${tenantA}','${clientA}','email','opted_out',
    '60000000-0000-0000-0000-000000000104',now()+interval '3 minutes')`);
  assert.throws(() => claim(optedOutConfirmation, optedOutClaimKey),
    /notification_not_eligible/, "a future-dated opt-out immediately invalidates an in-lease replay");
  assert.equal(sql(`select count(*) from public.notification_delivery_attempts
    where outbox_id='${optedOutConfirmation}' and event_type='claimed'`), "1");
  sql(`set role service_role;select public.record_client_notification_consent(
    '${tenantA}','${clientA}','email','consented',
    '60000000-0000-0000-0000-000000000105',now()+interval '4 minutes')`);
  assert.equal(sql(`select private.notification_delivery_eligible('${latestConfirmation}',now()+interval '4 minutes')`), "f");
  assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${ownerA}';
    select consent_status from public.get_notification_status_rows('${tenantA}',100)
    where id='${latestConfirmation}'`).split("\n").at(-1), "opted_out");
  sql(`update public.appointments set start_time=start_time+interval '1 day'
    where id='${appointmentA}'`);
  assert.equal(count(), 9, "future opt-out suppresses a newly revised schedule");
  assert.throws(() => sql(`set role service_role;select public.claim_notification_delivery(
    '${latestConfirmation}','60000000-0000-0000-0000-000000000106',now())`),
  /notification_not_eligible/);

  const failClosedRollback = readFileSync(new URL("supabase/rollbacks/20261101172437_disable_notification_claims_and_scheduling.sql", root), "utf8");
  sql(failClosedRollback);
  assert.equal(sql(`select count(*) from pg_catalog.pg_trigger
    where tgrelid='public.appointments'::regclass
      and tgname='appointments_enqueue_confirmed_email' and not tgisinternal`), "0");
  assert.equal(sql("select has_function_privilege('service_role','public.claim_notification_delivery(uuid,uuid,timestamptz)','execute')"), "f");
  assert.equal(count(), 9, "fail-closed rollback preserves append-only notification history");
  sql(`update public.appointments set start_time=start_time+interval '1 day' where id='${appointmentA}'`);
  assert.equal(count(), 9, "fail-closed rollback stops new automatic scheduling");

  const migration = readFileSync(new URL("supabase/migrations/20261101172437_fail_closed_future_notification_consent.sql", root), "utf8");
  assert.throws(() => sql(migration), /notification_scheduler_predecessor_missing/,
    "migration cannot silently recreate the missing predecessor scheduler");
  const rollback = readFileSync(new URL("supabase/rollbacks/20261018000135_stop_confirmed_appointment_email.sql", root), "utf8");
  sql(rollback);
  assert.equal(sql("select to_regprocedure('private.enqueue_confirmed_appointment_email()') is null"), "t");
});
