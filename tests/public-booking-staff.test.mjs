import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/public-booking-staff.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} };
new Function("exports", js)(loaded.exports);
const { publishedBookingMembers, bookingMembersByService } = loaded.exports;

const ari = "33333333-3333-4333-8333-333333333333";
const ben = "44444444-4444-4444-8444-444444444444";
const foreign = "55555555-5555-4555-8555-555555555555";

test("only explicitly linked public names become booking choices", () => {
  const members = publishedBookingMembers([
    { name: "Public Ari", role: "Stylist", booking_staff_id: ari },
    { name: "Display-only team member", role: "Stylist" },
    { name: "Private User", booking_staff_id: "not-a-uuid" },
    { name: "Public Ari", booking_staff_id: ben },
    { name: "Second label", booking_staff_id: ari },
    { name: "Foreign", booking_staff_id: foreign },
  ]);
  assert.deepEqual(members, [{ id: ari, name: "Public Ari" }, { id: foreign, name: "Foreign" }]);
});

test("booking choices require same-tenant staff and service eligibility", () => {
  const members = [{ id: ari, name: "Ari" }, { id: ben, name: "Ben" }, { id: foreign, name: "Foreign" }];
  const choices = bookingMembersByService(members, [ari, ben], [{ id: "cut" }, { id: "color" }], [{ service_id: "cut", staff_id: ari }]);
  assert.deepEqual(choices, { cut: [{ id: ari, name: "Ari" }], color: [{ id: ari, name: "Ari" }, { id: ben, name: "Ben" }] });
  assert.equal(JSON.stringify(choices).includes("Foreign"), false);
});
