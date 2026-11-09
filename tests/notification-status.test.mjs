import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/notifications/status.ts", import.meta.url), "utf8");
const loaded = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(loaded, loaded.exports);
const { deriveNotificationStatus } = loaded.exports;
const now = new Date("2030-01-01T12:00:00Z");
const base = { scheduledFor: "2030-01-01T11:00:00Z", appointmentStartTime: "2030-01-02T12:00:00Z", currentAppointmentStartTime: "2030-01-02T12:00:00Z", scheduleGeneration: 2, currentScheduleGeneration: 2, appointmentStatus: "confirmed", consentStatus: "consented", latestAttempt: null, now };

test("status read model blocks missing consent, opt-out, and inactive appointments", () => {
  assert.equal(deriveNotificationStatus({ ...base, consentStatus: null }), "awaiting_consent");
  assert.equal(deriveNotificationStatus({ ...base, consentStatus: "opted_out" }), "opted_out");
  assert.equal(deriveNotificationStatus({ ...base, appointmentStatus: "canceled" }), "appointment_inactive");
  assert.equal(deriveNotificationStatus({ ...base, currentAppointmentStartTime: "2030-01-03T12:00:00Z", currentScheduleGeneration: 3 }), "superseded");
  assert.equal(deriveNotificationStatus(base), "ready");
  assert.equal(deriveNotificationStatus({ ...base, scheduledFor: "2030-01-02T12:00:00Z" }), "scheduled");
});

test("changed or missing appointment start fails closed even when generation is unchanged", () => {
  assert.equal(deriveNotificationStatus({ ...base, currentAppointmentStartTime: "2030-01-03T12:00:00Z" }), "superseded");
  assert.equal(deriveNotificationStatus({ ...base, currentAppointmentStartTime: null }), "superseded");
  assert.equal(deriveNotificationStatus({ ...base, currentAppointmentStartTime: "not-a-date" }), "superseded");
  assert.equal(deriveNotificationStatus({ ...base, appointmentStartTime: "not-a-date" }), "superseded");
  assert.equal(deriveNotificationStatus({ ...base, currentAppointmentStartTime: "2030-01-02T07:00:00-05:00" }), "ready");
  assert.equal(deriveNotificationStatus({ ...base, currentAppointmentStartTime: "2030-01-03T12:00:00Z", latestAttempt: { event_type: "delivered", retry_after: null, lease_expires_at: null, occurred_at: "2030-01-01T11:00:00Z" } }), "delivered");
});

test("status read model distinguishes active, expired, retryable, and terminal attempts", () => {
  const attempt = (event_type, extra = {}) => ({ event_type, retry_after: null, lease_expires_at: null, occurred_at: "2030-01-01T11:00:00Z", ...extra });
  assert.equal(deriveNotificationStatus({ ...base, latestAttempt: attempt("claimed", { lease_expires_at: "2030-01-01T12:05:00Z" }) }), "processing");
  assert.equal(deriveNotificationStatus({ ...base, latestAttempt: attempt("claimed", { lease_expires_at: "2030-01-01T11:59:00Z" }) }), "ready_to_retry");
  assert.equal(deriveNotificationStatus({ ...base, latestAttempt: attempt("retryable", { retry_after: "2030-01-01T13:00:00Z" }) }), "retry_scheduled");
  assert.equal(deriveNotificationStatus({ ...base, latestAttempt: attempt("retryable", { retry_after: "2030-01-01T12:00:00Z" }) }), "ready_to_retry");
  for (const terminal of ["delivered", "failed", "canceled"]) {
    assert.equal(deriveNotificationStatus({ ...base, consentStatus: "opted_out", appointmentStatus: "canceled", latestAttempt: attempt(terminal) }), terminal);
  }
});

test("missing, unknown, and opted-out consent take precedence over every nonterminal delivery state", () => {
  const attempts = [
    null,
    { event_type: "claimed", retry_after: null, lease_expires_at: "2030-01-01T12:05:00Z", occurred_at: "2030-01-01T11:00:00Z" },
    { event_type: "claimed", retry_after: null, lease_expires_at: "2030-01-01T11:55:00Z", occurred_at: "2030-01-01T11:00:00Z" },
    { event_type: "retryable", retry_after: "2030-01-01T13:00:00Z", lease_expires_at: null, occurred_at: "2030-01-01T11:00:00Z" },
    { event_type: "retryable", retry_after: "2030-01-01T11:55:00Z", lease_expires_at: null, occurred_at: "2030-01-01T11:00:00Z" },
  ];

  for (const latestAttempt of attempts) {
    for (const consentStatus of [null, "unexpected_status", "opted_out"]) {
      for (const scheduledFor of ["2030-01-01T11:00:00Z", "2030-01-01T13:00:00Z"]) {
        assert.equal(
          deriveNotificationStatus({ ...base, consentStatus, latestAttempt, scheduledFor }),
          consentStatus === "opted_out" ? "opted_out" : "awaiting_consent",
          `${consentStatus ?? "missing consent"} must override ${latestAttempt?.event_type ?? "no attempt"} at ${scheduledFor}`,
        );
      }
    }
  }
});
