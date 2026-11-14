import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyHistoricalRestoreEvidence } from '../ops/historical-restore-evidence.mjs';

const tables = [
  'appointments', 'clients', 'invoices', 'markets', 'salon_public_profiles',
  'service_staff', 'services', 'staff_schedule_exceptions', 'staff_working_hours',
  'station_working_hours', 'stripe_sandbox_connections', 'stripe_sandbox_events',
  'stripe_sandbox_reservations', 'tenants', 'users', 'walk_in_queue',
];

function fixtures() {
  const snapshot = {
    tableCounts: Object.fromEntries(tables.map(table => [table, 1])),
    authUserCount: 1,
    buckets: [{ id: 'salon-public-media', public: true, fileSizeLimit: null, allowedMimeTypes: ['image/png', 'image/jpeg'] }],
    storageObjects: [{
      id: '50000000-0000-4000-8000-000000000001',
      bucketId: 'salon-public-media',
      name: 'tenant/recovery.png',
      size: 23,
      sha256: 'a'.repeat(64),
    }],
  };
  return {
    expected: {
      sourceProjectRef: 'rfwhqutkiztxkagbhevp',
      recoveryPoint: '2026-11-01T12:00:00Z',
      snapshot: structuredClone(snapshot),
    },
    observed: {
      sourceProjectRef: 'rfwhqutkiztxkagbhevp',
      recoveryProjectRef: 'abcdefghijklmnopqrst',
      recoveryPoint: '2026-11-01T12:00:00Z',
      observedAt: '2026-11-02T12:00:00Z',
      snapshot: structuredClone(snapshot),
    },
  };
}

test('isolated historical-point aggregate and complete file manifest match', () => {
  const { expected, observed } = fixtures();
  observed.snapshot.tableCounts = Object.fromEntries(Object.entries(observed.snapshot.tableCounts).reverse());
  observed.snapshot.buckets[0].allowedMimeTypes.reverse();
  assert.deepEqual(verifyHistoricalRestoreEvidence(expected, observed), {
    result: 'matched', checkedTables: 16, checkedBuckets: 1, checkedStorageObjects: 1,
  });
});

test('historical evidence rejects identity or recovery-point drift', () => {
  for (const mutate of [
    x => { x.expected.sourceProjectRef = 'abcdefghijklmnopqrst'; x.observed.sourceProjectRef = 'abcdefghijklmnopqrst'; },
    x => { x.observed.recoveryProjectRef = x.expected.sourceProjectRef; },
    x => { x.observed.sourceProjectRef = 'abcdefghijklmnopqrst'; },
    x => { x.observed.recoveryPoint = '2026-11-02T12:00:00Z'; },
    x => { x.observed.observedAt = '2026-10-31T12:00:00Z'; },
    x => { x.expected.recoveryPoint = '2026-02-30T12:00:00Z'; },
  ]) {
    const pair = fixtures();
    mutate(pair);
    assert.throws(() => verifyHistoricalRestoreEvidence(pair.expected, pair.observed));
  }
});

test('historical evidence requires complete and equal aggregate counts', () => {
  for (const mutate of [
    x => { delete x.expected.snapshot.tableCounts.clients; },
    x => { x.observed.snapshot.tableCounts.clients = 2; },
    x => { x.observed.snapshot.tableCounts.new_table = 1; },
    x => { x.observed.snapshot.authUserCount = 2; },
    x => { x.observed.snapshot.tableCounts.clients = -1; },
  ]) {
    const pair = fixtures();
    mutate(pair);
    assert.throws(() => verifyHistoricalRestoreEvidence(pair.expected, pair.observed));
  }
});

test('historical evidence requires complete, unique Storage identity and checksums', () => {
  for (const mutate of [
    x => { x.observed.snapshot.storageObjects = []; },
    x => { x.observed.snapshot.storageObjects[0].sha256 = 'b'.repeat(64); },
    x => { x.observed.snapshot.storageObjects[0].size = 24; },
    x => { x.observed.snapshot.storageObjects.push(structuredClone(x.observed.snapshot.storageObjects[0])); },
    x => { x.observed.snapshot.buckets[0].public = false; },
    x => { x.observed.snapshot.buckets.push(structuredClone(x.observed.snapshot.buckets[0])); },
    x => { x.observed.snapshot.storageObjects[0].clientEmail = 'private@example.invalid'; },
  ]) {
    const pair = fixtures();
    mutate(pair);
    assert.throws(() => verifyHistoricalRestoreEvidence(pair.expected, pair.observed));
  }
});
