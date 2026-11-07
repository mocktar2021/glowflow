import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/next-available-booking-date.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} };
new Function("exports", js)(loaded.exports);
const { nextCalendarDate, findNextAvailableBookingDate } = loaded.exports;

test("salon-local dates advance across month, year and DST boundaries", () => {
  assert.equal(nextCalendarDate("2026-03-07"), "2026-03-08");
  assert.equal(nextCalendarDate("2026-10-31"), "2026-11-01");
  assert.equal(nextCalendarDate("2026-12-31"), "2027-01-01");
  assert.throws(() => nextCalendarDate("2026-02-30"), /invalid_calendar_date/);
});

test("search is bounded, stops at first actual slot and respects preferred staff", async () => {
  const calls = [];
  const controller = new AbortController();
  const result = await findNextAvailableBookingDate("2026-11-07", "staff-b", async (date) => {
    calls.push(date);
    return date === "2026-11-08" ? [{ staff_id: "staff-a", slot_start: "2026-11-08T14:00:00Z" }]
      : date === "2026-11-10" ? [{ staff_id: "staff-b", slot_start: "2026-11-10T14:00:00Z" }] : [];
  }, controller.signal);
  assert.equal(result, "2026-11-10");
  assert.deepEqual(calls, ["2026-11-08", "2026-11-09", "2026-11-10"]);
});

test("at most fourteen read-only lookups occur when no date is available", async () => {
  const calls = [];
  const result = await findNextAvailableBookingDate("2026-11-07", "", async (date) => {
    calls.push(date);
    return [];
  }, new AbortController().signal);
  assert.equal(result, null);
  assert.equal(calls.length, 14);
  assert.equal(calls.at(-1), "2026-11-21");
});

test("abort prevents later lookups and never returns a stale suggestion", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(findNextAvailableBookingDate("2026-11-07", "", async () => {
    calls += 1;
    controller.abort();
    return [{ staff_id: "staff-a", slot_start: "2026-11-08T14:00:00Z" }];
  }, controller.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});
