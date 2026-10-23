import {writeFile} from 'node:fs/promises';
import type {ApplicationReport} from '../../ui/src/application-fill-workflow.js';
import {APPLICATION_ACTIVE_KEY,APPLICATION_LOCATE_KEY,APPLICATION_READONLY_KEY,APPLICATION_REPORT_KEY,APPLICATION_UI_READY_KEY,sameApplicationContext} from '../../ui/src/application-fill-workflow.js';
import type {UniversalResult} from '../../browser/src/universal-form.js';

const registryKey=Symbol.for('OfferFlash.workbenchUpdate.v1');
type UpdateState={running:number;report?:ApplicationReport;directory:string;installed:boolean;};
/** Optional desktop adapter. The only reload target is the fixed package UI URL,
 * never focusedWebContents, a website, a path from IPC, or a model argument. */
export async function prepareWorkbenchUpdate(options:{engineURL:string;directory:string;context:ApplicationReport['context']}){
 if(!process.versions.electron||process.type!=='browser')return;
 const electron=await import('electron'),expected=new URL('../renderer/index.html',options.engineURL).href;
 const windows=electron.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w.webContents.getURL()===expected);if(windows.length!==1){if(electron.app.isPackaged)throw Error('APPLICATION_CONTEXT_CHANGED:workbench');return;}
 const window=windows[0]!,global=globalThis as typeof globalThis&{[registryKey]?:UpdateState};const state=global[registryKey]??={running:0,directory:options.directory,installed:false};state.directory=options.directory;
 if(!state.installed){const menu=electron.Menu.getApplicationMenu();const diagnostics=menu?.items.find(item=>item.label==='诊断')?.submenu;if(diagnostics){
  diagnostics.append(new electron.MenuItem({label:'更新工作台界面（保留官网页面）',click:()=>{void (async()=>{
   if(state.running||window.isDestroyed()||window.webContents.getURL()!==expected)return;
   const blocked=await window.webContents.executeJavaScript(`!!document.querySelector('[data-testid="agent-question-prompt"]') || sessionStorage.getItem(${JSON.stringify(APPLICATION_ACTIVE_KEY)})!==null`);if(blocked)return;
   const children=window.contentView.children.filter(view=>'webContents' in view) as import('electron').WebContentsView[];
   const ids=children.map(view=>view.webContents.id);let navigations=0;const listeners=children.map(view=>{const listener=()=>{navigations++;};view.webContents.on('did-start-navigation',listener);return()=>{if(!view.webContents.isDestroyed())view.webContents.removeListener('did-start-navigation',listener);};});
   try{
    await window.webContents.executeJavaScript(`(()=>{const messages=[...document.querySelectorAll('.chat-message')].map((element,index)=>{const content=element.querySelector('.message-content')?.cloneNode(true);content?.querySelector('.chat-message-actions')?.remove();return{id:'restored-chat-'+index,role:element.classList.contains('user')?'user':'assistant',text:content?.textContent??''};});sessionStorage.setItem('offerflash.workbench-chat.v1',JSON.stringify({messages,composerDraft:document.querySelector('textarea[aria-label="发送给助手的消息"]')?.value??''}));${state.report?`sessionStorage.setItem(${JSON.stringify(APPLICATION_REPORT_KEY)},${JSON.stringify(JSON.stringify(state.report))});`:''}})()`);
    const loaded=new Promise<void>(resolve=>window.webContents.once('did-finish-load',()=>resolve()));window.webContents.reload();await loaded;
    const actual=window.contentView.children.filter(view=>'webContents' in view) as import('electron').WebContentsView[];
    await writeFile(state.directory+'/workbench-update.json',JSON.stringify({rendererOnly:true,websiteNavigations:navigations,websiteIdsRetained:ids.every(id=>actual.some(view=>view.webContents.id===id&&!view.webContents.isDestroyed()))},null,2),{mode:0o600});
   }finally{listeners.forEach(remove=>remove());}
  })().catch(()=>{/* An update failure never navigates or closes a website. */});}}));state.installed=true;
 }}
 // macOS snapshots the native application menu; changing a submenu object
 // alone may not update the visible menu even though its JS item exists.
 if(state.installed&&electron.Menu.getApplicationMenu())electron.Menu.setApplicationMenu(electron.Menu.getApplicationMenu()!);
 const ui=await window.webContents.executeJavaScript(`({ready:sessionStorage.getItem(${JSON.stringify(APPLICATION_UI_READY_KEY)})==='1',active:sessionStorage.getItem(${JSON.stringify(APPLICATION_ACTIVE_KEY)}),locate:sessionStorage.getItem(${JSON.stringify(APPLICATION_LOCATE_KEY)}),readOnly:sessionStorage.getItem(${JSON.stringify(APPLICATION_READONLY_KEY)})})`);
 const active=ui.active?JSON.parse(ui.active):undefined;if(ui.ready&&active&&!sameApplicationContext(active,options.context))throw Error('APPLICATION_CONTEXT_CHANGED:workflow');
 const readOnly=ui.readOnly?JSON.parse(ui.readOnly):undefined;if(readOnly&&!sameApplicationContext(readOnly.context,options.context))throw Error('APPLICATION_CONTEXT_CHANGED:read-only');
 const locate=ui.locate?JSON.parse(ui.locate):undefined;if(locate&&(!sameApplicationContext(locate.context,options.context)||!locate.target||Object.keys(locate.target).some(k=>!['label','section','key'].includes(k))||typeof locate.target.label!=='string'||locate.target.label.length>400||typeof locate.target.section!=='string'||locate.target.section.length>400||locate.target.key!==undefined&&(typeof locate.target.key!=='string'||locate.target.key.length>1500)))throw Error('APPLICATION_CONTEXT_CHANGED:locate');
 state.running++;
 return{locateTarget:locate?.target as import('../../ui/src/application-review.js').ApplicationReviewTarget|undefined,readOnly:!!locate||!!readOnly||electron.app.isPackaged&&(!ui.ready||!active),finish(result?:UniversalResult){state.running=Math.max(0,state.running-1);if(result)state.report={context:options.context,checkedAt:new Date().toISOString(),result:{...result,drafts:undefined}};}};
}
