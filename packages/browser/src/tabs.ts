import {randomUUID} from 'node:crypto';
import {dialog,type WebPreferences,type WebContents} from 'electron';
import {BrowserController,type BrowserOptions} from './controller.js';
import type {BrowserBounds,BrowserState} from '../../shared/src/contracts.js';
import {isAllowedNavigation} from './navigation-policy.js';
import {readBrowserTabSession} from './tab-session.js';

interface Tab {id:string;controller:BrowserController;}
type Options=Omit<BrowserOptions,'onState'|'confirmLeave'|'confirmNativeLeave'|'onNewWindow'|'popupPreferences'|'popupContents'|'onBrowserShortcut'>&{
 onState(state:BrowserState):void;assertIdle():void;
 beforeActivate?(previous:string,next:string):void;
 confirmDiscard?(titles:string[]):Promise<boolean>;
 confirmNativeDiscard?():boolean;
};

/** Each tab owns a real WebContentsView and its own plans/history. Hiding a tab
 * never navigates, reloads or destroys it. The legacy browser service forwards
 * to the active controller, binding each method to that controller at call time. */
export class BrowserTabs {
 readonly browser:BrowserController;
 private tabs=new Map<string,Tab>();private activeId='';private visible=false;private bounds?:BrowserBounds;private disposed=false;
 private transition=false;
 constructor(private readonly options:Options){
  this.create();
  this.browser=new Proxy({} as BrowserController,{get:(_target,key)=>{
   if(key==='getState')return ()=>this.getState();
   if(key==='resize')return (bounds:BrowserBounds)=>this.resize(bounds);
   if(key==='setVisible')return (visible:boolean)=>this.setVisible(visible);
   if(key==='dispose')return ()=>this.dispose();
   const controller=this.active().controller,value=Reflect.get(controller,key,controller);
   return typeof value==='function'?value.bind(controller):value;
  }});
 }
 private active(){const tab=this.tabs.get(this.activeId);if(!tab)throw Error('没有可用的浏览器标签页。');return tab;}
 private publish(){if(!this.disposed)this.options.onState(this.getState());}
 private async discard(titles:string[]){
  if(this.options.confirmDiscard)return this.options.confirmDiscard(titles);
  return (await dialog.showMessageBox(this.options.window,{type:'question',message:titles.length===1?'离开这个申请页？':`关闭 ${titles.length} 个有修改的申请页？`,detail:'网页中有本次修改。未由网站保存的内容可能丢失。切换到其它标签不会丢掉当前页面。',buttons:['留在页面','离开'],defaultId:0,cancelId:0,noLink:true})).response===1;
 }
 private nativeDiscard(){return this.options.confirmNativeDiscard?.()??dialog.showMessageBoxSync(this.options.window,{type:'question',message:'网站提示有未保存的内容',buttons:['留在页面','离开'],defaultId:0,cancelId:0,noLink:true})===1;}
 private create(popupPreferences?:WebPreferences,popupContents?:WebContents):Tab{
  if(this.tabs.size>=20)throw Error('已打开 20 个申请标签，请先关闭不需要的标签。');
  const id=randomUUID();
  const controller=new BrowserController({...this.options,popupPreferences,popupContents,onState:()=>{if(this.tabs.has(id))this.publish();},
   confirmLeave:async()=>{const dirty=await controller.hasUnsavedChanges();return {leave:!dirty||await this.discard([controller.getState().title]),approved:dirty};},
   confirmNativeLeave:()=>this.nativeDiscard(),
   onBrowserShortcut:action=>{void this.shortcut(action).catch(error=>this.publishError(error));},
   onNewWindow:details=>{
    if(this.tabs.size>=20||this.transition||this.disposed)return {action:'deny'};
    return {action:'allow',outlivesOpener:true,overrideBrowserWindowOptions:{webPreferences:{partition:'persist:offeragent-recruiting',sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,nodeIntegrationInWorker:false,webSecurity:true,preload:undefined}},createWindow:popup=>{
     // Electron has already allocated the popup contents and its opener. Adopt
     // that object; allocating another one leaves the new tab blank.
     const child=this.create(popup.webPreferences,(popup as typeof popup&{webContents?:WebContents}).webContents);
     // Return the new contents before changing native focus. Chromium is still
     // waiting for window.open's synchronous creation reply at this point.
     setImmediate(()=>{if(this.disposed||!this.tabs.has(child.id))return;try{this.options.assertIdle();if(details.disposition!=='background-tab')this.activate(child.id);}catch{/* A fill keeps its active page. */}this.publish();});
     return child.controller.view.webContents;
    }};
   },
  });
  const tab={id,controller};this.tabs.set(id,tab);if(!this.activeId)this.activeId=id;
  controller.view.webContents.once('destroyed',()=>this.removed(id));
  return tab;
 }
 private publishError(error:unknown){if(!this.disposed)this.options.onState({...this.getState(),error:error instanceof Error?error.message:'标签页操作未完成。'});}
 getState():BrowserState{return {...this.active().controller.getState(),activeTabId:this.activeId,tabs:[...this.tabs.values()].map(({id,controller})=>{const {url,title,loading}=controller.getState();return {id,url,title:!url||url==='about:blank'?'新标签页':title||'申请页',loading};})};}
 private activate(id:string){
  const next=this.tabs.get(id);if(!next)throw Error('标签页已经关闭。');if(id===this.activeId)return;
  this.options.beforeActivate?.(this.activeId,id);
  const oldContents=this.active().controller.view.webContents;if(oldContents&&!oldContents.isDestroyed())this.active().controller.setVisible(false);this.activeId=id;
  if(this.bounds)next.controller.resize(this.bounds);next.controller.setVisible(this.visible);this.publish();
  if(this.visible&&next.controller.getState().url)next.controller.view.webContents.focus();else this.options.window.webContents.focus();
 }
 select(id:string):BrowserState{this.options.assertIdle();if(this.transition)throw Error('请先完成当前关闭确认。');this.activate(id);return this.getState();}
 async open(url?:string):Promise<BrowserState>{
  this.options.assertIdle();if(this.transition)throw Error('请先完成当前关闭确认。');
  if(url!==undefined&&(typeof url!=='string'||!isAllowedNavigation(url)))throw Error('只支持普通 HTTP/HTTPS 网页。');
  const tab=this.create();this.activate(tab.id);this.publish();
  if(url)await tab.controller.navigate(url);return this.getState();
 }
 async openOrFocus(url:string):Promise<BrowserState>{
  if(typeof url!=='string')throw Error('网页地址无效。');
  const normalized=/^[a-z][a-z\d+.-]*:/i.test(url.trim())?url.trim():`https://${url.trim()}`;
  if(!isAllowedNavigation(normalized))throw Error('只支持普通 HTTP/HTTPS 网页。');
  const existing=[...this.tabs.values()].find(tab=>tab.controller.getState().url===normalized);
  if(existing)return this.select(existing.id);
  if(!this.active().controller.getState().url||this.active().controller.getState().url==='about:blank'){
   this.options.assertIdle();if(this.transition)throw Error('请先完成当前关闭确认。');await this.active().controller.navigate(normalized);return this.getState();
  }
  return this.open(normalized);
 }
 async close(id:string):Promise<BrowserState>{
  this.options.assertIdle();if(this.transition)throw Error('请先完成当前关闭确认。');
  const tab=this.tabs.get(id);if(!tab)throw Error('标签页已经关闭。');
  this.transition=true;try{await tab.controller.requestClose();return this.getState();}finally{this.transition=false;}
 }
 private removed(id:string){
  if(this.disposed)return;const tab=this.tabs.get(id);if(!tab)return;
  const order=[...this.tabs.keys()],index=order.indexOf(id);
  // Revoke page-bound authorizations while the old controller is still selected.
  if(this.activeId===id){const next=order[index+1]??order[index-1];if(next)this.activate(next);else this.options.beforeActivate?.(id,'');}
  this.tabs.delete(id);tab.controller.dispose();
  if(!this.tabs.size){this.activeId='';const blank=this.create();if(this.bounds)blank.controller.resize(this.bounds);blank.controller.setVisible(this.visible);}
  this.publish();
 }
 resize(bounds:BrowserBounds){this.bounds={...bounds};this.active().controller.resize(bounds);}
 setVisible(visible:boolean){this.visible=visible;this.active().controller.setVisible(visible);}
 async confirmCloseAll():Promise<boolean>{
  if(this.transition)return false;this.transition=true;
  try{const changed=[];for(const tab of this.tabs.values())if(await tab.controller.hasUnsavedChanges())changed.push(tab.controller.getState().title);
   return !changed.length||await this.discard(changed);
  }finally{this.transition=false;}
 }
 restore(value:unknown){
  const session=readBrowserTabSession(value);if(!session||!session.urls.length)return;
  const tabs=[this.active(),...session.urls.slice(1).map(()=>this.create())];
  this.activate(tabs[session.activeIndex]!.id);
  session.urls.forEach((url,index)=>{if(url)void tabs[index]!.controller.navigate(url).catch(error=>this.publishError(error));});this.publish();
 }
 async shortcut(action:'new'|'close'|'next'|'previous'){
  if(action==='new')return this.open();if(action==='close')return this.close(this.activeId);
  const ids=[...this.tabs.keys()],index=ids.indexOf(this.activeId),next=ids[(index+(action==='next'?1:ids.length-1))%ids.length]!;return this.select(next);
 }
 dispose(){if(this.disposed)return;this.disposed=true;for(const tab of this.tabs.values())tab.controller.dispose();this.tabs.clear();}
}
