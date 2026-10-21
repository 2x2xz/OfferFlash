import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';

test('real Jobs renderer groups company/type, preserves filters and dispatches exact job identities',async()=>{
 const directory=await mkdtemp(resolve('.backups/jobs-library-ui-test-')),module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/jobs-library-ui-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).catch(e=>{console.error(e);require('electron').app.exit(1)});");
 const executable=createRequire(import.meta.url)('electron') as string;
 const output=await new Promise<string>((done,reject)=>{let output='';const child=spawn(executable,[main],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',buffer=>output+=buffer);child.stderr.on('data',buffer=>output+=buffer);const timer=setTimeout(()=>{child.kill('SIGTERM');void writeFile(join(directory,'output.log'),output);reject(Error('Jobs renderer regression timed out\n'+output));},30000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);void writeFile(join(directory,'output.log'),output).then(()=>code===0?done(output):reject(Error(output)),reject);});});
 const line=output.split('\n').find(line=>line.includes('"jobsLibraryUI":true'));assert.ok(line,output);const report=JSON.parse(line);
 assert.equal(report.ok,true);assert.equal(report.visibleJobs,7);assert.equal(report.companyGroups,3);assert.equal(report.exactIdentityActions,true);assert.equal(report.existingProgressPreserved,true);assert.equal(report.filtersPersisted,true);assert.equal(report.realEmployer,false);assert.equal(report.modelCalls,0);assert.equal(report.externalRequests,0);assert.equal(report.normalAppTouched,false);
 assert.equal(report.keyboardTabs,true);assert.deepEqual(report.screenshots.map((shot:{width:number})=>shot.width),[1480,1080]);
 assert.equal(report.scrollRestored,true);assert.ok(report.scrollPosition.saved>0);assert.ok(Math.abs(report.scrollPosition.saved-report.scrollPosition.restored)<=1);
});
