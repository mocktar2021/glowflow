import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertClientBoundaries, assertRlsDeclarations } from './rls-source-guards.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function codeFiles(folder, map = new Map()) {
  for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const filename = `${folder}/${entry.name}`;
    if (entry.isDirectory()) codeFiles(filename, map);
    else if (/\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name)) map.set(filename, readFileSync(path.join(root, filename), 'utf8'));
  }
  return map;
}

test('all declared public tables retain an RLS enable declaration', () => {
  const files = ['supabase/schema.sql', ...readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort().map(name => `supabase/migrations/${name}`)];
  const tables = assertRlsDeclarations(files.map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
  assert.ok(tables.includes('tenants') && tables.includes('stripe_sandbox_events'));
});

test('RLS declaration guard rejects missing and later disabled protection', () => {
  assert.throws(() => assertRlsDeclarations([['bad.sql', 'create table public.private_clients(id uuid,tenant_id uuid);']]), /private_clients/);
  assert.throws(() => assertRlsDeclarations([['bad.sql', 'create table public.private_clients(id uuid); alter table public.private_clients enable row level security; alter table public.private_clients disable row level security;']]), /private_clients/);
  assert.throws(() => assertRlsDeclarations([['bad.sql', 'create table public.private_clients(id uuid); -- alter table public.private_clients enable row level security;']]), /private_clients/);
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
