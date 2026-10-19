import {build} from 'esbuild';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const paths=['apps/desktop/benchmark.ts','apps/desktop/benchmark-native.ts','apps/desktop/benchmark-career.ts','apps/desktop/benchmark-career-main.cjs','apps/desktop/fixtures/feishu-career.html','apps/desktop/benchmark-main.cjs','scripts/build-benchmark.mjs','package-lock.json'];
async function walk(directory){for(const e of await readdir(directory,{withFileTypes:true})){const path=join(directory,e.name);if(e.isSymbolicLink())throw new Error('Benchmark source symlink');if(e.isDirectory())await walk(path);else if(/\.[cm]?[jt]sx?$/.test(e.name))paths.push(path);}}
await walk('packages');paths.sort();
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,digest(await readFile(p))])));
const before=await hashes();await mkdir('dist/desktop',{recursive:true});
await build({entryPoints:['apps/desktop/benchmark.ts','apps/desktop/benchmark-career.ts'],outdir:'dist/desktop',platform:'node',format:'esm',bundle:true,packages:'external',target:'node22',sourcemap:false});
if(JSON.stringify(before)!==JSON.stringify(await hashes()))throw new Error('Benchmark source changed during build');
await writeFile('dist/desktop/benchmark-build.json',JSON.stringify({schemaVersion:1,bundleSha256:digest(await readFile('dist/desktop/benchmark.js')),sourceHashes:before},null,2)+'\n');
