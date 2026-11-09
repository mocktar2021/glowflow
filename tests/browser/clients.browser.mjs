import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const { chromium } = await import(process.env.GLOWFLOW_PLAYWRIGHT_PATH ? pathToFileURL(process.env.GLOWFLOW_PLAYWRIGHT_PATH).href : "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = path.join(root, "tests/browser/fixture");
const clientId = "30000000-0000-0000-0000-000000000001";
const foreignId = "30000000-0000-0000-0000-000000000002";
const malformedNailsId = "30000000-0000-0000-0000-000000000003";
let server, browser, origin;
let output = "";

before(async () => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|STRIPE|GLOWFLOW_APP|VERCEL/.test(key)));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: fixture, env: { ...env, NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", value => output += value);
  server.stderr.on("data", value => output += value);
  const deadline = Date.now() + 120000;
  while (true) {
    if (server.exitCode !== null) throw new Error(output);
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(10000) }); if (response.ok) break; } catch { /* startup */ }
    if (Date.now() > deadline) throw new Error(`Fixture failed to start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.GLOWFLOW_CHROMIUM_PATH || undefined });
}, { timeout: 150000 });

after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) server.kill("SIGTERM");
});

async function pageFor(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (identity) await context.addCookies([{ name: "fixture-identity", value: identity, url: origin }]);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(90000);
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  return { context, page };
}

for (const [locale, title, search, history, nailPreferences, shade, reportedInfill, oldInfill] of [
  ["fr", "Clients", "Rechercher", "Rendez-vous récents", "Préférences ongulaires", "Teinte", "Date déclarée du dernier remplissage", "Dernier remplissage"],
  ["en", "Clients", "Search", "Recent appointments", "Nail preferences", "Shade", "Reported last infill date", "Last infill"],
  ["es", "Clientes", "Buscar", "Citas recientes", "Preferencias de uñas", "Tono", "Fecha declarada del último relleno", "Último relleno"],
]) {
  for (const identity of ["owner", "staff"]) test(`${locale} ${identity} can search and read their own synthetic client`, async () => {
    const { context, page } = await pageFor(identity);
    try {
      const response = await page.goto(`${origin}/${locale}/dashboard/clients`);
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { name: title, exact: true, level: 1 }).waitFor();
      await page.getByRole("searchbox").fill("alice@example.invalid");
      await page.getByRole("button", { name: search, exact: true }).click();
      await page.getByRole("link", { name: /Synthetic Alice/ }).waitFor();
      await page.getByRole("link", { name: /Fixture Client/ }).waitFor({ state: "detached" });
      assert.equal(await page.getByRole("link", { name: /Fixture Client/ }).count(), 0);
      assert.equal(new URL(page.url()).search, "", "contact search stays out of the URL");
      const profileResponse = await page.goto(`${origin}/${locale}/dashboard/clients/${clientId}`);
      assert.equal(profileResponse.status(), 200);
      assert.doesNotMatch(await profileResponse.text(), /SYNTHETIC-NAIL-PRIVATE-DO-NOT-SERIALIZE/, "unknown preference keys must not enter the HTML or RSC payload");
      await page.getByRole("heading", { name: "Synthetic Alice" }).waitFor();
      await page.getByRole("heading", { name: history }).waitFor();
      const nails = page.getByRole("region", { name: nailPreferences });
      await nails.getByText(shade, { exact: true }).waitFor();
      await nails.getByText("Rose gold", { exact: true }).waitFor();
      await nails.getByText(reportedInfill, { exact: true }).waitFor();
      assert.equal(await nails.getByText(oldInfill, { exact: true }).count(), 0, "mutable preference date must not be presented as verified history");
      assert.equal(await nails.locator("img").count(), 0, "untrusted preference text must not become markup");
      assert.equal(await nails.getByText("Synthetic floral design <img src=x onerror=alert(1)>").count(), 1);
      assert.equal(await page.locator('textarea[name="notes"]').inputValue(), "Synthetic private note");
      assert.equal(await page.getByText("Foreign private note").count(), 0);
      assert.equal(await page.getByText("Foreign nail secret").count(), 0);
    } finally { await context.close(); }
  });
  test(`${locale} directory denies anonymous and foreign client access`, async () => {
    const anonymous = await pageFor(null);
    try {
      await anonymous.page.goto(`${origin}/${locale}/dashboard/clients`);
      await anonymous.page.waitForURL(`${origin}/${locale}/login`);
    } finally { await anonymous.context.close(); }
    const member = await pageFor("staff");
    try {
      const response = await member.page.goto(`${origin}/${locale}/dashboard/clients/${foreignId}`);
      assert.equal(response.status(), 404);
      assert.equal(await member.page.getByText("Foreign private note").count(), 0);
      assert.equal(await member.page.getByText("Foreign nail secret").count(), 0);
    } finally { await member.context.close(); }
  });
}

for (const [locale, heading, emptyMessage] of [
  ["fr", "Préférences ongulaires", "Aucune préférence ongulaire enregistrée."],
  ["en", "Nail preferences", "No nail preferences recorded."],
  ["es", "Preferencias de uñas", "No hay preferencias de uñas registradas."],
]) {
  test(`${locale} malformed synthetic nail preferences render a private mobile empty state`, async () => {
    const { context, page } = await pageFor("staff");
    try {
      const response = await page.goto(`${origin}/${locale}/dashboard/clients/${malformedNailsId}`);
      assert.equal(response.status(), 200);
      assert.doesNotMatch(await response.text(), /SYNTHETIC-MALFORMED-NAIL-PRIVATE-DO-NOT-SERIALIZE/,
        "unknown private JSONB keys must not enter HTML or the RSC payload");
      const nails = page.getByRole("region", { name: heading });
      await nails.getByText(emptyMessage, { exact: true }).waitFor();
      assert.equal(await nails.locator("dt, img").count(), 0,
        "invalid preference values must not become visible fields or markup");
      assert.equal(await page.getByText("SYNTHETIC-MALFORMED-NAIL-PRIVATE-DO-NOT-SERIALIZE").count(), 0);
    } finally { await context.close(); }
  });
}

for (const [locale, identity, save, invalid] of [
  ["fr", "owner", "Enregistrer", "7 à 15 chiffres"],
  ["en", "staff", "Save", "7 to 15 digits"],
  ["es", "owner", "Guardar", "7 y 15 dígitos"],
]) {
  test(`${locale} ${identity} creates a synthetic client from the actual directory form`, async () => {
    const { context, page } = await pageFor(identity);
    const id = { fr: "30000000-0000-4000-8000-000000000011", en: "30000000-0000-4000-8000-000000000012", es: "30000000-0000-4000-8000-000000000013" }[locale];
    const name = `Synthetic New ${locale.toUpperCase()}`;
    const email = `synthetic-new-${locale}@example.invalid`;
    const notes = `Synthetic browser-only note ${locale}`;
    try {
      await page.goto(`${origin}/${locale}/dashboard/clients`);
      await page.locator('input[name="full_name"]').fill(name);
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="phone"]').fill("+1 555 010 0099");
      await page.locator('select[name="preferred_locale"]').selectOption(locale);
      await page.locator('textarea[name="notes"]').fill(notes);
      await page.getByRole("button", { name: save, exact: true }).click();
      await page.waitForURL(`${origin}/${locale}/dashboard/clients/${id}`);
      await page.getByRole("heading", { name, exact: true, level: 1 }).waitFor();
      assert.equal(await page.locator('input[name="email"]').inputValue(), email);
      assert.equal(await page.locator('input[name="phone"]').inputValue(), "+1 555 010 0099");
      assert.equal(await page.locator('select[name="preferred_locale"]').inputValue(), locale);
      assert.equal(await page.locator('textarea[name="notes"]').inputValue(), notes);
      assert.equal(await page.getByText("Foreign private note").count(), 0);
    } finally { await context.close(); }
  });

  test(`${locale} invalid phone shows validation feedback without a client insert`, async () => {
    const { context, page } = await pageFor("staff-no-insert");
    try {
      await page.goto(`${origin}/${locale}/dashboard/clients`);
      await page.locator('input[name="full_name"]').fill("Synthetic Invalid Contact");
      await page.locator('input[name="email"]').fill("invalid-contact@example.invalid");
      await page.locator('input[name="phone"]').fill("123");
      await page.getByRole("button", { name: save, exact: true }).click();
      await page.getByRole("alert").filter({ hasText: invalid }).waitFor();
      assert.equal(page.url(), `${origin}/${locale}/dashboard/clients`);
    } finally { await context.close(); }
  });
}

test("mobile client Save stays above the persistent workspace navigation", async () => {
  const { context, page } = await pageFor("owner");
  try {
    await page.goto(`${origin}/en/dashboard/clients`);
    await page.locator('textarea[name="notes"]').fill("Synthetic layout-only note");
    const save = await page.getByRole("button", { name: "Save", exact: true }).boundingBox();
    const navigation = await page.getByRole("navigation", { name: "Salon management" }).boundingBox();
    assert.ok(save && navigation && save.y + save.height <= navigation.y,
      "the mobile action must remain fully above the fixed navigation");
  } finally { await context.close(); }
});

test("invalid email reaches server validation without a client insert", async () => {
  const { context, page } = await pageFor("staff-no-insert");
  try {
    await page.goto(`${origin}/en/dashboard/clients`);
    await page.locator('input[name="full_name"]').fill("Synthetic Invalid Email");
    await page.locator('input[name="email"]').fill("not-an-email");
    await page.locator('input[name="phone"]').fill("+1 555 010 0099");
    // Native email validity normally stops the submit. Bypass it in the fixture
    // to exercise the production server action's independent validation.
    await page.locator('form:has(input[name="full_name"])').evaluate(form => { form.noValidate = true; });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Check the name, email, and phone" }).waitFor();
    assert.equal(page.url(), `${origin}/en/dashboard/clients`);
  } finally { await context.close(); }
});

test("profile form rejects an invalid phone before any client write", async () => {
  const { context, page } = await pageFor("staff");
  try {
    await page.goto(`${origin}/en/dashboard/clients/${clientId}`);
    await page.locator('input[name="phone"]').fill("123");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "7 to 15 digits" }).waitFor();
    assert.equal(page.url(), `${origin}/en/dashboard/clients/${clientId}`);
  } finally { await context.close(); }
});

test("staff can submit a valid tenant-scoped profile update", async () => {
  const { context, page } = await pageFor("staff");
  try {
    await page.goto(`${origin}/en/dashboard/clients/${clientId}`);
    await page.locator('input[name="phone"]').fill("+1 555 010 5678");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Profile saved." }).waitFor();
  } finally { await context.close(); }
});

test("forged foreign client ID cannot be saved by a staff member", async () => {
  const { context, page } = await pageFor("staff");
  try {
    await page.goto(`${origin}/en/dashboard/clients/forged`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Could not save the profile" }).waitFor();
    assert.equal(await page.getByRole("status").count(), 0);
  } finally { await context.close(); }
});

for (const locale of ["fr", "en", "es"]) {
  test(`${locale} unknown private hair and patch keys stay out of the client profile payload`, async () => {
    const { context, page } = await pageFor("staff");
    try {
      const response = await page.goto(`${origin}/${locale}/dashboard/clients/30000000-0000-0000-0000-000000000004`);
      assert.equal(response.status(), 200);
      const html = await response.text();
      assert.doesNotMatch(html, /SYNTHETIC-HAIR-PRIVATE-DO-NOT-SERIALIZE/,
        "unknown formula keys must not enter HTML or the RSC payload");
      assert.doesNotMatch(html, /SYNTHETIC-PATCH-PRIVATE-DO-NOT-SERIALIZE/,
        "unknown patch-test keys must not enter HTML or the RSC payload");
      await page.getByRole("heading", { name: "Synthetic Hair History", exact: true, level: 1 }).waitFor();
    } finally { await context.close(); }
  });
}
