import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This checks evidence produced by a separately authorized historical drill.
// It does not collect snapshots, connect to Supabase, or prove their provenance.
const requiredTables = [
  'appointments', 'clients', 'invoices', 'markets', 'salon_public_profiles',
  'service_staff', 'services', 'staff_schedule_exceptions', 'staff_working_hours',
  'station_working_hours', 'stripe_sandbox_connections', 'stripe_sandbox_events',
  'stripe_sandbox_reservations', 'tenants', 'users', 'walk_in_queue',
];

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('|') !== keys.slice().sort().join('|')) {
    throw new Error(`${label} has missing or unexpected fields.`);
  }
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a UTC ISO timestamp.`);
  }
  const parsed = Date.parse(value);
  const canonical = new Date(parsed).toISOString();
  if (value !== canonical && value !== canonical.replace('.000Z', 'Z')) {
    throw new Error(`${label} must be a real UTC ISO timestamp.`);
  }
  return parsed;
}

function ref(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9]{20}$/.test(value)) {
    throw new Error(`${label} must be an exact Supabase project ref.`);
  }
}

function snapshot(value, label) {
  exactKeys(value, ['tableCounts', 'authUserCount', 'buckets', 'storageObjects'], label);
  if (!value.tableCounts || typeof value.tableCounts !== 'object' || Array.isArray(value.tableCounts)) {
    throw new Error(`${label} must include table counts.`);
  }
  for (const table of requiredTables) {
    if (!Object.hasOwn(value.tableCounts, table)) throw new Error(`${label} lacks required table ${table}.`);
  }
  for (const [table, count] of Object.entries(value.tableCounts)) {
    if (!/^[a-z][a-z0-9_]*$/.test(table) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`${label} has an invalid table count.`);
    }
  }
  if (!Number.isSafeInteger(value.authUserCount) || value.authUserCount < 0) {
    throw new Error(`${label} has an invalid Auth user count.`);
  }
  if (!Array.isArray(value.buckets) || !Array.isArray(value.storageObjects)) {
    throw new Error(`${label} must include bucket and Storage-object arrays.`);
  }
  const bucketIds = new Set();
  for (const bucket of value.buckets) {
    exactKeys(bucket, ['id', 'public', 'fileSizeLimit', 'allowedMimeTypes'], `${label} bucket`);
    if (typeof bucket.id !== 'string' || !bucket.id || typeof bucket.public !== 'boolean'
        || (bucket.fileSizeLimit !== null && (!Number.isSafeInteger(bucket.fileSizeLimit) || bucket.fileSizeLimit < 0))
        || (bucket.allowedMimeTypes !== null && (!Array.isArray(bucket.allowedMimeTypes)
          || bucket.allowedMimeTypes.some(type => typeof type !== 'string' || !type)))) {
      throw new Error(`${label} has an invalid bucket definition.`);
    }
    if (bucketIds.has(bucket.id)) throw new Error(`${label} has duplicate bucket IDs.`);
    bucketIds.add(bucket.id);
  }
  const objectIds = new Set();
  const objectNames = new Set();
  for (const object of value.storageObjects) {
    exactKeys(object, ['id', 'bucketId', 'name', 'size', 'sha256'], `${label} Storage object`);
    if (typeof object.id !== 'string' || !object.id || !bucketIds.has(object.bucketId)
        || typeof object.name !== 'string' || !object.name
        || !Number.isSafeInteger(object.size) || object.size < 0
        || typeof object.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(object.sha256)) {
      throw new Error(`${label} has an invalid Storage object.`);
    }
    const objectName = `${object.bucketId}/${object.name}`;
    if (objectIds.has(object.id) || objectNames.has(objectName)) {
      throw new Error(`${label} has duplicate Storage objects.`);
    }
    objectIds.add(object.id);
    objectNames.add(objectName);
  }
}

function equalByKey(source, restored, key, label) {
  const sorted = items => items.map(item => key === 'id' && Object.hasOwn(item, 'public')
    ? {
      id: item.id,
      public: item.public,
      fileSizeLimit: item.fileSizeLimit,
      allowedMimeTypes: item.allowedMimeTypes === null ? null : [...item.allowedMimeTypes].sort(),
    }
    : {
      id: item.id,
      bucketId: item.bucketId,
      name: item.name,
      size: item.size,
      sha256: item.sha256,
    }).sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  if (JSON.stringify(sorted(source)) !== JSON.stringify(sorted(restored))) {
    throw new Error(`${label} differs from the selected historical manifest.`);
  }
}

export function verifyHistoricalRestoreEvidence(expected, observed) {
  exactKeys(expected, ['sourceProjectRef', 'recoveryPoint', 'snapshot'], 'Historical source manifest');
  exactKeys(observed, ['sourceProjectRef', 'recoveryProjectRef', 'recoveryPoint', 'observedAt', 'snapshot'], 'Isolated restore manifest');
  ref(expected.sourceProjectRef, 'Source project');
  ref(observed.sourceProjectRef, 'Observed source project');
  ref(observed.recoveryProjectRef, 'Recovery project');
  if (expected.sourceProjectRef !== observed.sourceProjectRef
      || expected.sourceProjectRef === observed.recoveryProjectRef) {
    throw new Error('Source and isolated recovery project identity mismatch.');
  }
  const point = timestamp(expected.recoveryPoint, 'Recovery point');
  if (observed.recoveryPoint !== expected.recoveryPoint
      || timestamp(observed.observedAt, 'Restore observation') < point) {
    throw new Error('Restore observation does not match the selected recovery point.');
  }
  snapshot(expected.snapshot, 'Historical source snapshot');
  snapshot(observed.snapshot, 'Isolated restore snapshot');
  // Compare by value, independent of JSON object insertion order.
  const entries = value => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  if (JSON.stringify(entries(expected.snapshot.tableCounts)) !== JSON.stringify(entries(observed.snapshot.tableCounts))) {
    throw new Error('Restored table counts differ from the selected historical manifest.');
  }
  if (expected.snapshot.authUserCount !== observed.snapshot.authUserCount) {
    throw new Error('Restored Auth user count differs from the selected historical manifest.');
  }
  equalByKey(expected.snapshot.buckets, observed.snapshot.buckets, 'id', 'Storage bucket definitions');
  equalByKey(expected.snapshot.storageObjects, observed.snapshot.storageObjects, 'id', 'Storage object checksums or identities');
  return {
    result: 'matched',
    checkedTables: Object.keys(expected.snapshot.tableCounts).length,
    checkedBuckets: expected.snapshot.buckets.length,
    checkedStorageObjects: expected.snapshot.storageObjects.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Provide historical-source and isolated-restore JSON manifests.');
    const expected = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const observed = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    console.log(JSON.stringify(verifyHistoricalRestoreEvidence(expected, observed)));
  } catch {
    console.error('Historical restore evidence did not match; inspect manifests privately.');
    process.exitCode = 1;
  }
}
