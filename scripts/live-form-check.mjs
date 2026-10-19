import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import electron from 'electron';

// Dedicated live validation only: no local fixtures, user database or saved keys.
const args = process.argv.slice(2);
if (!args.some(value => value.startsWith('--url=https://'))) {
  throw new Error('Provide an explicit real HTTPS application URL with --url=https://...');
}
await mkdir('dist/desktop', { recursive: true });
await build({ entryPoints: ['apps/desktop/live-form-runner.ts'], outfile: 'dist/desktop/live-form-runner.js',
  platform: 'node', format: 'esm', bundle: true, packages: 'external', target: 'node22', sourcemap: true });
const child = spawn(electron, ['apps/desktop/live-form-main.cjs', ...args], { stdio: 'inherit', env: process.env });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
