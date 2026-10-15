import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "supabase", "migrations");
const historyMap = JSON.parse(
  await readFile(path.join(root, "supabase", "migration-history-map.json"), "utf8"),
);

function normalizedSha256(value) {
  return createHash("sha256")
    .update(value.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

test("migration history map covers immutable migration files", async () => {
  assert.equal(historyMap.organizationId, "goutxcrujaxjjssbjfsn");
  assert.equal(historyMap.projectRef, "rfwhqutkiztxkagbhevp");
  assert.equal(historyMap.baseline, "supabase/schema.sql");

  const entries = historyMap.entries;
  const versions = entries.map(({ version }) => version);
  const filenames = entries.map(({ version, name }) => `${version}_${name}.sql`);
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  assert.equal(new Set(versions).size, versions.length, "migration versions must be unique");
  assert.equal(new Set(filenames).size, filenames.length, "migration filenames must be unique");
  assert.deepEqual(filenames, [...filenames].sort(), "history map must stay in migration order");
  assert.deepEqual(migrationFiles, filenames, "every migration must be recorded in the history map");
  assert.equal(entries.filter(({ marker }) => marker).length, 3);
  assert.equal(
    entries.filter(({ sourceVersion, version }) => sourceVersion && sourceVersion !== version).length,
    20,
  );

  for (const entry of entries) {
    assert.match(entry.version, /^\d{14}$/);
    assert.match(entry.name, /^[a-z0-9_]+$/);
    assert.match(entry.normalizedSha256, /^[a-f0-9]{64}$/);

    const filename = `${entry.version}_${entry.name}.sql`;
    const contents = await readFile(path.join(migrationsDirectory, filename), "utf8");
    assert.equal(
      normalizedSha256(contents),
      entry.normalizedSha256,
      `${filename} changed after its migration-history fingerprint was recorded`,
    );

    if (entry.sourceVersion && entry.sourceVersion !== entry.version) {
      assert.ok(
        !migrationFiles.includes(`${entry.sourceVersion}_${entry.name}.sql`),
        `${entry.name} still uses its pre-reconciliation timestamp`,
      );
    }
  }
});
