import test from 'node:test';
import assert from 'node:assert/strict';
import {portraitCases,portraitProfile,portraitProtocol,portraitManifest} from './fixtures/portrait-agent-main.js';
import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

test('portrait diagnostic freezes twelve fictional cases without altering the earlier target sets',()=>{
 assert.equal(portraitCases.length,12);assert.equal(new Set(portraitCases.map(test=>test.id)).size,12);
 for(const task of ['mapping','languages','internships','additional','missing','noop'])assert.deepEqual(portraitCases.filter(test=>test.task===task).map(test=>test.skin),['native','portal']);
 assert.equal(portraitProtocol.modelRequestLimit,20);assert.equal(portraitProtocol.executionDeadlineMs,180000);
 assert.deepEqual(portraitProtocol.existingBenchmarks,{original17Targets:'unchanged',original21Targets:'unchanged',oldGoldAndScorers:'unchanged'});
 assert.equal(portraitProfile.personal.confirmedRevision,portraitProfile.personal.revision);assert.equal(portraitProfile.personal.languages.length,2);assert.equal(portraitProfile.career.internships.length,2);
 assert.equal(portraitProfile.career.internships[0]!.organization,portraitProfile.career.internships[1]!.organization);assert.notEqual(portraitProfile.career.internships[0]!.role,portraitProfile.career.internships[1]!.role);
 for(const scenario of portraitCases){assert.match(scenario.html,/原创虚构画像诊断/);assert.match(scenario.html,/data-application/);assert.ok(scenario.html.includes('id="submit-application"'));assert.equal(scenario.gold.unchanged.agreement,false);assert.equal(scenario.gold.unchanged.upload,'');}
 for(const scenario of portraitCases.filter(test=>test.task==='mapping')){assert.equal(scenario.gold.exact.length,3);assert.deepEqual(scenario.gold.selections,[{id:'education-major-category',label:'数学统计',sourcePath:'career.educations/portrait-education.major',relation:'category'}]);assert.equal(scenario.gold.expectedDraftWritten,1);assert.equal(scenario.gold.expectedStatus,'partial');}
 assert.ok(portraitCases.every(scenario=>scenario.html.includes('id="upload" type="file" disabled')));
 for(const scenario of portraitCases.filter(test=>test.task==='languages')){assert.equal(scenario.gold.selections.length,6);assert.equal(scenario.gold.expectedVerified,0);assert.equal(scenario.gold.expectedDraftWritten,6);assert.equal(scenario.gold.expectedStatus,'partial');}
 for(const scenario of portraitCases.filter(test=>test.task==='internships')){assert.equal(scenario.gold.recordSet!.length,2);assert.equal(scenario.gold.expectedAdds,1);}
 for(const scenario of portraitCases.filter(test=>test.task==='missing')){assert.deepEqual(scenario.gold.missing,['missing-gpa','missing-sql-level','missing-cet6','missing-national-award']);assert.equal(scenario.gold.expectedDraftWritten,0);}
 for(const scenario of portraitCases.filter(test=>test.task==='noop'))assert.equal(scenario.gold.expectedRequests,0);
 const manifest=portraitManifest();assert.equal(manifest.cases.length,12);assert.ok(manifest.cases.every(test=>/^[a-f0-9]{64}$/.test(test.htmlHash)&&/^[a-f0-9]{64}$/.test(test.goldHash)));
});

test('production Pi tools prepare twelve fictional portrait tasks with separate draft and confirmed receipts',async()=>{
 const directory=await mkdtemp(resolve('.backups/portrait-harness-20261021/launcher-scripted-')),module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/portrait-agent-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).then(async module=>{const report=await module.runPortraitDiagnostic({mode:'scripted'});require('electron').app.exit(report.ok?0:1)}).catch(error=>{console.error(error);require('electron').app.exit(1)});");
 const executable=createRequire(import.meta.url)('electron') as string;
 const output=await new Promise<string>((done,reject)=>{let output='';const child=spawn(executable,[main],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',buffer=>output+=buffer);child.stderr.on('data',buffer=>output+=buffer);const timer=setTimeout(()=>{child.kill('SIGTERM');void writeFile(join(directory,'output.log'),output);reject(Error('Portrait scripted SDK diagnostic timed out\n'+output));},180000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);void writeFile(join(directory,'output.log'),output).then(()=>code===0?done(output):reject(Error(output)),reject);});});
 const line=output.split('\n').find(line=>line.includes('"portraitDiagnostic":true'));assert.ok(line,output);const summary=JSON.parse(line),report=JSON.parse(await readFile(join(summary.directory,'report.json'),'utf8'));
 assert.equal(report.mode,'scripted');assert.equal(report.ok,true,JSON.stringify(report.cases.map((scenario:any)=>({id:scenario.id,failed:Object.entries(scenario.checks).filter(([,passed])=>!passed)}))));assert.equal(report.caseCount,12);assert.equal(report.paidRequests,0);assert.equal(report.externalEmployerRequests,0);
 for(const scenario of report.cases){assert.equal(scenario.result.failureCode,undefined);assert.ok(scenario.result.modelRequests<=20);assert.equal(scenario.checks.profileUnchanged,true);assert.equal(scenario.checks.noSubmission,true);assert.equal(scenario.checks.noUploads,true);assert.equal(scenario.checks.noAgreement,true);}
 for(const scenario of report.cases.filter((scenario:any)=>scenario.id.startsWith('languages'))){assert.equal(scenario.result.verified,0);assert.equal(scenario.result.draftWritten,6);assert.equal(scenario.result.status,'partial');}
 for(const scenario of report.cases.filter((scenario:any)=>scenario.id.startsWith('noop'))){assert.equal(scenario.result.modelRequests,0);assert.equal(scenario.result.matchedConfirmed,16);}
});
