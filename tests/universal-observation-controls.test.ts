import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {mkdtemp,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';
test('ordinary field captions, Phoenix commits, repeated supplementary groups and owned expansion',async()=>{
 const directory=await mkdtemp(resolve('.backups/observation-controls-test-')),module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/universal-observation-controls-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).catch(e=>{console.error(e);require('electron').app.exit(1)});");
 const output=await new Promise<string>((done,reject)=>{const child=spawn(resolve('node_modules/.bin/electron'),[main],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Observation controls timed out\n'+output));},55000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?done(output):reject(Error(output));});});
 const line=output.split('\n').find(line=>line.includes('"observationControls":true'));assert.ok(line,output);const result=JSON.parse(line);
 assert.equal(result.ok,true);assert.equal(result.realEmployer,false);assert.equal(result.paidRequests,0);
 assert.equal(result.validationNotCaption,true);assert.equal(result.phoenixMarkerOnly,true);assert.equal(result.semanticObservedChoice,true);assert.equal(result.literalChoiceStillExact,true);
 assert.equal(result.repeatedGroupsStable,true);assert.equal(result.imageAddOwned,true);assert.equal(result.safeSectionsExpanded,true);assert.equal(result.originalValuesPreserved,true);assert.equal(result.unsafeActions,0);
 assert.equal(result.hostOnlyBirthdayVerified,true);assert.equal(result.defaultBirthdayMasked,true);
});
