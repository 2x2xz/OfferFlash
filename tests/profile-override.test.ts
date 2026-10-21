import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import{mkdtemp,writeFile,mkdir}from'node:fs/promises';import{resolve,join}from'node:path';import{spawn}from'node:child_process';
test('confirmed profile overwrites parsed errors, fills college and roles, keeps protections and snapshot guards',async()=>{
 await mkdir(resolve('.backups'),{recursive:true});const directory=await mkdtemp(resolve('.backups/override-test-'));
 const module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/override-engine-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).catch(()=>require('electron').app.exit(1));");
 const output=await new Promise<string>((done,reject)=>{const child=spawn(resolve('node_modules/.bin/electron'),[main],{stdio:['ignore','pipe','pipe']});let text='';
  child.stdout.on('data',b=>text+=b.toString());child.stderr.on('data',b=>text+=b.toString());
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Isolated browser test exceeded 30 seconds'));},30000);
  child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error(text));else done(text);});
 });
 const line=output.split('\n').find(l=>l.includes('"overrideSmoke":true'));assert.ok(line);const result=JSON.parse(line);
 assert.equal(result.ok,true);assert.equal(result.targets,12);assert.equal(result.checks,31);
});
