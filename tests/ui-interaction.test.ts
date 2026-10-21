import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
test('production UI gives priority to web content and guides persisted answers through explicit confirmation',async()=>{
 const directory=await mkdtemp(resolve('.backups/ui-interaction-launch-'));const module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/ui-interaction-main.ts')],outfile:module,bundle:true,platform:'node',format:'esm',packages:'external'});
 await writeFile(main,'import(require("node:url").pathToFileURL('+JSON.stringify(module)+').href).catch(e=>{console.error(e);require("electron").app.exit(1)});');
 const executable=createRequire(import.meta.url)('electron') as string;
 const output=await new Promise<string>((done,reject)=>{let output='';const child=spawn(executable,[main],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',buffer=>output+=buffer);child.stderr.on('data',buffer=>output+=buffer);const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('UI check timed out\n'+output));},55000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);void writeFile(join(directory,'output.log'),output);code===0?done(output):reject(Error(output));});});
 const line=output.split('\n').find(line=>line.startsWith('UI_INTERACTION_RESULT '));assert.ok(line,output);const report=JSON.parse(line.slice('UI_INTERACTION_RESULT '.length));assert.ok(report.checks>=25);assert.equal(report.externalRequests,0);assert.deepEqual(report.errors,[]);console.log('UI_INTERACTION_ARTIFACTS '+report.directory);
});
