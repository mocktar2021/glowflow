import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const staffId = "33333333-3333-4333-8333-333333333333";
const foreignId = "44444444-4444-4444-8444-444444444444";

async function actionFor(owned = [staffId]) {
  const source = await readFile(new URL("../app/[locale]/dashboard/public-profile/actions.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const writes = [];
  const reads = [];
  const revalidated = [];
  const supabase = { from(table) {
    const filters = [];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      in(key, values) { filters.push([key, values]); return query; },
      single() { return Promise.resolve({ data: table === "users" ? { tenant_id: "tenant-a", role: "owner" } : { name: "Salon", slug: "salon", country_code: "US" } }); },
      maybeSingle() { return Promise.resolve({ data: null }); },
      then(resolve, reject) {
        reads.push({ table, filters });
        return Promise.resolve({ data: owned.filter(id => filters.every(([key, value]) => key !== "id" || value.includes(id))).map(id => ({ id })), error: null }).then(resolve, reject);
      },
      upsert(value) { writes.push({ table, value }); return Promise.resolve({ error: null }); },
    };
    return query;
  } };
  const loaded = { exports: {} };
  new Function("require", "exports", js)((name) => {
    if (name === "next/cache") return { revalidatePath: path => revalidated.push(path) };
    if (name === "next/navigation") return { redirect: path => { throw new Error(`redirect:${path}`); } };
    if (name === "@/lib/auth") return { requireUser: async () => ({ supabase, userId: "owner" }) };
    throw new Error(`Unexpected dependency: ${name}`);
  }, loaded.exports);
  return { save: loaded.exports.savePublicSalonProfile, writes, reads, revalidated };
}

function form(staff = staffId) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ business_name: "Salon", city: "Paris", postal_code: "75001", address_line1: "1 Rue Test", publication_action: "private", team_1_name: "Ari", team_1_role: "Stylist", team_1_staff_id: staff, team_2_name: "Guest", team_2_role: "Stylist" })) data.set(key, value);
  return data;
}

test("owner saves linked public name while leaving other names display-only", async () => {
  const { save, writes, reads, revalidated } = await actionFor();
  assert.deepEqual(await save("en", form()), { saved: true });
  assert.deepEqual(writes[0].value.team_json, [
    { name: "Ari", role: "Stylist", booking_staff_id: staffId },
    { name: "Guest", role: "Stylist" },
  ]);
  assert.ok(reads.some(read => read.table === "users" && read.filters.some(([key, value]) => key === "tenant_id" && value === "tenant-a")));
  assert.ok(revalidated.includes("/en/book/salon"));
});

test("owner cannot publish another tenant's booking account", async () => {
  const { save, writes } = await actionFor();
  await assert.rejects(save("en", form(foreignId)), /redirect:\/en\/dashboard\/public-profile\?error=invalid_booking_staff/);
  assert.deepEqual(writes, []);
});

test("owner cannot link a nameless or duplicate booking choice", async () => {
  const { save, writes } = await actionFor();
  const nameless = form(); nameless.delete("team_1_name");
  await assert.rejects(save("en", nameless), /error=invalid_booking_staff/);
  const duplicate = form(); duplicate.set("team_2_name", "ARI"); duplicate.set("team_2_staff_id", foreignId);
  await assert.rejects(save("en", duplicate), /error=invalid_booking_staff/);
  assert.deepEqual(writes, []);
});
