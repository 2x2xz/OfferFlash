import {build} from 'esbuild';import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {spawn,execFileSync} from 'node:child_process';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
const root=resolve('.'),output=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??'.backups/real-form-recording-20261019/session-2');
if(!output.startsWith(join(root,'.backups')+'/'))throw new Error('Isolated output required');await mkdir(output,{recursive:true,mode:0o700});
// Freeze committed production modules so another task's working-tree repair cannot change a live recording halfway through.
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),frozen=join(output,'frozen-source');await mkdir(frozen,{recursive:true});
const archive=join(output,'source.tar');await writeFile(archive,execFileSync('git',['archive',commit,'apps/desktop','packages'],{maxBuffer:32_000_000}));execFileSync('tar',['-xf',archive,'-C',frozen]);
const own=['apps/desktop/real-form-record.ts','apps/desktop/real-form-record-audit.ts','apps/desktop/real-form-record.html','apps/desktop/real-form-record-preload.cjs'];const digests={};
for(const path of own){await copyFile(join(root,path),join(frozen,path));digests[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');}
await writeFile(join(output,'source-snapshot.json'),JSON.stringify({productionCommit:commit,ownRecorderDigests:digests,includesUncommittedProductionRepairs:false},null,2));
await build({entryPoints:[join(frozen,'apps/desktop/real-form-record.ts')],outfile:join(output,'real-form-record.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',target:'node22'});
await writeFile(join(output,'real-form-record.cjs'),"const{pathToFileURL}=require('node:url');import(pathToFileURL(require('node:path').join(__dirname,'real-form-record.mjs')).href).catch(e=>{console.error(e.name);process.exit(1)});");
const child=spawn(createRequire(import.meta.url)('electron'),[join(output,'real-form-record.cjs'),'--real-form-record',`--demo-root=${root}`,`--demo-output=${output}`],{stdio:'inherit'});await writeFile(join(output,'recorder-process.json'),JSON.stringify({pid:child.pid}));child.on('exit',code=>process.exit(code??1));
