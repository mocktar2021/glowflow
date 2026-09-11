import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/notifications/templates.ts", import.meta.url), "utf8");
const loaded = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(loaded, loaded.exports);
const { renderNotification } = loaded.exports;
const base = { kind: "confirmation", salonName: "Atelier Belle", serviceName: "Coupe", startsAt: "2026-09-10T14:30:00Z", timeZone: "Europe/Paris", address: "12 rue des Fleurs, Paris" };

test("all nine localized messages include validated booking details without unresolved variables", () => {
  const headings = { fr: ["Rendez-vous confirmé", "24 heures", "2 heures"], en: ["Appointment confirmed", "24 hours", "2 hours"], es: ["Cita confirmada", "24 horas", "2 horas"] };
  for (const locale of ["fr", "en", "es"]) {
    for (const [index, kind] of ["confirmation", "reminder24h", "reminder2h"].entries()) {
      const result = renderNotification({ ...base, clientLocale: locale, kind });
      assert.equal(result.locale, locale);
      assert.ok(result.text.includes(headings[locale][index]));
      for (const value of [base.salonName, base.serviceName, base.address, base.timeZone]) assert.ok(result.text.includes(value));
      assert.doesNotMatch(result.text, /[{}<>]|https?:\/\//);
      assert.equal(result.text.split("\n").length, 6);
    }
  }
});

test("client BCP47 language wins, unsupported or malformed locales fall back to salon then French", () => {
  for (const [clientLocale, salonLocale, expected] of [["EN-us", "es", "en"], ["fr-CA", "en", "fr"], [" es-MX ", "fr", "es"], ["de-DE", "en-GB", "en"], ["en_bad", "es-ES", "es"], [null, "fr", "fr"], ["zz", "bad_locale", "fr"], [undefined, undefined, "fr"], [23, {}, "fr"]]) {
    assert.equal(renderNotification({ ...base, clientLocale, salonLocale }).locale, expected);
  }
});

test("offset-aware dates render in salon timezone across daylight saving and midnight", () => {
  const render = (startsAt, timeZone = "Europe/Paris") => renderNotification({ ...base, startsAt, timeZone, clientLocale: "en" }).text;
  assert.match(render("2026-01-10T14:30:00Z"), /3:30 PM/);
  assert.match(render("2026-07-10T14:30:00Z"), /4:30 PM/);
  assert.equal(render("2026-09-10T14:30:00Z"), render("2026-09-10T16:30:00+02:00"));
  assert.match(render("2026-09-10T23:30:00Z"), /September 11, 2026/);
  assert.match(render("2026-03-29T00:30:00Z"), /1:30 AM/);
  assert.match(render("2026-03-29T01:30:00Z"), /3:30 AM/);
});

test("missing, impossible, ambiguous or malformed scheduling values fail safely", () => {
  for (const startsAt of [undefined, null, "", "2026-09-10T14:30", "2026-02-29T12:00:00Z", "2026-04-31T12:00:00Z", "2026-13-01T12:00:00Z", "2026-01-00T12:00:00Z", "0000-01-01T12:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T12:60:00Z", "2026-01-01T12:00:60Z", "2026-01-01T12:00:00+24:00", "2026-01-01T12:00:00+01:60", "tomorrow"]) {
    assert.throws(() => renderNotification({ ...base, startsAt }), { message: "Invalid notification data" });
  }
  for (const timeZone of [undefined, "", "Mars/Olympus", "Europe/Paris\n"]) assert.throws(() => renderNotification({ ...base, timeZone }), { message: "Invalid notification data" });
  assert.doesNotThrow(() => renderNotification({ ...base, startsAt: "2028-02-29T12:00:00.123Z" }));
});

test("untrusted text cannot inject extra fields, markup or unresolved template tokens", () => {
  for (const field of ["salonName", "serviceName", "address"]) {
    for (const value of [undefined, null, 42, " ", "Secret\nsecond line", "Secret\tvalue", "Secret\u0000value", "Secret\u2028value", "Secret\u202evalue", "{{Secret}}", "${Secret}", "<b>Secret</b>", "%Secret%", "%s", "x".repeat(field === "address" ? 301 : 161)]) {
      assert.throws(() => renderNotification({ ...base, [field]: value }), { message: "Invalid notification data" });
    }
  }
  assert.ok(renderNotification({ ...base, salonName: "  L'Atelier & Beauté  " }).text.includes("L'Atelier & Beauté\n"));
  assert.throws(() => renderNotification({ ...base, kind: "Secret" }), { message: "Invalid notification data" });
  assert.throws(() => renderNotification(null), { message: "Invalid notification data" });
});

test("Spanish preview uses an explicit stable date and time separator across runtimes", () => {
  const message = renderNotification({ ...base, clientLocale: "es", startsAt: "2030-06-15T12:00:00Z" });
  assert.ok(message.text.includes("Fecha y hora : 15 de junio de 2030 · 14:00"));
});
