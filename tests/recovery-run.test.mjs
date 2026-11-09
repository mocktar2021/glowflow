import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseLoopbackAdminUrl, verifyStorageSnapshotEntry } from './recovery-run.mjs';

test('recovery runner only accepts an explicit loopback postgres admin database', () => {
  assert.equal(parseLoopbackAdminUrl('postgresql://postgres:secret@127.0.0.1:5432/postgres').pathname, '/postgres');
  for (const value of [
    undefined,
    'postgresql://postgres:secret@db.example.com/postgres',
    'postgresql://postgres:secret@127.0.0.1:5432/production',
    'postgresql://postgres:secret@127.0.0.1:5432/postgres?sslmode=require',
  ]) assert.throws(() => parseLoopbackAdminUrl(value));
});

test('separate Storage backup must match restored metadata, size, and checksum', () => {
  const directory = mkdtempSync(join(tmpdir(), 'glowflow-recovery-test-'));
  const file = join(directory, 'object.png');
  const bytes = Buffer.from('synthetic-storage-object');
  const metadata = { id: 'object-1', bucket_id: 'salon-public-media', name: 'tenant/recovery.png' };
  const manifest = {
    ...metadata,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  try {
    writeFileSync(file, bytes);
    assert.doesNotThrow(() => verifyStorageSnapshotEntry(manifest, metadata, file));
    assert.throws(() => verifyStorageSnapshotEntry(manifest, { ...metadata, bucket_id: 'other-bucket' }, file));
    assert.throws(() => verifyStorageSnapshotEntry(manifest, { ...metadata, id: 'other-object' }, file));
    assert.throws(() => verifyStorageSnapshotEntry(manifest, { ...metadata, name: 'tenant/other.png' }, file));
    assert.throws(() => verifyStorageSnapshotEntry({ ...manifest, size: bytes.length + 1 }, metadata, file));
    assert.throws(() => verifyStorageSnapshotEntry({ ...manifest, sha256: '0'.repeat(64) }, metadata, file));
    assert.throws(() => verifyStorageSnapshotEntry(manifest, metadata, join(directory, 'missing.png')));
    writeFileSync(file, Buffer.from('tampered-storage-object'));
    assert.throws(() => verifyStorageSnapshotEntry(manifest, metadata, file));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
