import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

export function parseLoopbackAdminUrl(supplied) {
  if (!supplied) throw new Error('GLOWFLOW_RLS_ADMIN_DATABASE_URL is required; recovery tests must not skip.');
  let url;
  try { url = new URL(supplied); } catch { throw new Error('A valid localhost PostgreSQL admin URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.pathname !== '/postgres' || url.search || url.hash) {
    throw new Error('Use a localhost PostgreSQL admin URL ending in /postgres with no query or fragment.');
  }
  return url;
}

function redact(message, urls) {
  let output = String(message || 'Local PostgreSQL recovery command failed.');
  for (const url of urls) {
    for (const value of [url.href, url.password, decodeURIComponent(url.password)]) {
      if (value) output = output.replaceAll(value, '[redacted]');
    }
  }
  return output.slice(0, 3000);
}

function run(binary, args, urls, options = {}) {
  try {
    return execFileSync(binary, args, {
      encoding: 'utf8',
      stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      input: options.input,
      timeout: options.timeout || 120_000,
    }).trim();
  } catch (error) {
    throw new Error(redact(error.stderr || error.message, urls));
  }
}

function clientBinary(name) {
  if (name === 'psql' && process.env.PSQL_BIN) return process.env.PSQL_BIN;
  const explicit = process.env[name === 'pg_dump' ? 'PG_DUMP_BIN' : 'PG_RESTORE_BIN'];
  if (explicit) return explicit;
  if (process.env.PSQL_BIN) return join(dirname(process.env.PSQL_BIN), `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  return name;
}

function main() {
  const admin = parseLoopbackAdminUrl(process.env.GLOWFLOW_RLS_ADMIN_DATABASE_URL);
  const psql = clientBinary('psql');
  const pgDump = clientBinary('pg_dump');
  const pgRestore = clientBinary('pg_restore');
  const suffix = `${Date.now()}_${randomInt(1_000_000)}`;
  const sourceName = `glowflow_recovery_source_${suffix}`;
  const restoredName = `glowflow_recovery_restored_${suffix}`;
  const source = new URL(admin);
  source.pathname = `/${sourceName}`;
  const restored = new URL(admin);
  restored.pathname = `/${restoredName}`;
  const urls = [admin, source, restored];
  const work = mkdtempSync(join(tmpdir(), 'glowflow-recovery-'));
  const archive = join(work, 'glowflow.dump');
  const created = [];

  const sql = (url, input) => run(psql, ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At', '-d', url.href], urls, { input });
  const adminSql = query => run(psql, ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-At', '-d', admin.href, '-c', query], urls);

  try {
    for (const name of [sourceName, restoredName]) {
      adminSql(`CREATE DATABASE "${name}"`);
      created.push(name);
    }

    sql(source, readFileSync(new URL('tests/supabase-platform-fixture.sql', root), 'utf8'));
    sql(source, readFileSync(new URL('supabase/schema.sql', root), 'utf8'));
    for (const migration of readdirSync(new URL('supabase/migrations/', root)).filter(name => name.endsWith('.sql')).sort()) {
      sql(source, readFileSync(new URL(`supabase/migrations/${migration}`, root), 'utf8'));
    }

    sql(source, `
      insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000001', 'recovery-owner@example.invalid');
      insert into public.tenants (id, name, slug, owner_id, primary_language, currency, time_zone, is_booking_enabled, country_code, city, postal_code)
      values ('20000000-0000-4000-8000-000000000001', 'Recovery Salon', 'recovery-salon', '10000000-0000-4000-8000-000000000001', 'en', 'USD', 'America/New_York', true, 'US', 'New York', '10001');
      insert into public.users (id, tenant_id, full_name, email, role, locale)
      values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Recovery Owner', 'recovery-owner@example.invalid', 'owner', 'en');
      insert into public.clients (id, tenant_id, full_name, email, preferred_locale)
      values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Recovery Client', 'recovery-client@example.invalid', 'en');
      insert into public.services (id, tenant_id, title_json, duration_minutes, sanitation_buffer_minutes, price, deposit_amount, category, is_active, currency)
      values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '{"fr":"Test restauration","en":"Recovery test","es":"Prueba de recuperación"}', 60, 10, 7500, 2500, 'hair', true, 'USD');
      insert into storage.buckets (id, name, public) values ('salon-public-media', 'salon-public-media', true)
      on conflict (id) do nothing;
      insert into storage.objects (id, bucket_id, name) values ('50000000-0000-4000-8000-000000000001', 'salon-public-media', '20000000-0000-4000-8000-000000000001/recovery.jpg');
    `);

    // Preserve grants because role boundaries are part of the recovered application.
    // Ownership is reassigned to the restoring administrator for portability.
    run(pgDump, ['--format=custom', '--no-owner', '--file', archive, source.href], urls, { timeout: 180_000 });
    run(pgRestore, ['--exit-on-error', '--no-owner', '--dbname', restored.href, archive], urls, { timeout: 180_000 });

    const verification = sql(restored, `
      do $$
      declare missing text;
      begin
        select string_agg(c.relname, ', ' order by c.relname) into missing
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
        if missing is not null then raise exception 'restored public tables without RLS: %', missing; end if;
        if (select count(*) from public.tenants where slug = 'recovery-salon') <> 1 then raise exception 'tenant row was not restored'; end if;
        if (select count(*) from public.users where email = 'recovery-owner@example.invalid') <> 1 then raise exception 'user row was not restored'; end if;
        if (select count(*) from public.clients where email = 'recovery-client@example.invalid') <> 1 then raise exception 'client row was not restored'; end if;
        if (select count(*) from public.services where id = '40000000-0000-4000-8000-000000000001') <> 1 then raise exception 'service row was not restored'; end if;
        if (select count(*) from storage.objects where name like '%/recovery.jpg') <> 1 then raise exception 'storage metadata was not restored'; end if;
        if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients_tenant_select') then raise exception 'critical tenant policy was not restored'; end if;
        if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'is_tenant_member') then raise exception 'authorization function was not restored'; end if;
        if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'walk_in_queue') then raise exception 'Realtime publication membership was not restored'; end if;
        if has_table_privilege('anon', 'public.clients', 'select') then raise exception 'anon recovered forbidden client access'; end if;
        if not has_column_privilege('anon', 'public.salon_public_profiles', 'business_name', 'select') then raise exception 'anon lost public profile business_name access'; end if;
        if has_column_privilege('anon', 'public.salon_public_profiles', 'created_at', 'select') then raise exception 'anon recovered private public-profile metadata access'; end if;
      end $$;
      select 'recovery verification passed';
    `);
    if (verification.replaceAll('\r', '') !== 'DO\nrecovery verification passed') {
      throw new Error(`Unexpected recovery verification output: ${verification}`);
    }
    console.log('GlowFlow logical backup and restore drill passed with synthetic data.');
  } finally {
    for (const name of created.reverse()) {
      try { adminSql(`DROP DATABASE "${name}" WITH (FORCE)`); } catch (error) { console.error(error.message); process.exitCode = 1; }
    }
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
