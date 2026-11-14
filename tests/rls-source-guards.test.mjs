import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertClientBoundaries, assertRlsDeclarations, assertTrustedAdminClientUsage } from './rls-source-guards.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function codeFiles(folder, map = new Map()) {
  for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const filename = `${folder}/${entry.name}`;
    if (entry.isDirectory()) codeFiles(filename, map);
    else if (/\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name)) map.set(filename, readFileSync(path.join(root, filename), 'utf8'));
  }
  return map;
}

test('all declared public and private tables retain an RLS enable declaration', () => {
  const files = ['supabase/schema.sql', ...readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort().map(name => `supabase/migrations/${name}`)];
  const tables = assertRlsDeclarations(files.map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
  for (const table of ['public.tenants', 'public.stripe_sandbox_events', 'private.public_booking_intent_policy', 'private.public_booking_contract_gate']) {
    assert.ok(tables.includes(table), `${table} must be checked`);
  }
});

test('RLS declaration guard rejects missing and later disabled protection', () => {
  const protectedTable = 'create table public.private_clients(id uuid); alter table public.private_clients enable row level security;';
  assert.throws(() => assertRlsDeclarations([['bad.sql', protectedTable + ' alter table only public.private_clients disable row level security;']]), /private_clients/);
  assert.throws(() => assertRlsDeclarations([['bad.sql', protectedTable + ' drop table public.private_clients; create table public.private_clients(id uuid);']]), /DROP TABLE/);
  assert.throws(() => assertRlsDeclarations([['bad.sql', protectedTable + ' drop table public.private_clients; create table if not exists public.private_clients(id uuid);']]), /DROP TABLE/);
  for (const statement of ['create table private_clients(id uuid);', 'alter table only private_clients disable row level security;']) {
    assert.throws(() => assertRlsDeclarations([['bad.sql', protectedTable + ' set search_path=public; ' + statement]]), /Unqualified table/);
  }

  assert.throws(() => assertRlsDeclarations([['bad.sql', 'create table public.private_clients(id uuid,tenant_id uuid);']]), /private_clients/);
  assert.throws(() => assertRlsDeclarations([['bad.sql', protectedTable + ' create table public.copied_clients as select * from public.private_clients;']]), /copied_clients/);
  assert.deepEqual(assertRlsDeclarations([['safe.sql', protectedTable + ' create table public.copied_clients as select * from public.private_clients; alter table public.copied_clients enable row level security;']]), ['public.copied_clients', 'public.private_clients']);
  assert.throws(() => assertRlsDeclarations([['bad.sql', 'create table public.private_clients(id uuid); alter table public.private_clients enable row level security; alter table public.private_clients disable row level security;']]), /private_clients/);
  assert.throws(() => assertRlsDeclarations([['bad.sql', 'create table public.private_clients(id uuid); -- alter table public.private_clients enable row level security;']]), /private_clients/);
  assert.throws(() => assertRlsDeclarations([['bad.sql', protectedTable + ' create table private.singleton_policy(singleton boolean primary key);']]), /private\.singleton_policy/);
  assert.throws(() => assertRlsDeclarations([['bad.sql', protectedTable + ' create table private.singleton_policy(singleton boolean primary key); alter table private.singleton_policy enable row level security; alter table private.singleton_policy disable row level security;']]), /private\.singleton_policy/);
  assert.deepEqual(assertRlsDeclarations([['safe.sql', protectedTable + ' create table private.private_clients(id uuid); alter table private.private_clients enable row level security;']]), ['private.private_clients', 'public.private_clients']);
});

test('client import graph cannot reach the privileged Supabase client', () => {
  const sources = codeFiles('app');
  for (const folder of ['lib', 'components', 'hooks']) {
    try { codeFiles(folder, sources); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assertClientBoundaries(sources);
  assert.match(sources.get('lib/supabase/admin.ts'), /^import ["']server-only["'];/);
});

test('client guard catches alias, relative, re-export and dynamic credential paths', () => {
  const admin = ['lib/supabase/admin.ts', 'export const secret = process.env.SUPABASE_SECRET_KEY;'];
  for (const bridge of ['export { secret } from "../supabase/admin";', 'const secret = import("@/lib/supabase/admin");', 'const secret = require("../supabase/admin");']) {
    assert.throws(() => assertClientBoundaries(new Map([
      ['app/panel.tsx', '"use client"; import { secret } from "@/lib/bridge";'],
      ['lib/bridge/index.ts', bridge], admin,
    ])), /Private Supabase credentials reachable from client/);
  }
  assertClientBoundaries(new Map([
    ['app/panel.tsx', '"use client"; import { action } from "./actions";'],
    ['app/actions.ts', '"use server"; import { secret } from "@/lib/supabase/admin";'], admin,
  ]));
});

test('client guard follows static template imports and rejects interpolated paths', () => {
  const admin = ['lib/supabase/admin.ts', 'export const secret = process.env.SUPABASE_SECRET_KEY;'];
  for (const source of [
    '"use client"; const secret = import(`@/lib/supabase/admin`);',
    '"use client"; const secret = require(`../lib/supabase/admin`);',
  ]) {
    assert.throws(() => assertClientBoundaries(new Map([
      ['app/panel.tsx', source], admin,
    ])), /Private Supabase credentials reachable from client/);
  }
  assert.throws(() => assertClientBoundaries(new Map([
    ['app/panel.tsx', '"use client"; const suffix = "admin"; const secret = import(`@/lib/supabase/${suffix}`);'], admin,
  ])), /Nonliteral client import requires security review/);
  for (const source of [
    '"use client"; const path = "@/lib/supabase/admin"; const secret = import(path);',
    '"use client"; const secret = import("@/lib/supabase/" + "admin");',
    '"use client"; const path = "@/lib/supabase/admin"; const secret = require?.(path);',
    '"use client"; const path = "@/lib/supabase/admin"; const secret = module["require"](path);',
    '"use client"; const path = "@/lib/supabase/admin"; const secret = globalThis["require"](path);',
  ]) {
    assert.throws(() => assertClientBoundaries(new Map([
      ['app/panel.tsx', source], admin,
    ])), /Nonliteral client import requires security review/);
  }
  assertClientBoundaries(new Map([
    ['app/panel.tsx', '"use client"; const safe = import(`@/lib/safe`);'],
    ['lib/safe.ts', 'export const safe = true;'],
  ]));
  assertClientBoundaries(new Map([
    ['app/panel.tsx', '"use client"; const help = "import(path) and require?.(path) are examples";'],
  ]));
  assertClientBoundaries(new Map([
    ['app/panel.tsx', '"use client"; // SUPABASE_SECRET_KEY is a documented server-only variable\nconst safe = true; // SUPABASE_SERVICE_ROLE_KEY stays private'],
  ]));
  assert.throws(() => assertClientBoundaries(new Map([
    ['app/panel.tsx', '"use client"; const unsafe = process.env.SUPABASE_SECRET_KEY;'],
  ])), /Private Supabase credentials reachable from client/);
});

test('privileged Supabase client remains limited to reviewed server operations', () => {
  const sources = codeFiles('app');
  codeFiles('lib', sources);
  for (const folder of ['components', 'hooks']) {
    codeFiles(folder, sources);
    assert.ok([...sources.keys()].some(filename => filename.startsWith(`${folder}/`)),
      `privileged-client review must include ${folder}/`);
  }
  const approved = new Set([
    'app/[locale]/book/[slug]/page.tsx',
    'app/api/checkout/route.ts',
    'app/api/public-booking/route.ts',
    'app/api/public-booking/v2/route.ts', // Reviewed: strict same-origin cookie actions and service-role-only intent RPCs.
    'app/api/stripe/webhook/route.ts',
    'lib/stripe-sandbox.ts',
    'lib/staff-invitation-delivery.ts',
    'lib/staff-invitation-sender.ts',
    'lib/glow56-cleanup-runner.mjs', // Reviewed: server-only bounded RPCs; only authenticated adapters call this runner.
  ]);
  assertTrustedAdminClientUsage(sources, approved);
  for (const unreviewedSource of [
    'import { createAdminClient } from "@/lib/supabase/admin";',
    'const key = process.env.SUPABASE_SECRET_KEY;',
    'const admin = import("@/lib/supabase/admin");',
  ]) {
    assert.throws(() => assertTrustedAdminClientUsage(new Map([...sources, ['app/api/unreviewed/route.ts', unreviewedSource]]), approved), /Unreviewed privileged Supabase client use/);
  }
  for (const filename of ['components/glowflow/unsafe-server-panel.tsx', 'hooks/use-unsafe-server-data.ts']) {
    assert.throws(() => assertTrustedAdminClientUsage(new Map([...sources, [filename,
      'import { createAdminClient } from "@/lib/supabase/admin";',
    ]]), approved), /Unreviewed privileged Supabase client use/);
  }
});
