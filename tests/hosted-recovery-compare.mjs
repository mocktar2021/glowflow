import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { parseRecoveryTarget } from './hosted-storage-recovery-run.mjs';

const tables = [
  'appointments',
  'clients',
  'invoices',
  'markets',
  'salon_public_profiles',
  'service_staff',
  'services',
  'staff_schedule_exceptions',
  'staff_working_hours',
  'station_working_hours',
  'stripe_sandbox_connections',
  'stripe_sandbox_events',
  'stripe_sandbox_reservations',
  'tenants',
  'users',
  'walk_in_queue',
];

export function parseComparisonTargets(env) {
  const recovery = parseRecoveryTarget(env);
  if (env.GLOWFLOW_RECOVERY_COMPARISON_SCOPE !== 'current-state-clone-only') {
    throw new Error('Set GLOWFLOW_RECOVERY_COMPARISON_SCOPE=current-state-clone-only; this comparison cannot validate a historical restore.');
  }
  if (!env.GLOWFLOW_PRODUCTION_SUPABASE_URL || !env.GLOWFLOW_PRODUCTION_SERVICE_ROLE_KEY || !env.GLOWFLOW_RECOVERY_ANON_KEY) {
    throw new Error('Production read credentials and the recovery anonymous key are required.');
  }
  const productionUrl = new URL(env.GLOWFLOW_PRODUCTION_SUPABASE_URL);
  if (productionUrl.protocol !== 'https:'
      || productionUrl.hostname !== `${recovery.productionRef}.supabase.co`
      || productionUrl.pathname !== '/'
      || productionUrl.search
      || productionUrl.hash) {
    throw new Error('The production URL must exactly match the production project ref.');
  }
  return {
    ...recovery,
    productionUrl: productionUrl.origin,
    productionServiceRoleKey: env.GLOWFLOW_PRODUCTION_SERVICE_ROLE_KEY,
    recoveryAnonKey: env.GLOWFLOW_RECOVERY_ANON_KEY,
  };
}

function client(url, key) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function tableCount(supabase, table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count;
}

export async function countAuthUsers(supabase, perPage = 1000) {
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 1000) throw new Error('Invalid Auth page size.');
  let count = 0;
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    if (!Array.isArray(data?.users)) throw new Error('Auth user list response is incomplete.');
    count += data.users.length;
    if (data.users.length < perPage) return count;
  }
  throw new Error('Auth user pagination exceeded the safety limit.');
}

export function bucketDefinitions(buckets) {
  if (!Array.isArray(buckets)) throw new Error('Storage bucket list response is incomplete.');
  return buckets.map(bucket => {
    if (typeof bucket?.id !== 'string' || typeof bucket.name !== 'string' || typeof bucket.public !== 'boolean') {
      throw new Error('Storage bucket definition is incomplete.');
    }
    if (bucket.allowed_mime_types != null && !Array.isArray(bucket.allowed_mime_types)) {
      throw new Error('Storage bucket MIME types are invalid.');
    }
    return {
      id: bucket.id,
      name: bucket.name,
      public: bucket.public,
      file_size_limit: bucket.file_size_limit ?? null,
      allowed_mime_types: bucket.allowed_mime_types?.slice().sort() ?? null,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

async function main() {
  const target = parseComparisonTargets(process.env);
  const production = client(target.productionUrl, target.productionServiceRoleKey);
  const recovery = client(target.url, target.serviceRoleKey);
  const anonymousRecovery = client(target.url, target.recoveryAnonKey);

  const comparisons = await Promise.all(tables.map(async table => {
    const [source, restored] = await Promise.all([tableCount(production, table), tableCount(recovery, table)]);
    return { table, source, restored };
  }));
  const mismatches = comparisons.filter(item => item.source !== item.restored);
  assert.deepEqual(mismatches, [], `Restored table counts differ: ${mismatches.map(item => item.table).join(', ')}`);

  const [sourceUserCount, restoredUserCount, sourceBuckets, restoredBuckets] = await Promise.all([
    countAuthUsers(production),
    countAuthUsers(recovery),
    production.storage.listBuckets(),
    recovery.storage.listBuckets(),
  ]);
  for (const result of [sourceBuckets, restoredBuckets]) {
    if (result.error) throw result.error;
  }
  assert.equal(restoredUserCount, sourceUserCount, 'Restored Auth user count differs from production.');
  assert.deepEqual(
    bucketDefinitions(restoredBuckets.data),
    bucketDefinitions(sourceBuckets.data),
    'Restored Storage bucket definitions differ from production.',
  );

  const clientProbe = await anonymousRecovery.from('clients').select('id', { count: 'exact', head: true });
  assert.ok(clientProbe.error || clientProbe.count === 0, 'Anonymous users can see restored client rows.');

  const connectionProbe = await anonymousRecovery.from('stripe_sandbox_connections').select('tenant_id', { count: 'exact', head: true });
  assert.ok(connectionProbe.error || connectionProbe.count === 0, 'Anonymous users can see restored payment connection rows.');

  const privateProfileProbe = await anonymousRecovery.from('salon_public_profiles').select('created_at').limit(1);
  assert.ok(privateProfileProbe.error, 'Anonymous users unexpectedly retained access to private profile metadata.');

  console.log(JSON.stringify({
    result: 'passed',
    source_ref: target.productionRef,
    recovery_ref: target.recoveryRef,
    matched_tables: comparisons.length,
    restored_rows: comparisons.reduce((sum, item) => sum + (item.restored || 0), 0),
    auth_user_count_match: true,
    storage_bucket_definitions_match: true,
    anonymous_clients: clientProbe.error ? 'denied' : `visible_rows_${clientProbe.count}`,
    anonymous_payment_connections: connectionProbe.error ? 'denied' : `visible_rows_${connectionProbe.count}`,
    private_profile_metadata_denied: true,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Hosted database recovery comparison failed: ${error?.message || 'unknown error'}`);
    process.exitCode = 1;
  });
}
