import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'test-results', 'production-owner');
const productionRef = 'rfwhqutkiztxkagbhevp';
const productionOrigin = 'https://glowflow.mocktar.com';

export function parseProductionOwnerTarget(env) {
  const ref = env.GLOWFLOW_PRODUCTION_PROJECT_REF;
  const url = env.GLOWFLOW_PRODUCTION_SUPABASE_URL;
  const origin = env.GLOWFLOW_PRODUCTION_APP_URL;
  const acknowledgement = env.GLOWFLOW_PRODUCTION_OWNER_VERIFICATION_ACK;
  if (ref !== productionRef) throw new Error(`Project ref must be exactly ${productionRef}.`);
  if (url !== `https://${productionRef}.supabase.co`) throw new Error('Production Supabase URL does not match the GlowFlow project ref.');
  if (origin !== productionOrigin) throw new Error('Production application URL must be exactly https://glowflow.mocktar.com.');
  if (acknowledgement !== `create-and-delete-disposable-owner:${productionRef}`) throw new Error('Explicit production owner verification acknowledgement is required.');
  if (!env.GLOWFLOW_PRODUCTION_SERVICE_ROLE_KEY || !env.GLOWFLOW_PRODUCTION_PUBLISHABLE_KEY) throw new Error('Production service and publishable keys are required.');
  return { ref, url, origin, serviceRoleKey: env.GLOWFLOW_PRODUCTION_SERVICE_ROLE_KEY, publishableKey: env.GLOWFLOW_PRODUCTION_PUBLISHABLE_KEY };
}

async function main() {
  const target = parseProductionOwnerTarget(process.env);
  const admin = createClient(target.url, target.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const publicClient = createClient(target.url, target.publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = randomUUID();
  const email = `launch-verification-${suffix}@example.invalid`;
  const password = `Launch!${randomBytes(18).toString('base64url')}`;
  const slug = `launch-verification-${suffix}`;
  let userId;
  let browser;

  try {
    const registered = await publicClient.auth.signUp({
      email,
      password,
      options: { data: { full_name: 'Launch Verification Owner', salon_name: 'Launch Verification Salon', salon_slug: slug, locale: 'en', country_code: 'US', time_zone: 'America/New_York', address_line1: '100 Verification Way', city: 'New York', postal_code: '10001', administrative_area: 'NY' } },
    });
    if (registered.error || !registered.data.user) throw registered.error ?? new Error('Registration returned no user.');
    userId = registered.data.user.id;
    if (!registered.data.session) {
      const confirmed = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
      if (confirmed.error) throw confirmed.error;
    } else {
      await publicClient.auth.signOut();
    }

    const { chromium } = await import(process.env.GLOWFLOW_PLAYWRIGHT_PATH
      ? pathToFileURL(process.env.GLOWFLOW_PLAYWRIGHT_PATH).href
      : 'playwright');
    browser = await chromium.launch({ headless: true, executablePath: process.env.GLOWFLOW_CHROMIUM_PATH || undefined });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(120_000);
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));

    await page.goto(`${target.origin}/en/register`);
    await page.locator('input[name="email"]').waitFor();
    await page.goto(`${target.origin}/en/login`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(`${target.origin}/en/dashboard`);
    await page.getByText('Launch Verification Salon', { exact: true }).waitFor();

    for (const locale of ['fr', 'en', 'es']) {
      await page.goto(`${target.origin}/${locale}/dashboard`);
      await page.locator('main').waitFor();
      assert.equal(new URL(page.url()).pathname, `/${locale}/dashboard`);
    }
    assert.deepEqual(browserErrors, []);

    const workspace = await admin.from('tenants').select('id,name,country_code,currency,time_zone').eq('owner_id', userId).single();
    if (workspace.error) throw workspace.error;
    assert.deepEqual(workspace.data, { id: workspace.data.id, name: 'Launch Verification Salon', country_code: 'US', currency: 'USD', time_zone: 'America/New_York' });

    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'production-owner-dashboard.png'), fullPage: true });
    await writeFile(path.join(artifacts, 'runtime.json'), JSON.stringify({ node: process.version, browser: browser.version(), projectRef: target.ref, applicationOrigin: target.origin, locales: ['fr', 'en', 'es'] }, null, 2));
    await context.close();
    console.log(JSON.stringify({ result: 'passed', project_ref: target.ref, auth_registration: true, auth_sign_in: true, owner_workspace_created: true, dashboard_locales: ['fr', 'en', 'es'] }));
  } finally {
    await browser?.close();
    if (userId) {
      const tenants = await admin.from('tenants').select('id').eq('owner_id', userId);
      if (!tenants.error) for (const tenant of tenants.data) await admin.from('tenants').delete().eq('id', tenant.id);
      await admin.auth.admin.deleteUser(userId);
      const residualTenants = await admin.from('tenants').select('id', { count: 'exact', head: true }).eq('owner_id', userId);
      const residualUser = await admin.auth.admin.getUserById(userId);
      if (residualTenants.count !== 0 || !residualUser.error) throw new Error('Disposable production owner cleanup did not complete.');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Production owner verification failed: ${error?.message || 'unknown error'}`);
    process.exitCode = 1;
  });
}
