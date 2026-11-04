import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function appSources(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await appSources(file));
    else if (/\.[jt]sx?$/.test(entry.name)) result.push(await readFile(file, "utf8"));
  }
  return result;
}

test("new invitation delivery code is not wired to an application route or enabled by default", async () => {
  const example = await readFile(path.join(root, ".env.example"), "utf8");
  for (const name of [
    "GLOWFLOW_STAFF_INVITES_ENABLED",
    "GLOWFLOW_STAFF_INVITE_ISSUANCE_ENABLED",
    "GLOWFLOW_STAFF_INVITE_DELIVERY_ENABLED",
  ]) {
    assert.match(example, new RegExp(`^${name}=false$`, "m"));
  }
  const app = (await appSources(path.join(root, "app"))).join("\n");
  assert.ok(!app.includes("processNextStaffInvitationDelivery"));
  assert.ok(!app.includes("@/lib/staff-invitation-sender"));
  assert.ok(!app.includes("@/lib/staff-invitation-resend"));
  assert.ok(!app.includes("@/lib/staff-invitation-runner"));
});
