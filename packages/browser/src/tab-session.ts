import type {BrowserState} from '../../shared/src/contracts.js';

export interface BrowserTabSession {version:1;urls:string[];activeIndex:number;}
function restorable(raw:unknown):raw is string{
 if(typeof raw!=='string'||raw.length>4000)return false;
 if(raw==='')return true;
 try{const url=new URL(raw);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&![...url.searchParams.keys()].some(key=>/^(?:access_token|id_token|refresh_token|token|password|api_key|apikey|authorization|ticket|auth_code|code)$/i.test(key))&&!/\b(?:access_token|id_token|token|password|api_key)=/i.test(url.hash);}catch{return false;}
}
/** Local tab addresses only. No inputs, plans, cookies or credentials. */
export function browserTabSession(state:BrowserState):BrowserTabSession{
 const tabs=(state.tabs??[]).filter(tab=>restorable(tab.url)).slice(0,20);
 return {version:1,urls:tabs.map(tab=>tab.url),activeIndex:Math.max(0,tabs.findIndex(tab=>tab.id===state.activeTabId))};
}
export function readBrowserTabSession(value:unknown):BrowserTabSession|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const item=value as Record<string,unknown>;
 if(item.version!==1||!Array.isArray(item.urls)||item.urls.length>20||!item.urls.every(restorable)||!Number.isInteger(item.activeIndex)||Number(item.activeIndex)<0||Number(item.activeIndex)>=Math.max(1,item.urls.length))return;
 return {version:1,urls:[...item.urls],activeIndex:Number(item.activeIndex)};
}
/** The domain Agent may see the page it opened, never the user's other tabs. */
export function browserPageForAgent(state:BrowserState){
 return {url:state.url,title:state.title,loading:state.loading,canGoBack:state.canGoBack,canGoForward:state.canGoForward,visible:state.visible,...(state.error?{error:state.error}:{}),...(state.zoomPercent?{zoomPercent:state.zoomPercent}:{})};
}
