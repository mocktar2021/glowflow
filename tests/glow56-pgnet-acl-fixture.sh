#!/usr/bin/env bash
# Catalog-only pg_net/Vault ACL probe in the disposable GitHub Actions service.
# Never pass a URL, create a request, read a secret, or target hosted Supabase.
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "This ACL fixture is restricted to GitHub Actions." >&2
  exit 1
fi
: "${PGPASSWORD:?The disposable fixture password is required}"

# libpq's PGHOSTADDR overrides the network destination even with PGHOST set.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE
export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER=supabase_admin
export PGDATABASE=postgres
export PGSSLMODE=disable

psql -X -q -A -t -v ON_ERROR_STOP=1 \
  -h 127.0.0.1 -p 5432 -U supabase_admin -d postgres <<'SQL'
begin;
-- This installation affects only the disposable CI container. No request is
-- enqueued and no Cron job is created.
create extension if not exists pg_net with version '0.20.4';

do $$
declare
  net_owner oid;
  vault_owner oid;
  request_queue oid := to_regclass('net.http_request_queue');
  request_sequence oid := to_regclass('net.http_request_queue_id_seq');
  response_table oid := to_regclass('net._http_response');
  decrypted_view oid := to_regclass('vault.decrypted_secrets');
  net_schema oid := to_regnamespace('net');
  target oid;
