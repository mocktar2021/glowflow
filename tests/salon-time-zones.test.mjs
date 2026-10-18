import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { publicSalonTimeZones } from "../lib/salon-time-zones.ts";
import { endOfLocalDayUtc, isValidIanaTimeZone, timeZoneOptions } from "../lib/marketplace-time-zones.ts";

const searchPage = await readFile(new URL("../app/[locale]/salons/(search)/page.tsx", import.meta.url), "utf8");
const baseline = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const publicProfileGrant = await readFile(new URL("../supabase/migrations/20260924183507_restrict_public_salon_profile_columns.sql", import.meta.url), "utf8");

test("public salon time-zone lookup reads only granted fields and preserves each salon's zone", async () => {
  const calls = [];
  const fixtures = {
    salon_public_profiles: [
      { slug: "los-angeles", tenant_id: "tenant-la" },
      { slug: "new-york", tenant_id: "tenant-ny" },
      { slug: "bad-zone", tenant_id: "tenant-bad" },
    ],
    tenants: [
      { id: "tenant-la", time_zone: "America/Los_Angeles" },
      { id: "tenant-ny", time_zone: "America/New_York" },
      { id: "tenant-bad", time_zone: "Mars/Olympus" },
    ],
  };
  const client = {
    from(table) {
      return { select(columns) {
        return { in(key, values) {
          calls.push({ table, columns, key, values });
          return Promise.resolve({ data: fixtures[table], error: null });
        } };
      } };
    },
  };
  const zones = await publicSalonTimeZones(client, [{ slug: "los-angeles" }, { slug: "new-york" }, { slug: "bad-zone" }]);
  assert.deepEqual(zones, { "los-angeles": "America/Los_Angeles", "new-york": "America/New_York" });
  assert.deepEqual(calls.map(({ table, columns }) => [table, columns]), [
    ["salon_public_profiles", "slug, tenant_id"],
    ["tenants", "id, time_zone"],
  ]);
  assert.match(publicProfileGrant, /tenant_id,/);
  assert.match(baseline, /grant select \(id, name, slug, primary_language, currency, time_zone, is_booking_enabled\) on public\.tenants to anon/);
});

test("time-zone lookup fails closed to UTC display when a public read is unavailable", async () => {
  const client = { from() { return { select() { return { in: async () => ({ data: null, error: { code: "PGRST301" } }) }; } }; } };
  assert.deepEqual(await publicSalonTimeZones(client, [{ slug: "example" }]), {});
  assert.deepEqual(await publicSalonTimeZones(client, []), {});
});

test("available-by date and filter-zone distinctions are explained in every language", () => {
  assert.match(searchPage, /Disponible d’ici la fin du/);
  assert.match(searchPage, /Available by end of date/);
  assert.match(searchPage, /Disponible antes de terminar el día/);
  assert.match(searchPage, /Les horaires affichés sur les cartes utilisent celui de chaque salon/);
  assert.match(searchPage, /Times on salon cards use each salon’s own time zone/);
  assert.match(searchPage, /Las horas en las tarjetas usan la zona de cada salón/);
});

test("local date cutoff respects spring and fall daylight-saving boundaries", () => {
  assert.equal(endOfLocalDayUtc("2026-03-08", "America/New_York"), "2026-03-09T03:59:59.999999Z");
  assert.equal(endOfLocalDayUtc("2026-11-01", "America/New_York"), "2026-11-02T04:59:59.999999Z");
  assert.equal(endOfLocalDayUtc("2026-03-29", "Europe/Paris"), "2026-03-29T21:59:59.999999Z");
  assert.equal(endOfLocalDayUtc("2026-10-25", "Europe/Paris"), "2026-10-25T22:59:59.999999Z");
  assert.equal(endOfLocalDayUtc("2026-11-15", "UTC"), "2026-11-15T23:59:59.999999Z");
  assert.equal(endOfLocalDayUtc("2026-11-15", "Pacific/Kiritimati"), "2026-11-15T09:59:59.999999Z");
  assert.equal(endOfLocalDayUtc("2026-11-15", "Pacific/Honolulu"), "2026-11-16T09:59:59.999999Z");
});

test("invalid dates and IANA zones are rejected before querying", () => {
  assert.equal(isValidIanaTimeZone("Mars/Olympus"), false);
  assert.equal(isValidIanaTimeZone("America/New_York"), true);
  assert.equal(endOfLocalDayUtc("2026-02-30", "UTC"), null);
  assert.equal(endOfLocalDayUtc("2026-11-15", "Mars/Olympus"), null);
  assert.equal(timeZoneOptions("America/New_York")[0], "UTC");
  assert.ok(timeZoneOptions("America/New_York").includes("America/New_York"));
});
