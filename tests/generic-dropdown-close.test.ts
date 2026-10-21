import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';

test('dropdown cleanup never refocuses, waits for real closing and preserves an unclosed selection',async()=>{
 const directory=await mkdtemp(resolve('.backups/dropdown-close-test-'));
 const module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/generic-dropdown-close-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).catch(e=>{console.error(e);require('electron').app.exit(1)});");
 const output=await new Promise<string>((done,reject)=>{
  const child=spawn(resolve('node_modules/.bin/electron'),[main],{stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',buffer=>output+=buffer);child.stderr.on('data',buffer=>output+=buffer);
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Dropdown cleanup checks timed out\n'+output));},30000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);code===0?done(output):reject(Error(output));});
 });
 const line=output.split('\n').find(line=>line.includes('"dropdownClose":true'));assert.ok(line,output);
 const result=JSON.parse(line);assert.equal(result.ok,true);assert.equal(result.realEmployer,false);assert.equal(result.paidRequests,0);
 assert.equal(result.bodyNeverRefocused,true);assert.equal(result.animationWaited,true);assert.equal(result.hostCaptionClosed,true);
 assert.equal(result.persistentTriggerWrapperExcluded,true);assert.equal(result.transparentNonInteractiveClosed,true);assert.equal(result.transparentInterceptorRejected,true);
 assert.equal(result.unclosableStayedFalse,true);assert.equal(result.selectedValuePreserved,true);assert.equal(result.unsafeActions,0);
});
