import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const appointmentId = "50000000-0000-0000-0000-000000000001";
const requestKey = "66000000-0000-0000-0000-000000000001";

async function moduleAt(path, dependencies) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((name) => dependencies[name] ?? require(name), loaded, loaded.exports);
  return loaded.exports;
}

const locale = { isLocale: value => ["fr", "en", "es"].includes(value) };
const recording = await moduleAt("../lib/payments/recording.ts", {});

function redirect(destination) {
  const error = new Error("NEXT_REDIRECT");
  error.destination = destination;
  throw error;
}

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function expectRedirect(operation, destination) {
  return assert.rejects(operation, error => error.message === "NEXT_REDIRECT" && error.destination === destination);
}

async function paymentHarness({ owner = true, rpcError = null } = {}) {
  const calls = [];
  const revalidated = [];
  const actions = await moduleAt("../app/[locale]/dashboard/payments/actions.ts", {
    "next/navigation": { redirect },
    "next/cache": { revalidatePath: path => revalidated.push(path) },
    "@/lib/i18n": locale,
    "@/lib/payments/recording": recording,
    "@/lib/stripe-sandbox": {
      sandboxOwner: async () => owner ? { supabase: { rpc: async (...args) => {
        calls.push(args);
        return { error: rpcError };
      } } } : null,
    },
  });
  return { actions, calls, revalidated };
}

test("owner records cash and external-card checkout in each locale without a Stripe charge", async () => {
  for (const [language, method, amount, minorUnits] of [
    ["fr", "cash", "12,50", 1250],
    ["en", "external_card", "7.25", 725],
    ["es", "cash", "5", 500],
  ]) {
    const harness = await paymentHarness();
    await expectRedirect(() => harness.actions.recordManualPayment(language, form({
      appointment_id: appointmentId,
      payment_method: method,
      amount,
      request_key: requestKey,
    })), `/${language}/dashboard/payments?recorded=1`);
    assert.deepEqual(harness.calls, [["record_manual_appointment_payment", {
      target_appointment_id: appointmentId,
      target_payment_method: method,
      target_amount: minorUnits,
      request_key: requestKey,
    }]]);
    assert.deepEqual(harness.revalidated, [`/${language}/dashboard/payments`]);
  }
});

test("manual checkout rejects malformed, unsupported, and unauthenticated inputs before RPC", async () => {
  const valid = { appointment_id: appointmentId, payment_method: "cash", amount: "10.00", request_key: requestKey };
  for (const values of [
    { ...valid, appointment_id: "not-an-id" },
    { ...valid, payment_method: "stripe" },
    { ...valid, amount: "10.001" },
    { ...valid, request_key: "not-an-id" },
  ]) {
    const harness = await paymentHarness();
    await expectRedirect(() => harness.actions.recordManualPayment("en", form(values)), "/en/dashboard/payments?record_error=invalid_payment");
    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.revalidated, []);
  }
  const anonymous = await paymentHarness({ owner: false });
  await expectRedirect(() => anonymous.actions.recordManualPayment("en", form(valid)), "/en/dashboard/payments?record_error=owner_required");
  assert.deepEqual(anonymous.calls, []);
});

test("overpayment and cross-tenant checkout errors do not report success or expose database detail", async () => {
  const values = { appointment_id: appointmentId, payment_method: "external_card", amount: "10.00", request_key: requestKey };
  for (const [error, destination] of [
    [{ message: "payment_exceeds_outstanding_balance" }, "payment_exceeds_outstanding_balance"],
    [{ message: "payment_appointment_not_found" }, "payment_appointment_not_found"],
    [{ message: "private cross-tenant diagnostic" }, "record_failed"],
  ]) {
    const harness = await paymentHarness({ rpcError: error });
    await expectRedirect(() => harness.actions.recordManualPayment("en", form(values)), `/en/dashboard/payments?record_error=${destination}`);
    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.revalidated, []);
  }
});

async function calendarHarness({ role = "owner", rpcError = null } = {}) {
  const calls = [];
  const revalidated = [];
  const supabase = {
    from(table) {
      assert.equal(table, "users");
      return {
        select(fields) { assert.equal(fields, "tenant_id, role"); return this; },
        eq(field, value) { assert.equal(field, "id"); assert.equal(value, "member-a"); return this; },
        async single() { return { data: role ? { tenant_id: "tenant-a", role } : null }; },
      };
    },
    async rpc(...args) { calls.push(args); return { error: rpcError }; },
  };
  const actions = await moduleAt("../app/[locale]/dashboard/calendar/actions.ts", {
    "next/navigation": { redirect },
    "next/cache": { revalidatePath: path => revalidated.push(path) },
    "@/lib/auth": { requireUser: async () => ({ supabase, userId: "member-a" }) },
    "@/lib/bookings/conflicts": { isAppointmentConflict: () => false },
  });
  return { actions, calls, revalidated };
}

test("owner and staff cancellation use the scoped RPC and refresh the localized calendar", async () => {
  for (const [language, role] of [["fr", "owner"], ["en", "staff"], ["es", "owner"]]) {
    const harness = await calendarHarness({ role });
    await expectRedirect(() => harness.actions.cancelAppointment(language, form({
      appointment_id: appointmentId,
      calendar_date: "2030-01-15",
      calendar_view: "week",
    })), `/${language}/dashboard/calendar?date=2030-01-15&view=week&saved=canceled`);
    assert.deepEqual(harness.calls, [["cancel_calendar_appointment", { target_appointment_id: appointmentId }]]);
    assert.deepEqual(harness.revalidated, [`/${language}/dashboard/calendar`]);
  }
});

test("cancellation rejects malformed IDs, nonmembers and cross-tenant RPC denial", async () => {
  const valid = { appointment_id: appointmentId, calendar_date: "2030-01-15", calendar_view: "day" };
  const malformed = await calendarHarness();
  await expectRedirect(() => malformed.actions.cancelAppointment("en", form({ ...valid, appointment_id: "wrong" })), "/en/dashboard/calendar?date=2030-01-15&view=day&error=invalid_appointment");
  assert.deepEqual(malformed.calls, []);
  const nonmember = await calendarHarness({ role: null });
  await expectRedirect(() => nonmember.actions.cancelAppointment("en", form(valid)), "/en/dashboard/calendar?date=2030-01-15&view=day&error=member_required");
  assert.deepEqual(nonmember.calls, []);
  const foreign = await calendarHarness({ rpcError: { message: "appointment_not_cancelable: private detail" } });
  await expectRedirect(() => foreign.actions.cancelAppointment("en", form(valid)), "/en/dashboard/calendar?date=2030-01-15&view=day&error=cancel_failed");
  assert.equal(foreign.calls.length, 1);
  assert.deepEqual(foreign.revalidated, []);
});
