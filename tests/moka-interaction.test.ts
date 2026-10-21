import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {mkdtemp,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {spawn} from 'node:child_process';
test('owned selection requires a committed value; DOM freshness ignores geometry but retains value and Add identity guards',async()=>{
 const dir=await mkdtemp(resolve('.backups/moka-interaction-test-')),module=join(dir,'engine.mjs'),main=join(dir,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/moka-interaction-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).catch(()=>require('electron').app.exit(1));");
 const output=await new Promise<string>((done,reject)=>{const child=spawn(resolve('node_modules/.bin/electron'),[main],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Isolated widget check exceeded 35 seconds'));},35000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?done(output):reject(Error(output));});});
 const line=output.split('\n').find(l=>l.includes('"mokaInteraction":true'));assert.ok(line);const result=JSON.parse(line);assert.equal(result.ok,true);assert.ok(result.checks>=20);assert.equal(result.paidRequests,0);assert.equal(result.employerSite,false);
});
