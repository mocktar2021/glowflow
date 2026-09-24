import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseRecoveryTarget } from './hosted-storage-recovery-run.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'test-results', 'recovery');

export function parseRecoveredAppTarget(env) {
  const target = parseRecoveryTarget(env);
  if (!env.GLOWFLOW_RECOVERY_PUBLISHABLE_KEY) {
    throw new Error('GLOWFLOW_RECOVERY_PUBLISHABLE_KEY is required.');
  }
  return { ...target, publishableKey: env.GLOWFLOW_RECOVERY_PUBLISHABLE_KEY };
}

async function availableOrigin() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return `http://127.0.0.1:${port}`;
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    }).once('close', resolve));
  } else {
    server.kill('SIGTERM');
  }
}

async function main() {
  const target = parseRecoveredAppTarget(process.env);
  const admin = createClient(target.url, target.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = randomUUID();
  const email = `recovery-${suffix}@example.invalid`;
  const password = `Recovery!${randomBytes(18).toString('base64url')}`;
  const slug = `recovery-${suffix}`;
  const origin = await availableOrigin();
  let userId;
  let server;
  let browser;
  let output = '';

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'Recovery Owner',
        salon_name: 'Recovery Salon',
        salon_slug: slug,
        locale: 'en',
        country_code: 'US',
        time_zone: 'America/New_York',
        address_line1: '100 Recovery Way',
        city: 'New York',
        postal_code: '10001',
        administrative_area: 'NY',
      },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;

    const ownerClient = createClient(target.url, target.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await ownerClient.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    const workspaceCreated = await ownerClient.rpc('create_owner_workspace', {
      salon_name: 'Recovery Salon',
      requested_slug: slug,
      owner_full_name: 'Recovery Owner',
      owner_locale: 'en',
      salon_country_code: 'US',
      salon_time_zone: 'America/New_York',
      salon_address_line1: '100 Recovery Way',
      salon_city: 'New York',
      salon_postal_code: '10001',
      salon_administrative_area: 'NY',
    });
    if (workspaceCreated.error) {
      throw new Error(`Workspace creation failed (${workspaceCreated.error.code || 'unknown'}): ${workspaceCreated.error.message}`);
    }
    await ownerClient.auth.signOut();

    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|STRIPE|GLOWFLOW_APP|VERCEL/.test(key)));
    const port = new URL(origin).port;
    server = spawn(process.execPath, [
      path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'dev', '--webpack', '--hostname', '127.0.0.1', '--port', port,
    ], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...cleanEnv,
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_SUPABASE_URL: target.url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: target.publishableKey,
        SUPABASE_SECRET_KEY: target.serviceRoleKey,
        GLOWFLOW_APP_URL: origin,
      },
    });
    server.stdout.on('data', value => { output += value; });
    server.stderr.on('data', value => { output += value; });

    const deadline = Date.now() + 180_000;
    while (true) {
      if (server.exitCode !== null) throw new Error(`Recovered app server exited during startup: ${output.slice(-3000)}`);
      try {
        const response = await fetch(`${origin}/en/login`, { signal: AbortSignal.timeout(10_000) });
        if (response.ok) break;
      } catch { /* startup */ }
      if (Date.now() > deadline) throw new Error(`Recovered app server failed to start: ${output.slice(-3000)}`);
      await new Promise(resolve => setTimeout(resolve, 500));
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

    await page.goto(`${origin}/en/login`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${origin}/en/dashboard`);
    await page.getByRole('heading', { name: 'Hi, Recovery Owner' }).waitFor();
    await page.getByText('Recovery Salon', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Service catalog' }).waitFor();
    await page.getByRole('link', { name: 'Payments' }).waitFor();

    await page.goto(`${origin}/fr/dashboard`);
    await page.getByRole('heading', { name: 'Bonjour, Recovery Owner' }).waitFor();
    await page.getByRole('link', { name: 'Prestations' }).waitFor();

    await page.goto(`${origin}/es/dashboard`);
    await page.getByRole('heading', { name: 'Hola, Recovery Owner' }).waitFor();
    await page.getByRole('link', { name: 'Servicios' }).waitFor();
    assert.deepEqual(browserErrors, [], 'Recovered dashboard emitted browser errors.');

    const workspace = await admin.from('tenants').select('id, name, country_code, currency, time_zone').eq('owner_id', userId).single();
    if (workspace.error) throw workspace.error;
    assert.deepEqual(workspace.data, {
      id: workspace.data.id,
      name: 'Recovery Salon',
      country_code: 'US',
      currency: 'USD',
      time_zone: 'America/New_York',
    });

    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'hosted-recovered-dashboard.png'), fullPage: true });
    await writeFile(path.join(artifacts, 'hosted-recovered-runtime.json'), JSON.stringify({
      node: process.version,
      browser: browser.version(),
      projectRef: target.recoveryRef,
      locales: ['en', 'fr', 'es'],
    }, null, 2));

    await context.close();
    console.log(JSON.stringify({
      result: 'passed',
      project_ref: target.recoveryRef,
      auth_sign_in: true,
      owner_workspace_created: true,
      dashboard_locales: ['en', 'fr', 'es'],
      owner_navigation: true,
    }));
  } finally {
    await browser?.close();
    await stopServer(server);
    if (userId) {
      const tenants = await admin.from('tenants').select('id').eq('owner_id', userId);
      if (!tenants.error) {
        for (const tenant of tenants.data) await admin.from('tenants').delete().eq('id', tenant.id);
      }
      await admin.auth.admin.deleteUser(userId);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Hosted recovered-app drill failed: ${error?.message || 'unknown error'}`);
    process.exitCode = 1;
  });
}
