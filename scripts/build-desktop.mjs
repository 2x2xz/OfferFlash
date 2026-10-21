import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const careerSources = ['packages/browser/src/controller.ts', 'packages/browser/src/feishu-native.ts', 'packages/browser/src/feishu-scripts.ts',
  'packages/forms/src/career-plan.ts', 'packages/forms/src/career-runner.ts', 'apps/desktop/fixtures/career-form-profile.ts',
  'apps/desktop/fixtures/feishu-career.html', 'apps/desktop/smoke-feishu-career.ts'];
const engineSources = ['apps/desktop/feishu-site-lab-engine.ts', 'apps/desktop/feishu-lab-policy.ts', 'apps/desktop/feishu-site-lab.ts',
  'scripts/build-feishu-lab-engine.mjs', 'scripts/build-desktop.mjs'];
const digestSources = async (paths = careerSources) => Object.fromEntries(await Promise.all(paths.map(async path =>
  [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const sourcesBefore = await digestSources();
const engineBefore = await digestSources(engineSources);

await mkdir('dist/desktop', { recursive: true });
await build({
  entryPoints: ['apps/desktop/backend.ts', 'apps/desktop/agent-worker.ts', 'apps/desktop/site-diagnostic.ts', 'apps/desktop/feishu-site-lab.ts', 'apps/desktop/feishu-site-lab-engine.ts'],
  outdir: 'dist/desktop', platform: 'node', format: 'esm', bundle: true,
  packages: 'external', target: 'node22', sourcemap: true,
});
await build({entryPoints:['packages/agent/src/universal-form-agent.ts'],outfile:'dist/desktop/universal-form-agent.js',platform:'node',format:'esm',bundle:true,packages:'external',target:'node22',sourcemap:true});
await viteBuild({ configFile: 'apps/desktop/vite.config.ts' });
const sourceDigests = await digestSources();
const engineSourceDigests = await digestSources(engineSources);
if (JSON.stringify(sourceDigests) !== JSON.stringify(sourcesBefore) || JSON.stringify(engineSourceDigests) !== JSON.stringify(engineBefore)) throw new Error('履历源码在构建期间变化，请重新构建。');
await writeFile('dist/desktop/career-build-digests.json', JSON.stringify({ sourceDigests,
  backendSha256: createHash('sha256').update(await readFile('dist/desktop/backend.js')).digest('hex') }, null, 2));
await writeFile('dist/desktop/feishu-engine-build-digests.json', JSON.stringify({ sourceDigests, engineSourceDigests,
  engineSha256: createHash('sha256').update(await readFile('dist/desktop/feishu-site-lab-engine.js')).digest('hex') }, null, 2));
