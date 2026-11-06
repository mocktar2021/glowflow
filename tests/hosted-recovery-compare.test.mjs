import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketDefinitions, countAuthUsers } from './hosted-recovery-compare.mjs';

test('counts all Auth pages, including an exact page-size boundary', async () => {
  const pages = [
    [{ id: 'one' }, { id: 'two' }],
    [{ id: 'three' }, { id: 'four' }],
    [],
  ];
  const requested = [];
  const supabase = { auth: { admin: { listUsers: async ({ page, perPage }) => {
    requested.push([page, perPage]);
    return { data: { users: pages[page - 1] }, error: null };
  } } } };
  assert.equal(await countAuthUsers(supabase, 2), 4);
  assert.deepEqual(requested, [[1, 2], [2, 2], [3, 2]]);
});

test('fails closed on Auth errors and incomplete responses', async () => {
  await assert.rejects(countAuthUsers({ auth: { admin: { listUsers: async () => ({ error: new Error('Auth unavailable') }) } } }, 2), /Auth unavailable/);
  await assert.rejects(countAuthUsers({ auth: { admin: { listUsers: async () => ({ data: {}, error: null }) } } }, 2), /incomplete/);
});

test('compares stable Storage bucket settings, not only IDs', () => {
  const source = [
    { id: 'salon', name: 'salon', public: false, file_size_limit: 1024, allowed_mime_types: ['image/png', 'image/jpeg'] },
  ];
  const recovered = [
    { id: 'salon', name: 'salon', public: true, file_size_limit: 1024, allowed_mime_types: ['image/jpeg', 'image/png'] },
  ];
  assert.notDeepEqual(bucketDefinitions(source), bucketDefinitions(recovered));
  recovered[0].public = false;
  assert.deepEqual(bucketDefinitions(source), bucketDefinitions(recovered));
  assert.throws(() => bucketDefinitions(null), /incomplete/);
  assert.throws(() => bucketDefinitions([{ id: 'salon', name: 'salon' }]), /incomplete/);
});
