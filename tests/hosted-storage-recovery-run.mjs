import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const bucket = 'salon-public-media';

export function parseRecoveryTarget(env) {
  const required = [
    'GLOWFLOW_RECOVERY_PROJECT_REF',
    'GLOWFLOW_PRODUCTION_PROJECT_REF',
    'GLOWFLOW_RECOVERY_SUPABASE_URL',
    'GLOWFLOW_RECOVERY_SERVICE_ROLE_KEY',
  ];
  for (const name of required) {
    if (!env[name]) throw new Error(`${name} is required.`);
  }

  const recoveryRef = env.GLOWFLOW_RECOVERY_PROJECT_REF;
  const productionRef = env.GLOWFLOW_PRODUCTION_PROJECT_REF;
  if (recoveryRef === productionRef) {
    throw new Error('The recovery project must be different from production.');
  }

  let url;
  try {
    url = new URL(env.GLOWFLOW_RECOVERY_SUPABASE_URL);
  } catch {
    throw new Error('GLOWFLOW_RECOVERY_SUPABASE_URL must be a valid URL.');
  }
  if (url.protocol !== 'https:' || url.hostname !== `${recoveryRef}.supabase.co` || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The recovery URL must exactly match the temporary Supabase project ref.');
  }

  return { recoveryRef, productionRef, url: url.origin, serviceRoleKey: env.GLOWFLOW_RECOVERY_SERVICE_ROLE_KEY };
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const target = parseRecoveryTarget(process.env);
  const client = createClient(target.url, target.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const path = `recovery-drill/${randomUUID()}.png`;
  const pngHeader = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const payload = Buffer.concat([pngHeader, randomBytes(4096)]);
  let present = false;

  try {
    const { data: buckets, error: bucketError } = await client.storage.listBuckets();
    if (bucketError) throw bucketError;
    assert.ok(buckets.some(item => item.id === bucket), `Required bucket ${bucket} was not restored.`);

    const upload = await client.storage.from(bucket).upload(path, payload, {
      contentType: 'image/png',
      upsert: false,
    });
    if (upload.error) throw upload.error;
    present = true;

    const backup = await client.storage.from(bucket).download(path);
    if (backup.error) throw backup.error;
    const backedUpBytes = Buffer.from(await backup.data.arrayBuffer());
    assert.equal(digest(backedUpBytes), digest(payload), 'The downloaded backup differs from the uploaded object.');

    const removed = await client.storage.from(bucket).remove([path]);
    if (removed.error) throw removed.error;
    present = false;

    const filename = path.split('/').at(-1);
    const missing = await client.storage.from(bucket).list('recovery-drill', { search: filename });
    if (missing.error) throw missing.error;
    assert.ok(!missing.data.some(item => item.name === filename), 'The drill object metadata remained after deletion.');

    const restored = await client.storage.from(bucket).upload(path, backedUpBytes, {
      contentType: 'image/png',
      cacheControl: '0',
      upsert: false,
    });
    if (restored.error) throw restored.error;
    present = true;

    const restoredListing = await client.storage.from(bucket).list('recovery-drill', { search: filename });
    if (restoredListing.error) throw restoredListing.error;
    assert.ok(restoredListing.data.some(item => item.name === filename), 'The restored object metadata is missing.');

    const verification = await client.storage.from(bucket).download(path);
    if (verification.error) throw verification.error;
    const restoredBytes = Buffer.from(await verification.data.arrayBuffer());
    assert.equal(digest(restoredBytes), digest(payload), 'The restored object checksum differs from the source checksum.');

    console.log(JSON.stringify({
      result: 'passed',
      project_ref: target.recoveryRef,
      bucket,
      bytes: payload.byteLength,
      sha256: digest(payload),
    }));
  } finally {
    if (present) {
      const cleanup = await client.storage.from(bucket).remove([path]);
      if (cleanup.error) throw cleanup.error;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Hosted Storage recovery drill failed: ${error?.message || 'unknown error'}`);
    process.exitCode = 1;
  });
}
