import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {spawn} from 'node:child_process';
test('production UI remembers skip/none and offers explicit resume-upload then repair',async()=>{
 const directory=await mkdtemp(resolve('.backups/repair-flow-ui-'));
 const output=await new Promise<string>((done,reject)=>{let output='';const child=spawn(resolve('node_modules/.bin/electron'),['apps/desktop/main.cjs','--smoke-test','--smoke-repair-flow-only'],{cwd:resolve('.'),env:{...process.env,OFFERAGENT_TEST_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);const timer=setTimeout(()=>{child.kill('SIGKILL');void writeFile(join(directory,'output.log'),output);reject(Error(output+'\nRepair UI timeout'));},45000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);void writeFile(join(directory,'output.log'),output).then(()=>code===0?done(output):reject(Error(output)));});});
 const line=output.split('\n').find(line=>line.includes('"repairFlowUICheck":true'));assert.ok(line,output);const report=JSON.parse(line);assert.equal(report.ok,true);assert.equal(report.modelRequests,0);assert.equal(report.normalDataAccessed,false);
});
