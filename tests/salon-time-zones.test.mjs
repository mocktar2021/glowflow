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
  const publicKey = "sb_publishable_fixture";
  const fakeFetch = async (input, init) => {
    const url = new URL(input.toString());
    const table = url.pathname.split("/").at(-1);
    const headers = new Headers(init?.headers);
    calls.push({ table, columns: url.searchParams.get("select"), headers });
    return new Response(JSON.stringify(fixtures[table]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const zones = await publicSalonTimeZones([{ slug: "los-angeles" }, { slug: "new-york" }, { slug: "bad-zone" }], {
    url: "https://fixture.supabase.co", key: publicKey, fetch: fakeFetch,
  });
  assert.deepEqual(zones, { "los-angeles": "America/Los_Angeles", "new-york": "America/New_York" });
  assert.deepEqual(calls.map(({ table, columns }) => [table, columns]), [
    ["salon_public_profiles", "slug,tenant_id"],
    ["tenants", "id,time_zone"],
  ]);
  for (const { headers } of calls) {
    assert.equal(headers.get("apikey"), publicKey);
    assert.equal(headers.get("authorization"), `Bearer ${publicKey}`);
    assert.equal(headers.has("cookie"), false);
  }
  assert.match(publicProfileGrant, /tenant_id,/);
  assert.match(baseline, /grant select \(id, name, slug, primary_language, currency, time_zone, is_booking_enabled\) on public\.tenants to anon/);
});

test("time-zone lookup fails closed to UTC display when a public read is unavailable", async () => {
  const config = {
    url: "https://fixture.supabase.co",
    key: "sb_publishable_fixture",
    fetch: async () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } }),
  };
  assert.deepEqual(await publicSalonTimeZones([{ slug: "example" }], config), {});
  assert.deepEqual(await publicSalonTimeZones([], config), {});
  assert.deepEqual(await publicSalonTimeZones([{ slug: "example" }], { ...config, url: "bad" }), {});
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
