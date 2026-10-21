import {LoaderCircle,Plus,X} from 'lucide-react';
import {useEffect,useRef} from 'react';
import {useWorkspace} from './context.js';
import {errorText} from './helpers.js';
import './BrowserTabs.css';

export function BrowserTabsBar({disabled=false,selected=true}:{disabled?:boolean;selected?:boolean}){
 const {api,browser,setBrowser,navigate,notify}=useWorkspace();
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(browser.activeTabId)root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[browser.activeTabId,selected]);
 if(!browser.tabs?.length||!api.browserSelectTab)return null;
 async function run(work:()=>Promise<typeof browser>,show=true){try{setBrowser(await work());if(show)navigate('browser');}catch(error){notify(errorText(error),true);}}
 return <div ref={root} className="application-browser-tabs" role="tablist" aria-label="申请标签页" data-testid="application-browser-tabs">
  <div className="application-browser-tabs-scroll">{browser.tabs.map(tab=><div key={tab.id} className={`application-browser-tab${selected&&tab.id===browser.activeTabId?' selected':''}`} role="presentation">
   <button type="button" role="tab" aria-selected={selected&&tab.id===browser.activeTabId} title={tab.url||'新标签页'} disabled={disabled} data-testid={`browser-tab-${tab.id}`} onClick={()=>void run(()=>api.browserSelectTab!(tab.id))}>{tab.loading&&<LoaderCircle size={12} className="spin"/>}<span>{tab.title||'新标签页'}</span></button>
   <button type="button" className="application-browser-tab-close" aria-label={`关闭标签：${tab.title||'新标签页'}`} title="关闭标签" disabled={disabled} onClick={()=>void run(()=>api.browserCloseTab!(tab.id),selected)}><X size={12}/></button>
  </div>)}</div>
  <button type="button" className="application-browser-tab-new" aria-label="新建申请标签页" title="新建标签页（⌘T / Ctrl+T）" disabled={disabled} data-testid="browser-new-tab" onClick={()=>void run(()=>api.browserNewTab!())}><Plus size={15}/></button>
 </div>;
}
