import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The release CLI is intentionally a standalone Node ESM file.
import { inspectPublicFiles } from '../scripts/check-public-package.mjs';
test('public release check rejects runtime records and credentials without returning the secret', () => {
  const secret = 'sk-' + 'a'.repeat(30);
  const result = inspectPublicFiles([{ path: 'source.ts', bytes: Buffer.from(secret) }, { path: '.backups/person/offeragent.sqlite', bytes: Buffer.from('private') }]);
  assert.equal(result.some((item: { code: string }) => item.code === 'POSSIBLE_CREDENTIAL'), true);
  assert.equal(result.some((item: { code: string }) => item.code === 'PRIVATE_RUNTIME_FILE'), true);
  assert.equal(JSON.stringify(result).includes(secret), false);
});
test('public release check permits reviewed fixture locations and rejects stray personal documents', () => {
  assert.deepEqual(inspectPublicFiles([{ path: 'apps/desktop/fixtures/resume.pdf', bytes: Buffer.from('fiction') }, { path: '.env.example', bytes: Buffer.from('KEY=') }]), []);
  assert.equal(inspectPublicFiles([{ path: 'my-resume.pdf', bytes: Buffer.from('private') }])[0].code, 'UNREVIEWED_BINARY');
});
