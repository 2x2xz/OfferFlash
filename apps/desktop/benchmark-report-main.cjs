/** Owned local HTML only; hidden rendering cannot access normal application sessions. */
const {app,BrowserWindow,session}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');const {pathToFileURL}=require('node:url');
(async()=>{
 const value=n=>process.argv.find(a=>a.startsWith('--'+n+'='))?.slice(n.length+3),input=path.resolve(value('input')||''),output=path.resolve(value('output')||''),kind=value('kind')||'full';
 if(!output.includes('/.backups/')||!['full','summary','otel','review','repair'].includes(kind))throw new Error('Isolated capture output/kind required');
 await fs.mkdir(output,{recursive:true,mode:0o700});app.setName('OfferFlash Benchmark Report');app.setPath('userData',path.join(output,'browser-state'));await app.whenReady();
 const own=session.fromPartition('benchmark-report-'+Date.now());let blocked=0;own.webRequest.onBeforeRequest((details,cb)=>{const allowed=details.url===pathToFileURL(input).href;if(!allowed)blocked++;cb({cancel:!allowed});});
 const window=new BrowserWindow({show:false,width:1480,height:1050,webPreferences:{session:own,sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 await window.loadFile(input);await window.webContents.executeJavaScript('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
 const run=js=>window.webContents.executeJavaScript(js);const state=await run(`({title:document.title,text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,nodeBridge:typeof require!=='undefined'||typeof window.offer!=='undefined',documentHidden:document.hidden})`);
 state.windowVisible=window.isVisible();state.webContentsFocused=window.webContents.isFocused();if(state.windowVisible||state.webContentsFocused)throw new Error('Capture must remain hidden and unfocused');
 if(!state.title.includes('OfferFlash')||state.nodeBridge||state.overflow)throw new Error('Benchmark report did not render safely');
 if(kind==='full'){
  if(!state.text.includes('原创合成诊断集'))throw new Error('Missing diagnostic scope');
  state.matchingRows=await run(`document.querySelectorAll('#matching-results tbody tr').length`);state.formRows=await run(`document.querySelectorAll('#form-results tbody tr').length`);
 }else if(kind==='summary'){
  state.cards=await run(`document.querySelectorAll('#cards .card').length`);state.defaultSplit=await run(`document.getElementById('split').value`);
  if(state.cards!==4||state.defaultSplit!=='test'||!state.text.includes('176,579')||!state.text.includes('4/12'))throw new Error('Summary counts or default split incorrect');
  await run(`document.getElementById('split').value='dev';document.getElementById('split').dispatchEvent(new Event('change'))`);
  state.devDisplayed=await run(`document.getElementById('forms').textContent.includes('48/57')&&document.getElementById('recommendations').textContent.includes('9 / 16 / 1')`);
  if(!state.devDisplayed)throw new Error('Summary split filter failed');await run(`document.getElementById('split').value='test';document.getElementById('split').dispatchEvent(new Event('change'))`);
 }else if(kind==='otel'){
  state.traces=await run(`document.getElementById('traces').options.length`);if(state.traces!==95)throw new Error('Unexpected recorded trace scope');
  await run(`const select=document.getElementById('traces');select.selectedIndex=select.options.length-1;select.dispatchEvent(new Event('change'))`);
  state.lastTraceRows=await run(`document.querySelectorAll('#view .row').length`);if(!state.lastTraceRows)throw new Error('OTel selection did not render');
 }else if(kind==='repair'){
  if(!state.text.includes('19/25')||!state.text.includes('0/24')||!state.text.includes('7368'))throw new Error('Repair numbers absent');state.tables=await run('document.querySelectorAll("table").length');if(state.tables!==2)throw new Error('Repair tables absent');
 }else{
  if(!state.text.includes('盲评'))throw new Error('Review page not rendered');state.personalReviewScreenshotPrivate=true;
 }
 await run('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(done,100))))');
 await fs.writeFile(path.join(output,'report-overview.png'),(await window.webContents.capturePage()).toPNG());
 if(kind==='full'||kind==='summary'||kind==='repair'){
  await run(kind==='repair'?`document.querySelectorAll('section')[1].scrollIntoView()`:kind==='full'?`document.getElementById('form-results').closest('section').scrollIntoView()`:`document.getElementById('forms').closest('section').scrollIntoView()`);
  await run('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(done,100))))');
  await fs.writeFile(path.join(output,'report-forms.png'),(await window.webContents.capturePage()).toPNG());
 }
 delete state.text;await fs.writeFile(path.join(output,'capture.json'),JSON.stringify({...state,kind,blockedExternalRequests:blocked},null,2));window.destroy();app.exit(blocked?2:0);
})().catch(()=>{console.error('BENCHMARK_REPORT_CAPTURE_FAILED');app.exit(2)});
