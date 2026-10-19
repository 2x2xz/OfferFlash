import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const sources = ['packages/browser/src/controller.ts', 'packages/browser/src/feishu-native.ts', 'packages/browser/src/feishu-scripts.ts',
  'packages/forms/src/career-plan.ts', 'packages/forms/src/career-runner.ts', 'apps/desktop/fixtures/career-form-profile.ts',
  'apps/desktop/fixtures/feishu-career.html', 'apps/desktop/smoke-feishu-career.ts'];
const engineSources = ['apps/desktop/feishu-site-lab-engine.ts', 'apps/desktop/feishu-lab-policy.ts', 'apps/desktop/feishu-site-lab.ts',
  'scripts/build-feishu-lab-engine.mjs', 'scripts/build-desktop.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshot = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, digest(await readFile(path))])));
const before = await snapshot(sources), engineBefore = await snapshot(engineSources);
await build({ entryPoints: ['apps/desktop/feishu-site-lab-engine.ts'], outdir: 'dist/desktop', platform: 'node', format: 'esm',
  bundle: true, packages: 'external', target: 'node22', sourcemap: true });
const sourceDigests = await snapshot(sources), engineSourceDigests = await snapshot(engineSources);
if (JSON.stringify(before) !== JSON.stringify(sourceDigests) || JSON.stringify(engineBefore) !== JSON.stringify(engineSourceDigests)) throw new Error('履历执行代码在实验室构建期间变化，请重试。');
await writeFile('dist/desktop/feishu-engine-build-digests.json', JSON.stringify({ sourceDigests, engineSourceDigests,
  engineSha256: digest(await readFile('dist/desktop/feishu-site-lab-engine.js')) }, null, 2));
