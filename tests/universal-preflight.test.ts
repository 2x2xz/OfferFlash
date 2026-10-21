import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

test('host final check skips needless API calls while preserving unknown professional mapping and real work',async()=>{
 const directory=await mkdtemp(resolve('.backups/universal-preflight-test-')),module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/universal-preflight-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).catch(e=>{console.error(e);require('electron').app.exit(1)});");
 const electronExecutable=createRequire(import.meta.url)('electron') as string;
 const output=await new Promise<string>((done,reject)=>{let output='';const child=spawn(electronExecutable,[main],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',buffer=>output+=buffer);child.stderr.on('data',buffer=>output+=buffer);const timer=setTimeout(()=>{child.kill('SIGTERM');void writeFile(join(directory,'output.log'),output);reject(Error('Preflight regression timed out\n'+output));},30000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);void writeFile(join(directory,'output.log'),output).then(()=>code===0?done(output):reject(Error(output)),reject);});});
 const line=output.split('\n').find(line=>line.includes('"universalPreflight":true'));assert.ok(line,output);const report=JSON.parse(line);
 assert.equal(report.ok,true);assert.equal(report.paidRequests,0);assert.equal(report.externalRequests,0);
 assert.equal(report.cases.correct.requests,0);assert.equal(report.cases.correct.verified,0);assert.equal(report.cases.correct.matchedConfirmed,6);assert.equal(report.cases.correct.status,'completed');
 assert.equal(report.cases.missing.requests,0);assert.equal(report.cases.missing.status,'partial');
 assert.equal(report.cases.peripheral.requests,0);assert.equal(report.cases.peripheral.pending,0);
 assert.ok(report.cases.mapping.requests>0);assert.equal(report.cases.mapping.verified,1);assert.equal(report.cases.mapping.matchedConfirmed,2);
 assert.equal(report.cases.contact.requests,0);assert.equal(report.cases.contact.verified,1);
 assert.equal(report.cases.add.requests,0);assert.equal(report.cases.add.verified,2);
 assert.equal(report.cases.failure.status,'failed');assert.ok(report.cases.failure.matchedConfirmed>0);
});
