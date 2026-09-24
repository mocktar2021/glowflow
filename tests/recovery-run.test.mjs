import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLoopbackAdminUrl } from './recovery-run.mjs';

test('recovery runner only accepts an explicit loopback postgres admin database', () => {
  assert.equal(parseLoopbackAdminUrl('postgresql://postgres:secret@127.0.0.1:5432/postgres').pathname, '/postgres');
  for (const value of [
    undefined,
    'postgresql://postgres:secret@db.example.com/postgres',
    'postgresql://postgres:secret@127.0.0.1:5432/production',
    'postgresql://postgres:secret@127.0.0.1:5432/postgres?sslmode=require',
  ]) assert.throws(() => parseLoopbackAdminUrl(value));
});
