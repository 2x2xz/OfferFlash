import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';

test('generic select transactions, recovery, confirmed language answers and stable repeated records',async()=>{
 const directory=await mkdtemp(resolve('.backups/generic-controls-test-'));
 const module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/generic-controls-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).catch(e=>{console.error(e);require('electron').app.exit(1)});");
 const output=await new Promise<string>((done,reject)=>{
  const child=spawn(resolve('node_modules/.bin/electron'),[main],{stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',buffer=>output+=buffer);child.stderr.on('data',buffer=>output+=buffer);
  const timer=setTimeout(()=>{child.kill('SIGTERM');void writeFile(join(directory,'output.log'),output);reject(Error('Generic controls test timed out\n'+output));},95000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',code=>{clearTimeout(timer);void writeFile(join(directory,'output.log'),output).then(()=>{code===0?done(output):reject(Error(output));},reject);});
 });
 const line=output.split('\n').find(line=>line.includes('"genericControls":true'));assert.ok(line,output);
 const result=JSON.parse(line);
 assert.equal(result.ok,true);assert.equal(result.realEmployer,false);assert.equal(result.paidRequests,0);
 assert.deepEqual(result.controlFamilies,['sd','aria-local','aria-controls-portal']);
 assert.equal(result.confirmedMemoryReuse,true);assert.equal(result.failedSelectionDoesNotBlock,true);
 assert.equal(result.dynamicRerenderRetained,true);assert.equal(result.checkboxRecovery,true);
 assert.equal(result.twoEducationsRemainDistinct,true);assert.equal(result.unsafeActions,0);
 assert.equal(result.explicitCustomOptionCreation,true);
 assert.equal(result.anchorRerenderRetained,true);assert.equal(result.semanticMappingGuarded,true);
 assert.equal(result.bareAriaQueryNotCommitted,true);assert.equal(result.portalSearchScoped,true);
});
