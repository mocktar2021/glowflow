import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function run(url) {
  return spawnSync(process.execPath, ['tests/rls-run.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, GLOWFLOW_RLS_ADMIN_DATABASE_URL: url, PSQL_BIN: 'glowflow-intentionally-missing-psql' },
    encoding: 'utf8', timeout: 15_000,
  });
}

test('security runner fails closed for missing or non-local database configuration', () => {
  for (const url of ['', 'postgresql://postgres@db.example.invalid/postgres', 'postgresql://postgres@localhost/existing', 'postgresql://postgres@localhost/postgres?host=remote']) {
    const result = run(url);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is required|localhost PostgreSQL admin URL/);
  }
});

test('security runner redacts setup command credentials when the local client is unavailable', () => {
  const result = run('postgresql://postgres:do-not-print-fixture-password@127.0.0.1/postgres');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Local PostgreSQL setup or cleanup failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /do-not-print-fixture-password|postgresql:\/\//);
});

test('SQL test failures do not print the database connection password', () => {
  const result = spawnSync(process.execPath, ['--test', 'tests/sandbox-database.test.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, GLOWFLOW_SANDBOX_TEST_DATABASE_URL: 'postgresql://postgres:do-not-print-fixture-password@127.0.0.1/glowflow_sandbox_test_123', PSQL_BIN: 'glowflow-intentionally-missing-psql' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Local PostgreSQL command failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /do-not-print-fixture-password|postgresql:\/\//);
});
