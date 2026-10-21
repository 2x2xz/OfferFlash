import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {mkdtemp,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';
import {browserTabSession,readBrowserTabSession,browserPageForAgent} from '../packages/browser/src/tab-session.js';
import {browserTabShortcut} from '../packages/browser/src/tab-shortcuts.js';

test('tab restore keeps only local addresses, never credentials, page inputs or plans',()=>{
 const session=browserTabSession({url:'https://example.com/a',title:'',loading:false,canGoBack:false,canGoForward:false,visible:false,activeTabId:'b',tabs:[{id:'a',url:'https://example.com/a',title:'A',loading:false},{id:'b',url:'https://example.com/b',title:'B',loading:false},{id:'c',url:'https://example.com/?access_token=secret',title:'C',loading:false}]});
 assert.deepEqual(session,{version:1,urls:['https://example.com/a','https://example.com/b'],activeIndex:1});assert.deepEqual(readBrowserTabSession(session),session);
 for(const url of ['file:///tmp/a','javascript:alert(1)','https://a:b@example.com','https://example.com/?code=credential','https://example.com/#token=credential'])assert.equal(readBrowserTabSession({version:1,urls:[url],activeIndex:0}),undefined);
 assert.equal(readBrowserTabSession({version:1,urls:['https://example.com'],activeIndex:1}),undefined);
});
test('tab shortcuts distinguish browser actions from editing and platform modifiers',()=>{
 assert.equal(browserTabShortcut({type:'keyDown',key:'t',meta:true},'darwin'),'new');
 assert.equal(browserTabShortcut({type:'keyDown',key:'w',control:true},'linux'),'close');
 assert.equal(browserTabShortcut({type:'keyDown',key:'Tab',control:true,shift:true},'darwin'),'previous');
 assert.equal(browserTabShortcut({type:'keyDown',key:'t',control:true},'darwin'),undefined);
 assert.equal(browserTabShortcut({type:'keyDown',key:'T',meta:true,shift:true},'darwin'),undefined);
 assert.equal(browserTabShortcut({type:'keyUp',key:'w',meta:true},'darwin'),undefined);
});
test('opening a job does not expose other application tabs to the model',()=>{
 const state={url:'https://example.com/job',title:'Job',loading:false,canGoBack:false,canGoForward:false,visible:true,activeTabId:'a',documentRevision:2,tabs:[{id:'b',url:'https://private.invalid/candidate/draft',title:'Other',loading:false}]};
 const result=browserPageForAgent(state);assert.equal(result.url,state.url);assert.equal('tabs'in result,false);assert.equal('activeTabId'in result,false);assert.equal(JSON.stringify(result).includes('private.invalid'),false);
});
test('real isolated Chromium tabs preserve drafts/history/login and handle close without crossing page plans',async()=>{
 const directory=await mkdtemp(resolve('.backups/browser-tabs-native-')),module=join(directory,'engine.mjs'),main=join(directory,'main.cjs');
 await build({entryPoints:[resolve('tests/fixtures/browser-tabs-main.ts')],outfile:module,bundle:true,format:'esm',platform:'node',packages:'external'});
 await writeFile(main,"import(require('node:url').pathToFileURL("+JSON.stringify(module)+").href).catch(e=>{console.error(e);require('electron').app.exit(1)});");
 const output=await new Promise<string>((done,reject)=>{let output='';const child=spawn(resolve('node_modules/.bin/electron'),[main,'--evidence='+directory],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);const timer=setTimeout(()=>{child.kill('SIGKILL');void writeFile(join(directory,'output.log'),output);reject(Error(output+'\nTabs check timeout'));},45000);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);void writeFile(join(directory,'output.log'),output).then(()=>code===0?done(output):reject(Error(output)));});});
 const line=output.split('\n').find(line=>line.includes('"browserTabsCheck":true'));assert.ok(line,output);const report=JSON.parse(line);assert.equal(report.ok,true);assert.ok(report.checks.length>=18);assert.equal(report.normalDataAccessed,false);assert.equal(report.modelRequests,0);
});
