import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { fallbackMarkets, formatLocalDateTime, formatMinorMoney, formatMinorMoneyWithCurrencyPrecision, formatMoney, marketPostalCodeLabel } from "../lib/markets.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260905012356_add_multi_country_markets.sql",
);
const ownerWorkspaceFixPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260924213044_fix_owner_workspace_market_permissions.sql",
);

test("defines an RLS-protected active market registry", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /create table public\.markets/);
  assert.match(sql, /alter table public\.markets enable row level security/);
  assert.match(sql, /create policy markets_active_select/);
  assert.match(sql, /using \(status = 'active'\)/);
  assert.match(sql, /country_code ~ '\^\[A-Z\]\{2\}\$'/);
  assert.match(sql, /currency ~ '\^\[A-Z\]\{3\}\$'/);
});

test("binds salons to a market and derives controlled settings", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /foreign key \(country_code\) references public\.markets/);
  assert.match(sql, /selected_market\.currency/);
  assert.match(sql, /selected_market\.country_code/);
  assert.match(sql, /salon_time_zone = any\(selected_market\.supported_time_zones\)/);
  assert.match(sql, /selected_market\.address_format ->> 'postal_code_pattern'/);
  assert.match(sql, /revoke update \(currency, time_zone\)/);
});

test("blocks public booking in inactive markets", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /drop policy if exists tenants_public_booking_select/);
  assert.match(sql, /drop policy if exists services_public_booking_select/);
  assert.equal((sql.match(/markets\.status = 'active'/g) ?? []).length, 2);
});

test("owner onboarding reads only market columns granted to authenticated users", async () => {
  const sql = await readFile(ownerWorkspaceFixPath, "utf8");

  assert.match(sql, /security invoker/i);
  assert.match(sql, /selected_market record/);
  assert.match(sql, /select country_code, supported_locales, currency, supported_time_zones, address_format/);
  assert.doesNotMatch(sql, /selected_market public\.markets%rowtype/);
  assert.doesNotMatch(sql, /select \*\s+into selected_market/);
  assert.match(sql, /revoke all on function public\.create_owner_workspace[\s\S]*from public, anon/);
  assert.match(sql, /grant execute on function public\.create_owner_workspace[\s\S]*to authenticated/);
});

// Fresh-install compatibility is executed against PostgreSQL in schema-database.test.mjs.

test("formats persisted catalog cents as major currency amounts", () => {
  assert.equal(formatMinorMoney(4500, "USD", "en"), "$45");
  assert.equal(formatMinorMoney(4599, "USD", "en"), "$45.99");
  assert.equal(formatMinorMoney(4500, "EUR", "es"), "45 €");
  assert.equal(formatMoney(1248, "USD", "en"), "$1,248");
});

test("postal-code labels follow interface language, not the selected country's default language", () => {
  const spain = fallbackMarkets.find((market) => market.country_code === "ES");
  const us = fallbackMarkets.find((market) => market.country_code === "US");
  assert.equal(marketPostalCodeLabel(spain, "fr"), "Code postal");
  assert.equal(marketPostalCodeLabel(spain, "en"), "Postal code");
  assert.equal(marketPostalCodeLabel(spain, "es"), "Código postal");
  assert.equal(marketPostalCodeLabel(us, "en"), "ZIP code");
  assert.equal(marketPostalCodeLabel(us, "fr"), "Code postal");
});

test("formats profile service amounts with booking currency precision", () => {
  assert.equal(formatMinorMoneyWithCurrencyPrecision(4500, "USD", "en"), "$45.00");
  assert.equal(formatMinorMoneyWithCurrencyPrecision(2500, "USD", "en"), "$25.00");
  assert.equal(formatMinorMoneyWithCurrencyPrecision(4500, "USD", "fr"), "45,00 $US");
  assert.equal(formatMinorMoneyWithCurrencyPrecision(2500, "USD", "fr"), "25,00 $US");
  assert.equal(formatMinorMoneyWithCurrencyPrecision(4500, "USD", "es"), "45,00 US$");
  assert.equal(formatMinorMoneyWithCurrencyPrecision(2500, "USD", "es"), "25,00 US$");
  assert.equal(formatMinorMoneyWithCurrencyPrecision(4599, "EUR", "fr"), "45,99 €");
});

test("formats salon appointment time across daylight saving for all supported languages", () => {
  for (const locale of ["fr", "en", "es"]) {
    for (const [instant, expectedHour] of [
      ["2030-01-15T12:00:00Z", "07"],
      ["2030-06-15T12:00:00Z", "08"],
    ]) {
      const actual = formatLocalDateTime(instant, locale, "America/New_York");
      const expected = new Intl.DateTimeFormat(locale, {
        dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
      }).format(new Date(instant));
      assert.equal(actual, expected);
      assert.match(actual, new RegExp(`(?:0?${Number(expectedHour)}):00|(?:0?${Number(expectedHour)})\\s?AM`, "i"));
    }
  }
});
