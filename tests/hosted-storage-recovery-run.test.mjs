import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecoveryTarget } from './hosted-storage-recovery-run.mjs';
import { parseComparisonTargets } from './hosted-recovery-compare.mjs';
import { parseRecoveredAppTarget } from './hosted-recovered-app-run.mjs';
import { parseProductionOwnerTarget } from './production-owner-verification-run.mjs';

const valid = {
  GLOWFLOW_RECOVERY_PROJECT_REF: 'recoveryprojectref01',
  GLOWFLOW_PRODUCTION_PROJECT_REF: 'productionproject1',
  GLOWFLOW_RECOVERY_SUPABASE_URL: 'https://recoveryprojectref01.supabase.co',
  GLOWFLOW_RECOVERY_SERVICE_ROLE_KEY: 'fixture-secret',
};

test('accepts an exact isolated recovery project URL', () => {
  assert.deepEqual(parseRecoveryTarget(valid), {
    recoveryRef: 'recoveryprojectref01',
    productionRef: 'productionproject1',
    url: 'https://recoveryprojectref01.supabase.co',
    serviceRoleKey: 'fixture-secret',
  });
});

test('rejects the production project as a recovery target', () => {
  assert.throws(() => parseRecoveryTarget({
    ...valid,
    GLOWFLOW_RECOVERY_PROJECT_REF: valid.GLOWFLOW_PRODUCTION_PROJECT_REF,
    GLOWFLOW_RECOVERY_SUPABASE_URL: `https://${valid.GLOWFLOW_PRODUCTION_PROJECT_REF}.supabase.co`,
  }), /different from production/);
});

test('rejects a URL whose host does not match the recovery ref', () => {
  assert.throws(() => parseRecoveryTarget({
    ...valid,
    GLOWFLOW_RECOVERY_SUPABASE_URL: 'https://productionproject1.supabase.co',
  }), /exactly match/);
});

test('rejects URL paths, query strings and insecure origins', () => {
  for (const url of [
    'https://recoveryprojectref01.supabase.co/rest/v1',
    'https://recoveryprojectref01.supabase.co?unsafe=1',
    'http://recoveryprojectref01.supabase.co',
  ]) {
    assert.throws(() => parseRecoveryTarget({ ...valid, GLOWFLOW_RECOVERY_SUPABASE_URL: url }), /exactly match/);
  }
});

test('comparison targets require an exact production URL', () => {
  const comparison = {
    ...valid,
    GLOWFLOW_PRODUCTION_SUPABASE_URL: 'https://productionproject1.supabase.co',
    GLOWFLOW_PRODUCTION_SERVICE_ROLE_KEY: 'production-secret',
    GLOWFLOW_RECOVERY_ANON_KEY: 'recovery-anon',
  };
  assert.equal(parseComparisonTargets(comparison).productionUrl, comparison.GLOWFLOW_PRODUCTION_SUPABASE_URL);
  assert.throws(() => parseComparisonTargets({
    ...comparison,
    GLOWFLOW_PRODUCTION_SUPABASE_URL: 'https://another-project.supabase.co',
  }), /exactly match/);
});

test('recovered app target requires a temporary publishable key', () => {
  assert.throws(() => parseRecoveredAppTarget(valid), /PUBLISHABLE_KEY/);
  assert.equal(parseRecoveredAppTarget({
    ...valid,
    GLOWFLOW_RECOVERY_PUBLISHABLE_KEY: 'fixture-publishable',
  }).publishableKey, 'fixture-publishable');
});

test('production owner verification requires the exact GlowFlow target and acknowledgement', () => {
  const target = {
    GLOWFLOW_PRODUCTION_PROJECT_REF: 'rfwhqutkiztxkagbhevp',
    GLOWFLOW_PRODUCTION_SUPABASE_URL: 'https://rfwhqutkiztxkagbhevp.supabase.co',
    GLOWFLOW_PRODUCTION_APP_URL: 'https://glowflow.mocktar.com',
    GLOWFLOW_PRODUCTION_SERVICE_ROLE_KEY: 'fixture-secret',
    GLOWFLOW_PRODUCTION_PUBLISHABLE_KEY: 'fixture-publishable',
    GLOWFLOW_PRODUCTION_OWNER_VERIFICATION_ACK: 'create-and-delete-disposable-owner:rfwhqutkiztxkagbhevp',
  };
  assert.equal(parseProductionOwnerTarget(target).ref, 'rfwhqutkiztxkagbhevp');
  assert.throws(() => parseProductionOwnerTarget({ ...target, GLOWFLOW_PRODUCTION_PROJECT_REF: 'udodswbyaopgbmugdopj' }), /exactly/);
  assert.throws(() => parseProductionOwnerTarget({ ...target, GLOWFLOW_PRODUCTION_OWNER_VERIFICATION_ACK: '' }), /acknowledgement/);
  assert.throws(() => parseProductionOwnerTarget({ ...target, GLOWFLOW_PRODUCTION_APP_URL: 'https://example.com' }), /exactly/);
});
