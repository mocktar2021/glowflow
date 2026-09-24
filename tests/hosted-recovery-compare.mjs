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

  const [sourceUsers, restoredUsers, sourceBuckets, restoredBuckets] = await Promise.all([
    production.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    recovery.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    production.storage.listBuckets(),
    recovery.storage.listBuckets(),
  ]);
  for (const result of [sourceUsers, restoredUsers, sourceBuckets, restoredBuckets]) {
    if (result.error) throw result.error;
  }
  assert.equal(restoredUsers.data.users.length, sourceUsers.data.users.length, 'Restored Auth user count differs from production.');
  assert.deepEqual(
    restoredBuckets.data.map(item => item.id).sort(),
    sourceBuckets.data.map(item => item.id).sort(),
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