begin
  select extowner into net_owner from pg_extension where extname = 'pg_net'
    and extversion = '0.20.4';
  select extowner into vault_owner from pg_extension
    where extname = 'supabase_vault' and extversion = '0.3.1';
  if net_owner is null or vault_owner is null or net_schema is null
      or request_queue is null or request_sequence is null
      or response_table is null or decrypted_view is null then
    raise exception 'GLOW-56 disposable pg_net/Vault catalog differs from pinned versions';
  end if;
  if (select count(*) from pg_roles
      where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'GLOW-56 disposable Supabase application roles are missing';
  end if;
  if (select relowner from pg_class where oid = request_queue) <> net_owner
      or (select relowner from pg_class where oid = request_sequence) <> net_owner
      or (select relowner from pg_class where oid = response_table) <> net_owner
      or (select relowner from pg_class where oid = decrypted_view) <> vault_owner then
    raise exception 'GLOW-56 disposable extension object ownership differs';
  end if;
  if not exists (
    select 1 from pg_namespace n, lateral aclexplode(n.nspacl) acl
    where n.oid = net_schema and acl.grantee = 0
      and acl.privilege_type = 'USAGE'
  ) then
    raise exception 'GLOW-56 pg_net PUBLIC schema grant differs';
  end if;
  foreach target in array array[request_queue, response_table] loop
    if (select count(distinct acl.privilege_type)
        from pg_class c, lateral aclexplode(c.relacl) acl
        where c.oid = target and acl.grantee = 0
          and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) <> 4 then
      raise exception 'GLOW-56 pg_net PUBLIC table grants differ';
    end if;
  end loop;
  if not exists (
    select 1 from pg_class c, lateral aclexplode(c.relacl) acl
    where c.oid = request_sequence and c.relkind = 'S'
      and acl.grantee = 0 and acl.privilege_type = 'USAGE'
  ) then
    raise exception 'GLOW-56 pg_net PUBLIC request sequence grant differs';
  end if;
  if exists (
    select 1 from pg_class c, lateral aclexplode(c.relacl) acl
    where c.oid = decrypted_view and acl.grantee = 0
      and acl.privilege_type = 'SELECT'
  ) or has_table_privilege('anon', decrypted_view, 'SELECT')
    or has_table_privilege('authenticated', decrypted_view, 'SELECT') then
    raise exception 'GLOW-56 Vault decrypted view unexpectedly grants visitor access';
  end if;
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null
      or (select prosecdef from pg_proc
          where oid = 'net.http_get(text,jsonb,jsonb,integer)'::regprocedure) then
    raise exception 'GLOW-56 pg_net HTTP function signature/security differs';
  end if;
end;
$$;

-- Prove the smallest candidate permission boundary in this disposable
-- transaction only. pg_net 0.20.4 installs PUBLIC queue/response grants, so
-- a Vault-backed ping URL would be readable until these are revoked. This
-- does not prove HTTP redirect safety, that the worker
-- can send a request, or that a hosted installation has identical grants.
revoke all on schema net from public;
revoke all on all tables in schema net from public;
revoke all on all sequences in schema net from public;
revoke all on all functions in schema net from public;
revoke all on schema net from anon, authenticated, service_role;
revoke all on all tables in schema net from anon, authenticated, service_role;
revoke all on all sequences in schema net from anon, authenticated, service_role;
revoke all on all functions in schema net from anon, authenticated, service_role;

-- The intended Cron execution role, not an application role, needs only
-- enough access to enqueue the monitor GET and inspect its response.
grant usage on schema net to postgres;
grant insert on net.http_request_queue to postgres;
grant usage on sequence net.http_request_queue_id_seq to postgres;
grant select on net._http_response to postgres;
grant execute on function net.http_get(text,jsonb,jsonb,integer) to postgres;

do $$
declare
  role_name text;
  target oid;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(role_name::name, 'net', 'USAGE')
        or has_table_privilege(role_name::name, 'net.http_request_queue', 'SELECT')
        or has_table_privilege(role_name::name, 'net.http_request_queue', 'INSERT')
        or has_table_privilege(role_name::name, 'net._http_response', 'SELECT')
        or has_sequence_privilege(role_name::name, 'net.http_request_queue_id_seq', 'USAGE')
        or has_function_privilege(role_name::name,
          'net.http_get(text,jsonb,jsonb,integer)', 'EXECUTE') then
      raise exception 'GLOW-56 disposable pg_net role % retains a monitored path', role_name;
    end if;
  end loop;
  if not has_schema_privilege('postgres', 'net', 'USAGE')
      or not has_table_privilege('postgres', 'net.http_request_queue', 'INSERT')
      or not has_sequence_privilege('postgres', 'net.http_request_queue_id_seq', 'USAGE')
      or not has_table_privilege('postgres', 'net._http_response', 'SELECT')
      or not has_function_privilege('postgres',
        'net.http_get(text,jsonb,jsonb,integer)', 'EXECUTE') then
    raise exception 'GLOW-56 disposable Cron execution role lacks the candidate minimum grants';
  end if;
  -- Check *all* tables and views in net, not just the two known tables. A
  -- future extension object with an application grant must fail this fixture.
  for target in select c.oid from pg_class c
    where c.relnamespace = 'net'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm') loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(role_name::name, target, 'SELECT')
          or has_table_privilege(role_name::name, target, 'INSERT') then
        raise exception 'GLOW-56 disposable pg_net relation % grants role % access', target, role_name;
      end if;
    end loop;
  end loop;
  for target in select c.oid from pg_class c
    where c.relnamespace = 'net'::regnamespace and c.relkind = 'S' loop
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if has_sequence_privilege(role_name::name, target, 'USAGE')
          or has_sequence_privilege(role_name::name, target, 'SELECT') then
        raise exception 'GLOW-56 disposable pg_net sequence % grants role % access', target, role_name;
      end if;
    end loop;
  end loop;
end;
$$;

-- Catalog metadata only: never SELECT from the queue or decrypted view.
select 'pg_net_owner=' || pg_get_userbyid(extowner)
  from pg_extension where extname = 'pg_net';
select 'vault_owner=' || pg_get_userbyid(extowner)
  from pg_extension where extname = 'supabase_vault';
select 'pg_net_worker_username=' ||
  coalesce(nullif(current_setting('pg_net.username', true), ''), '<unset>');
select 'pg_net_worker_database=' ||
  coalesce(nullif(current_setting('pg_net.database_name', true), ''), '<unset>');
select 'vault_decrypted_view_public_select=' ||
  (exists (
    select 1 from pg_class c, lateral aclexplode(c.relacl) acl
    where c.oid = 'vault.decrypted_secrets'::regclass and acl.grantee = 0
      and acl.privilege_type = 'SELECT'
  ))::text;
select 'vault_decrypted_view_anon_select=' ||
  has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT')::text;
select 'vault_decrypted_view_authenticated_select=' ||
  has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT')::text;
select 'vault_decrypted_view_service_role_select=' ||
  has_table_privilege('service_role', 'vault.decrypted_secrets', 'SELECT')::text;
select 'pg_net_anon_http_get_execute_after_revoke=' ||
  has_function_privilege(
    'anon', 'net.http_get(text,jsonb,jsonb,integer)', 'EXECUTE')::text;
-- Leave even the disposable service's extension and ACLs unchanged.
rollback;
SQL
