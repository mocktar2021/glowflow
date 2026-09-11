import { execFileSync, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';

// Deliberately requires an explicit loopback admin database, never a Supabase URL.
const supplied = process.env.GLOWFLOW_RLS_ADMIN_DATABASE_URL;
if (!supplied) throw new Error('GLOWFLOW_RLS_ADMIN_DATABASE_URL is required; database tests must not skip.');
let admin;
try { admin = new URL(supplied); } catch { throw new Error('A valid localhost PostgreSQL admin URL is required.'); }
if (!['postgres:', 'postgresql:'].includes(admin.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(admin.hostname)
    || admin.pathname !== '/postgres' || admin.search || admin.hash) {
  throw new Error('Use a localhost PostgreSQL admin URL ending in /postgres with no query or fragment.');
}
const psql = process.env.PSQL_BIN || 'psql';
const database = `glowflow_sandbox_test_${Date.now()}_${randomInt(1_000_000)}`;
const testUrl = new URL(admin);
testUrl.pathname = `/${database}`;
let created = false;
let exitCode = 1;
function command(query) {
  try {
    execFileSync(psql, ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-d', admin.href, '-c', query], {
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    });
  } catch {
    throw new Error('Local PostgreSQL setup or cleanup failed; check the local server and client configuration.');
  }
}
try {
  command(`CREATE DATABASE "${database}"`);
  created = true;
  const result = spawnSync(process.execPath, ['--test', 'tests/sandbox-database.test.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, GLOWFLOW_SANDBOX_TEST_DATABASE_URL: testUrl.href },
    stdio: 'inherit', timeout: 180_000,
  });
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
} finally {
  if (created) {
    // This name is generated here and never accepted as an input. FORCE also cleans
    // connections left behind if a test subprocess times out.
    command(`DROP DATABASE "${database}" WITH (FORCE)`);
  }
}
process.exitCode = exitCode;
