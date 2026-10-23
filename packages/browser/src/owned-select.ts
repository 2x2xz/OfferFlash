import type {Locator,ElementHandle,JSHandle,Request,Response} from 'playwright-core';
import {displayedFactMatches,optionMatchesFact,type ApplicationFact} from '../../forms/src/application-facts.js';
import {OWNED_SELECT_HELPERS} from './select-shape.js';

export type OwnedSelectFact=Pick<ApplicationFact,'kind'|'value'>;
export type OwnedSelectContext={label:string};
export type OwnedSelectCommit={value:string;source:string;committed:boolean};
export type OwnedSelectOption={ref:string;label:string;aliases:string[];selected:boolean};
export type OwnedSelectNavigation={ref:string;role:'tab';label:string;selected:boolean};
export type OwnedSelectRead={options:OwnedSelectOption[];committed:OwnedSelectCommit;open:boolean;truncated:boolean;canCreate?:{ref:string;label:string};loading?:boolean;queryState?:'pending'|'settled'|'unknown'|'failed'};
export interface OwnedSelectController{
 open(query?:string):Promise<OwnedSelectRead>;
 query(value:string):Promise<OwnedSelectRead>;
 read():Promise<OwnedSelectRead>;
 waitForOptions(fact?:OwnedSelectFact,timeoutMs?:number):Promise<OwnedSelectRead>;
 inspectNavigation():Promise<OwnedSelectNavigation[]>;
 navigate(ref:string,checkUnchanged:()=>Promise<void>):Promise<void>;
 choose(ref:string,fact:OwnedSelectFact,checkUnchanged?:()=>Promise<void>):Promise<OwnedSelectCommit>;
 choosePath(labels:string[],checkUnchanged?:()=>Promise<void>):Promise<OwnedSelectCommit>;
 chooseObserved(ref:string,checkUnchanged?:()=>Promise<void>):Promise<OwnedSelectCommit>;
 create(fact:OwnedSelectFact,checkUnchanged?:()=>Promise<void>):Promise<OwnedSelectCommit>;
 scroll(direction:'up'|'down'):Promise<OwnedSelectRead>;
 close():Promise<{closed:boolean}>;
 dispose():Promise<void>;
}

// The vocabulary is fixed program code. The model only receives host-generated
// references and observed labels, never a selector or a page-script interface.
const optionSelector='[role="option"],li,div,span,option';
const locateScope=new Function('e',OWNED_SELECT_HELPERS+'return selectScope(e);') as (e:Element)=>Element|null;
const readCommit=new Function('e',OWNED_SELECT_HELPERS+'return selectCommitted(e);') as (e:Element)=>OwnedSelectCommit;
const directQueryControl=new Function('e',OWNED_SELECT_HELPERS+String.raw`
 const inputs=(e.matches('input,textarea')?[e]:Array.from(e.querySelectorAll('input:not([type="hidden"]),textarea'))).filter(n=>selectVisible(n)&&!n.matches('.phoenix-select__input--unText')&&!n.closest('.ud__select__selector-readOnly'));
 return inputs.length===1&&!inputs[0].readOnly&&!inputs[0].disabled&&inputs[0].getAttribute('aria-disabled')!=='true'?inputs[0]:null;
`) as (e:Element)=>Element|null;
const popupQueryControls=new Function('menu',OWNED_SELECT_HELPERS+String.raw`
 return Array.from(menu.querySelectorAll('input,textarea')).filter(e=>selectVisible(e)&&!e.readOnly&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!e.closest('a[href],button')&&e.matches('textarea,input[type="text"],input[type="search"],input:not([type])')&&(e.getAttribute('role')==='searchbox'||e.getAttribute('type')==='search'||!!e.closest('.phoenix-search')||/^(?:搜索|search)$/i.test(e.getAttribute('placeholder')||'')||['list','both'].includes(e.getAttribute('aria-autocomplete'))));
`) as (menu:Element)=>Element[];
const visibleMenusBefore=new Function('e',OWNED_SELECT_HELPERS+`const before=new Set(selectPopupRoots(e.ownerDocument.body,e).filter(selectPopupRendered));before.focus=e.ownerDocument.activeElement;return before;`) as (e:Element)=>Set<Element>;
const newlyOpenedMenus=new Function('e','before',OWNED_SELECT_HELPERS+String.raw`
 const active=e.ownerDocument.activeElement;
 // Some readonly triggers prevent mousedown's default focus. A uniquely new
 // adjacent portal is still attributable to that click when focus stayed on
 // the document; do not require a focus change the component never performs.
 const adjacent=n=>{const a=e.getBoundingClientRect(),b=n.getBoundingClientRect();return a.width>0&&a.height>0&&b.width>0&&b.height>0&&Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(Math.abs(b.top-a.bottom),Math.abs(a.top-b.bottom))<=80;};
 const optionContent=n=>!!n.querySelector('[role="option"],[role="menuitem"],li')||[n,...Array.from(n.querySelectorAll('*')).slice(0,1600)].some(child=>selectMenu(child)&&child.children.length>0);
 const candidates=selectPopupRoots(e.ownerDocument.body,e).filter(n=>!n.contains(e)&&!before.has(n)&&selectPopupRendered(n)&&optionContent(n)&&(active===e||e.contains(active)||n.contains(active)||active===before.focus&&adjacent(n)));
 return candidates.filter(n=>!candidates.some(parent=>parent!==n&&parent.contains(n)));
`) as (e:Element,before:Set<Element>)=>Element[];
const locateMenus=new Function('scope','target',OWNED_SELECT_HELPERS+'return selectPopupRoots(scope,target).filter(selectPopupRendered);') as (scope:Element,target:Element)=>Element[];
const inspectOptions=new Function('menu','selector',OWNED_SELECT_HELPERS+String.raw`
 const all=Array.from(menu.querySelectorAll(selector)).slice(0,1600);
 const capture=result=>({...result,nodes:result.options.map(entry=>all[entry.index])});
 const category=menu.matches('.constant-main-selector-container')?menu:menu.querySelector('.constant-main-selector-container');
 if(selectSingleCategory(category))return capture({options:all.flatMap((e,index)=>{
  if(!e.matches('.list-item-container')||!selectVisible(e)||e.closest('.right-container')||e.matches('.disabled,[aria-disabled="true"]'))return [];
  const label=selectText(e.querySelector('.item-text-label'));return label?[{index,label,aliases:[label],selected:!!e.querySelector('.RadioChecked'),explicit:true,descendants:[]}]:[];
 }),truncated:!!category.querySelector('.list-data-container [style*="overflow"]')});
 const candidates=all.flatMap((e,index)=>{
  const button=e.closest('button'),labelOwner=e.closest('label');
  if(!selectVisible(e)||e.matches('[disabled],[aria-disabled="true"]')||e.closest('a[href]')||labelOwner&&menu.contains(labelOwner)||button&&!(button===e&&e.matches('[role="option"][type="button"]'))||e.querySelector('input,textarea,select,button,a[href]'))return [];
  const label=selectText(e);if(!label||label.length>500)return [];
  const explicit=e.matches('[role="option"],li,option');
  if(!explicit&&Array.from(e.children).some(n=>n.matches('[role="option"],li,option')))return [];
  const children=Array.from(e.children).filter(selectVisible).map(selectText),aliases=[label];
  if(children.length===2&&/[\u3400-\u9fff]/u.test(children[0])&&/^[A-Za-z]/.test(children[1]))aliases.push(children[0]+' / '+children[1]);
  return [{index,label,aliases,selected:e.getAttribute('aria-selected')==='true'||e.selected===true,explicit,descendants:all.flatMap((child,i)=>child!==e&&e.contains(child)?[i]:[])}];
 });
 // Prefer semantic option rows. For div/span menus keep the largest text row
// whose children are aliases, and exclude list-wide container aggregates.
 const semantic=candidates.filter(c=>c.explicit);
 if(semantic.length)return capture({options:semantic,truncated:all.length>=1600});
 const bilingual=candidates.filter(c=>c.aliases.length>1);
 const rows=candidates.filter(c=>c.descendants.length===0||bilingual.includes(c));
 return capture({options:rows.filter(c=>!rows.some(parent=>parent!==c&&parent.descendants.includes(c.index))),truncated:all.length>=1600});
`) as (menu:Element,selector:string)=>{options:Array<{index:number;label:string;aliases:string[];selected:boolean;explicit:boolean;descendants:number[]}>;truncated:boolean;nodes:Element[]};

export function ownedOptionMatches(fact:OwnedSelectFact,label:string):boolean{
 if(fact.kind==='yearPart')return /^\d{4}$/.test(fact.value)&&new RegExp('^'+fact.value+'年?$').test(label.trim());
 if(fact.kind==='monthPart')return /^\d{1,2}$/.test(fact.value)&&Number(fact.value)>=1&&Number(fact.value)<=12&&/^(?:0?[1-9]|1[0-2])月?$/.test(label.trim())&&Number(label.trim().replace(/月$/,''))===Number(fact.value);
 return displayedFactMatches(fact,label)||optionMatchesFact(label,fact.value);
}

type ObservedOption=OwnedSelectOption&{node:ElementHandle<Element>;menu:ElementHandle<Element>};
type CreateEntry={ref:string;label:string;node:ElementHandle<Element>;menu:ElementHandle<Element>};
const createEntryLabel=/^(?:add\s+(?:the\s+)?full\s+name(?:\s+of\s+.{1,100})?|(?:add|create)\s+(?:a\s+|new\s+)?custom\s+option|添加(?:(?:学校|院校|专业)?(?:完整名称|全称)|自定义选项)|输入(?:完整名称|全称))$/iu;
const createConfirmLabel=/^(?:add|create|添加|新增|确定|确认)$/iu;
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const optionLoading=/^(?:加载中(?:[.。…]+)?|正在加载(?:[.。…]+)?|搜索中(?:[.。…]+)?|loading(?:\s+(?:options|results))?[. …]*|searching[. …]*)$/i;
const optionPlaceholder=/^(?:暂无选项|暂无数据|没有找到学校[？?]?|没有找到结果[？?]?|无匹配(?:项|结果)?|no\s+(?:options|results|matches)(?:\s+found)?[.!]?)$/i;
const optionSignature=(snapshot:OwnedSelectRead)=>JSON.stringify([snapshot.options.map(option=>option.aliases),snapshot.canCreate?.label,!!snapshot.loading]);
let controllerSequence=0;

/** One target-bound dropdown transaction, reusable for every ordinary field.
 * Uses real clicks, then independent stable readback. Never edits framework
 * classes, aria-selected, display text or application state to manufacture a pass.
 */
export async function createOwnedSelectController(node:Locator,guard:()=>Promise<void>,context?:OwnedSelectContext):Promise<OwnedSelectController>{
 let target=await node.elementHandle();if(!target)throw Error('FIELD_DISAPPEARED');
 if(await target.evaluate(e=>!!e.closest('a[href],button:not([type="button"])')||e.matches('input[type="submit"],input[type="image"]'))){await target.dispose();throw Error('UNSAFE_SELECT_TARGET');}
 const scopeHandle=await target.evaluateHandle(locateScope) as JSHandle<Element|null>;
 let scope=scopeHandle.asElement();if(!scope){await scopeHandle.dispose();await target.dispose();throw Error('OWNED_SELECT_UNAVAILABLE');}
 const signature=await target.evaluate(e=>({id:e.id,role:e.getAttribute('role'),tag:e.tagName,type:e.getAttribute('type'),label:e.getAttribute('aria-label')}));
 const ownerFrame=await target.ownerFrame(),ownerPage=ownerFrame?.page();
 type QueryActivity={started:number;lastNetwork:number;lastDOM:number;signature:string;changed:boolean;sawRequest:boolean;sawLoading:boolean;failed:boolean;pending:Set<Request>;kind:'open'|'query'};
 let queryActivity:QueryActivity|undefined;
 // Frame-scoped XHR/fetch metadata only. No URL/header/body/credential capture.
 const onRequest=(request:Request)=>{if(!queryActivity||!['xhr','fetch'].includes(request.resourceType()))return;try{if(request.frame()!==ownerFrame)return;}catch{return;}queryActivity.pending.add(request);queryActivity.sawRequest=true;queryActivity.lastNetwork=Date.now();};
 const onResponse=(response:Response)=>{if(queryActivity?.pending.has(response.request())&&response.status()>=400)queryActivity.failed=true;};
 const finishRequest=(request:Request)=>{if(queryActivity?.pending.delete(request)){queryActivity.lastNetwork=Date.now();if(request.failure())queryActivity.failed=true;}};
 ownerPage?.on('request',onRequest);ownerPage?.on('response',onResponse);ownerPage?.on('requestfinished',finishRequest);ownerPage?.on('requestfailed',finishRequest);
 const beginActivity=(snapshot:OwnedSelectRead,kind:'open'|'query')=>{const now=Date.now();queryActivity={started:now,lastNetwork:now,lastDOM:now,signature:optionSignature(snapshot),changed:false,sawRequest:false,sawLoading:false,failed:false,pending:new Set(queryActivity?.pending),kind};};
 const referencePrefix='owned-'+(++controllerSequence),identityRegistry=await target.evaluateHandle(()=>({ids:new WeakMap<Element,number>(),next:0}));
 const reference=async(element:ElementHandle<Element>,kind:'option'|'create'|'navigation')=>referencePrefix+'-'+kind+'-'+await element.evaluate((e,registry)=>{let id=registry.ids.get(e);if(id===undefined){id=registry.next++;registry.ids.set(e,id);}return id;},identityRegistry);
 let options:ObservedOption[]=[],menus:ElementHandle<Element>[]=[],disposed=false,opened=false,createEntry:CreateEntry|undefined;
 let popupBaseline:JSHandle<Set<Element>>|undefined,boundPopup:ElementHandle<Element>|undefined,popupBindingUntil=0,closingUntil=0;
 const disposeOptions=async()=>{await createEntry?.node.dispose().catch(()=>{});createEntry=undefined;for(const option of options)await option.node.dispose().catch(()=>{});options=[];for(const menu of menus)await menu.dispose().catch(()=>{});menus=[];};
 const valid=async()=>{
  if(disposed)throw Error('OWNED_SELECT_CLOSED');await guard();
  if(await target!.evaluate(new Function('e',OWNED_SELECT_HELPERS+'return selectDisabled(e);') as (e:Element)=>boolean))throw Error('OWNED_SELECT_DISABLED');
  if(await target!.evaluate((e,owner)=>e.isConnected&&owner.isConnected&&owner.contains(e),scope!))return;
  // React can replace a node after a real selection. Only an explicit stable ID
  // in the same still-connected single-control owner permits local rebinding.
  const replacement=await node.elementHandle();
  const same=!!replacement&&!!signature.id&&await replacement.evaluate((e,{owner,signature})=>e.isConnected&&owner.isConnected&&owner.contains(e)&&e.id===signature.id&&Array.from(e.ownerDocument.querySelectorAll('[id]')).filter(n=>n.id===signature.id).length===1&&e.tagName===signature.tag&&e.getAttribute('role')===signature.role&&e.getAttribute('type')===signature.type&&e.getAttribute('aria-label')===signature.label,{owner:scope!,signature});
  if(!same){const diagnostic={stage:'target-rebind',hasStableId:!!signature.id,targetConnected:await target!.evaluate(e=>e.isConnected),ownerConnected:await scope!.evaluate(e=>e.isConnected),replacementInOwner:!!replacement&&await replacement.evaluate((e,owner)=>owner.contains(e),scope!)};await replacement?.dispose();throw Object.assign(Error('OWNED_SELECT_CHANGED'),{controlDiagnostic:diagnostic});}
  await target!.dispose();target=replacement;
 };
 const nativeAction=async<T>(stage:string,element:ElementHandle<Element>,run:()=>Promise<T>):Promise<T>=>{
  try{return await run();}catch(error){
   if(error instanceof Error&&!(error as Error&{controlDiagnostic?:unknown}).controlDiagnostic){
    const shape=await element.evaluate(e=>{const r=e.getBoundingClientRect(),hit=e.ownerDocument.elementFromPoint(r.x+r.width/2,r.y+r.height/2),classes=(n:Element|null)=>n?Array.from(n.classList).filter(c=>/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(c)).slice(0,8):[];return {connected:e.isConnected,tag:e.tagName,inViewport:r.top>=0&&r.bottom<=innerHeight,hitOwned:!!hit&&(hit===e||e.contains(hit)),classes:classes(e),blockerTag:hit?.tagName,blockerClasses:classes(hit),ancestors:[e.parentElement,e.parentElement?.parentElement,e.parentElement?.parentElement?.parentElement].filter((n):n is HTMLElement=>!!n).map(n=>({tag:n.tagName,classes:classes(n),controls:n.querySelectorAll('input,textarea,select').length}))};}).catch(()=>({connected:false}));
    Object.assign(error,{controlDiagnostic:{stage,nativeFailure:/not attached|detached/i.test(error.message)?'detached':/disposed/i.test(error.message)?'disposed':/intercepts pointer/i.test(error.message)?'intercepted':error.name==='TimeoutError'?'timeout':'other',...shape}});
   }throw error;
  }
 };
 const refreshMenus=async()=>{
  await disposeOptions();await valid();
  const array=await scope!.evaluateHandle(locateMenus,target!);
  const properties=await array.getProperties();
  for(const [key,handle]of properties){const menu=handle.asElement();if(/^\d+$/.test(key)&&menu)menus.push(menu);else await handle.dispose();}
  await array.dispose();
  if(boundPopup&&!await boundPopup.evaluate(e=>e.isConnected)){await boundPopup.dispose();boundPopup=undefined;}
  if(!menus.length&&!boundPopup&&popupBaseline&&Date.now()<=popupBindingUntil){
   const opened=await target!.evaluateHandle(newlyOpenedMenus,popupBaseline),properties=await opened.getProperties(),candidates:ElementHandle<Element>[]=[];
   for(const[key,handle]of properties){const popup=handle.asElement();if(/^\d+$/.test(key)&&popup)candidates.push(popup);else await handle.dispose();}
   await opened.dispose();
   if(candidates.length===1)boundPopup=candidates[0];else{for(const candidate of candidates)await candidate.dispose();if(candidates.length>1)throw Error('OWNED_MENU_ASSOCIATION_AMBIGUOUS');}
  }
  if(boundPopup&&await boundPopup.evaluate(new Function('e',OWNED_SELECT_HELPERS+'return e.isConnected&&selectPopupRendered(e);') as (e:Element)=>boolean)){
   let duplicate=false;for(const menu of menus)if(await menu.evaluate((e,popup)=>e===popup,boundPopup)){duplicate=true;break;}
   if(!duplicate){const copy=await boundPopup.evaluateHandle(e=>e);const element=copy.asElement();if(element)menus.push(element);else await copy.dispose();}
  }
 };
 const read=async():Promise<OwnedSelectRead>=>{
  await refreshMenus();let truncated=false;
  if(await target!.evaluate(e=>e.tagName==='SELECT')){
   const handles=await target!.$$('option');for(const h of handles){const value=await h.evaluate((e:any)=>({label:(e.textContent??'').trim(),selected:!!e.selected,disabled:!!e.disabled}));if(value.disabled){await h.dispose();continue;}options.push({ref:await reference(h,'option'),label:value.label,aliases:[value.label],selected:value.selected,node:h,menu:target!});}
  }else for(const menu of menus){
   // Capture labels AND their actual nodes in one synchronous page turn. A
   // second DOM query by old ordinal can race an asynchronous list replacement.
   const captured=await menu.evaluateHandle(inspectOptions,optionSelector),snapshot=await captured.evaluate(({nodes,...data})=>data);truncated ||=snapshot.truncated;
   const nodes=await captured.getProperty('nodes'),properties=await nodes.getProperties(),keep=new Set<number>();
   try{for(let index=0;index<snapshot.options.length;index++){if(options.length>=200){truncated=true;break;}const entry=snapshot.options[index]!,handle=properties.get(String(index))?.asElement();if(!handle)throw Object.assign(Error('OWNED_SELECT_CHANGED'),{controlDiagnostic:{stage:'option-capture'}});keep.add(index);options.push({ref:await reference(handle,'option'),label:entry.label,aliases:entry.aliases,selected:entry.selected,node:handle,menu});}}
   finally{for(const[key,handle]of properties)if(!keep.has(Number(key)))await handle.dispose();await nodes.dispose();await captured.dispose();}
  }
  const createEntries:CreateEntry[]=[];
  for(const menu of menus){const buttons=await menu.$$('button[type="button"],[role="button"]');
   for(const button of buttons){const observed=await button.evaluate(e=>({visible:!!e.getBoundingClientRect().width&&!!e.getBoundingClientRect().height,label:(e.textContent??'').replace(/\s+/g,' ').trim(),safe:!e.closest('a[href]')&&!e.matches('[disabled],[aria-disabled="true"]')&&!e.querySelector('input,select,textarea,a[href]')&&!(e.tagName==='BUTTON'&&(e as HTMLButtonElement).type!=='button')}));
    if(observed.visible&&observed.safe&&createEntryLabel.test(observed.label))createEntries.push({ref:await reference(button,'create'),label:observed.label,node:button,menu});else await button.dispose();
   }
  }
  if(createEntries.length===1)createEntry=createEntries[0];else for(const entry of createEntries)await entry.node.dispose();
  let loading=options.some(option=>optionLoading.test(option.label));
  for(const menu of menus)loading ||=await menu.evaluate(e=>[e,...Array.from(e.querySelectorAll('[aria-busy="true"],[role="progressbar"]'))].some(node=>{const r=node.getBoundingClientRect();return node.matches('[aria-busy="true"],[role="progressbar"]')&&!!r.width&&!!r.height;}));
  const meaningful:ObservedOption[]=[];for(const option of options){if(optionLoading.test(option.label)||optionPlaceholder.test(option.label))await option.node.dispose();else meaningful.push(option);}options=meaningful;
  const committed=await target!.evaluate(readCommit);
  const expanded=await target!.evaluate(e=>e.getAttribute('aria-expanded')==='true'||e.querySelector('[aria-expanded="true"]')!==null);
  const result:OwnedSelectRead={options:options.map(({node,menu,...value})=>value),committed,open:expanded||menus.length>0,truncated,canCreate:createEntry?{ref:createEntry.ref,label:createEntry.label}:undefined,loading};
  if(queryActivity){const now=Date.now(),shape=optionSignature(result);if(shape!==queryActivity.signature){queryActivity.changed=true;queryActivity.signature=shape;queryActivity.lastDOM=now;}queryActivity.sawLoading ||=loading;
   result.queryState=loading||queryActivity.pending.size||now-queryActivity.lastDOM<200||now-queryActivity.lastNetwork<200?'pending':queryActivity.failed?'failed':(queryActivity.sawRequest||queryActivity.sawLoading||queryActivity.changed)&&now-queryActivity.started>=(queryActivity.kind==='query'?1200:200)?'settled':'unknown';
  }return result;
 };
 const waitForOptions=async(fact?:OwnedSelectFact,timeoutMs=15000,explicitCreate=false):Promise<OwnedSelectRead>=>{
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw Error('INVALID_SELECT_QUERY');
  const until=Date.now()+timeoutMs;
  do{await valid();const result=await read(),matches=fact?result.options.filter(option=>option.aliases.some(label=>ownedOptionMatches(fact,label))):[];
   if(matches.length>1)throw Error('OWNED_OPTION_AMBIGUOUS');
   // A create entry is never evidence that an asynchronous search finished.
   if(!result.loading&&!queryActivity?.pending.size&&matches.length===1&&(!queryActivity||Date.now()-queryActivity.lastDOM>=200))return result;
   if(result.queryState==='failed')throw Error('OWNED_OPTIONS_REQUEST_FAILED');
   if(!result.loading&&(!queryActivity||result.queryState==='settled'))return result;
   // An explicit create tool may serve a synchronous custom-value control.
   // Automatic lookup never uses this exception; an observed request/loading
   // transition must still finish, and no create bypasses failure or activity.
   if(explicitCreate&&result.canCreate&&!result.loading&&queryActivity&&!queryActivity.sawRequest&&!queryActivity.sawLoading&&!queryActivity.pending.size&&Date.now()-queryActivity.started>=1500&&Date.now()-queryActivity.lastDOM>=200)return result;
   if(!result.open)throw Error('OWNED_SELECT_CLOSED');
   if(Date.now()>=until)throw Object.assign(Error('OWNED_OPTIONS_NOT_SETTLED'),{controlDiagnostic:{stage:'options-wait',loading:result.loading,queryState:result.queryState,pendingRequests:queryActivity?.pending.size??0},selectionAttempted:false});
   await pause(100);
  }while(true);
 };
 const close=async():Promise<{closed:boolean}>=>{
  if(disposed)return{closed:true};
  try{
   await valid();await refreshMenus();
   const isClosed=async()=>{await valid();await refreshMenus();return menus.length===0&&!await target!.evaluate(e=>e.getAttribute('aria-expanded')==='true'||e.querySelector('[aria-expanded="true"]')!==null);};
   const ownedActive=()=>scope!.evaluateHandle((owner,{target,menus})=>{const active=target.ownerDocument.activeElement;return active&&(active===target||target.contains(active)||menus.some(menu=>menu.contains(active)))?active:null;},{target:target!,menus});
   const blurOwnedActive=async()=>{const handle=await ownedActive();try{const active=handle.asElement();if(active)await active.evaluate(e=>{if(e.isConnected&&e===e.ownerDocument.activeElement)(e as HTMLElement).blur();});}finally{await handle.dispose();}};
   const waitClosed=async(until:number)=>{let clearSince:number|undefined;do{
     if(await isClosed()){clearSince??=Date.now();if(Date.now()-clearSince>=50)return true;}else clearSince=undefined;
     if(Date.now()>=until)return false;await pause(Math.min(40,Math.max(1,until-Date.now())));
    }while(true);};
   // A completed option click often already removed the menu, while focus
   // still hides its committed marker. Blur it without ever focusing it again.
   if(await isClosed()){await blurOwnedActive();if(await waitClosed(Date.now()+100)){opened=false;return{closed:true};}}
   // A single-choice category dialog owns its own cancel/confirm footer.
   // Closing it means cancelling that local picker, never the application.
   if(menus.length===1){const buttons=await menus[0]!.$$('.constant-main-selector-container .selector-footer-button .phoenix-button'),cancel:ElementHandle<Element>[]=[];
    for(const button of buttons)if(await button.isVisible()&&await button.evaluate(e=>(e as HTMLElement).innerText.trim()==='取消'&&!e.closest('a[href],button[type="submit"]')))cancel.push(button);
    try{if(cancel.length===1){await valid();await cancel[0]!.click({timeout:1500});if(await waitClosed(Date.now()+400)){opened=false;return{closed:true};}}}finally{for(const button of buttons)await button.dispose();}
   }
   closingUntil ||=Date.now()+900;
   if(Date.now()>=closingUntil)return{closed:false};
   // ElementHandle.press() focuses its element. Never use it for cleanup: after
   // a prior blur that focus may reopen the menu. Keyboard input goes only to
   // the actual current focused node, after checking that it is still ours.
   const activeHandle=await ownedActive();
   try{const active=activeHandle.asElement();if(active&&opened&&await active.evaluate((e,{target,menus})=>e.isConnected&&e===e.ownerDocument.activeElement&&(e===target||target.contains(e)||menus.some(menu=>menu.contains(e))),{target:target!,menus})){
     await valid();const frame=await target!.ownerFrame();
     if(frame&&await active.evaluate(e=>e===e.ownerDocument.activeElement))await frame.page().keyboard.press('Escape');
    }}finally{await activeHandle.dispose();}
   await blurOwnedActive();
   if(await waitClosed(Math.min(closingUntil,Date.now()+350))){opened=false;return{closed:true};}
   if(Date.now()<closingUntil){
    // Some popovers close only on a genuine outside click. Prefer the host's
    // observed caption; generated date-part suffixes are metadata, not another
    // field. With no context retain the legacy unique-caption-in-owner rule.
    const anchor=await scope!.evaluateHandle((owner,{target,menus,label})=>{
     const normalize=(text:string)=>text.replace(/\s+/g,' ').replace(/^[*＊\s]+|[*＊\s:：]+$/g,'').trim();
     const expected=normalize(label||''),base=normalize((label||'').split(' · ')[0]||'');
     const visible=(e:Element)=>{for(let p:Element|null=e;p;p=p.parentElement){const style=getComputedStyle(p);if((p as HTMLElement).hidden||p.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden')return false;}const r=e.getBoundingClientRect();return !!r.width&&!!r.height;};
     const candidates=(root:Element)=>Array.from(root.querySelectorAll('div,span,p,h1,h2,h3,h4,h5')).filter(e=>visible(e)&&e!==target&&!e.contains(target)&&!target.contains(e)&&!menus.some(menu=>menu.contains(e))&&!e.closest('label,button,a[href],[role="button"],[role="option"],[role="listbox"],[role="menu"]')&&!e.querySelector('input,textarea,select,button,a[href],[role="button"]')&&!e.hasAttribute('onclick')&&!(e as HTMLElement).onclick&&!(e as HTMLElement).isContentEditable&&(e as HTMLElement).tabIndex<0&&/[\p{L}\p{N}]/u.test(e.textContent??'')&&(e.textContent??'').trim().length<=180);
     for(let root:Element|null=owner,depth=0;root&&depth<(expected?5:1);root=root.parentElement,depth++){
      if(['BODY','HTML','FORM','MAIN'].includes(root.tagName))break;
      const all=candidates(root),exact=expected?all.filter(e=>normalize((e as HTMLElement).innerText||e.textContent||'')===expected):all;
      const matches=exact.length?exact:expected&&base!==expected?all.filter(e=>normalize((e as HTMLElement).innerText||e.textContent||'')===base):[];
      const unique=matches.filter(e=>!matches.some(parent=>parent!==e&&parent.contains(e)));
      if(unique.length===1)return unique[0];if(unique.length>1)return null;
      if(['FIELDSET','SECTION'].includes(root.tagName))break;
     }return null;
    },{target:target!,menus,label:context?.label??''});
    try{const element=anchor.asElement();if(element&&Date.now()<closingUntil){await valid();await element.click({timeout:Math.max(1,Math.min(200,closingUntil-Date.now()))}).catch(()=>{});}}finally{await anchor.dispose();}
   }
   const closed=await waitClosed(closingUntil);opened=!closed;return{closed};
  }catch{return{closed:false};}
 };
 const queryControl=async(waitForPopup=false):Promise<ElementHandle<Element>|null>=>{
  await valid();const direct=await target!.evaluateHandle(directQueryControl),element=direct.asElement();
  if(element)return element;await direct.dispose();
  const deadline=Date.now()+(waitForPopup?320:0);
  do{await refreshMenus();if(menus.length)break;if(Date.now()>=deadline)return null;await pause(60);}while(true);
  if(menus.length!==1)throw Error('UNIQUE_OWNED_MENU_REQUIRED');
  const handles=await menus[0]!.evaluateHandle(popupQueryControls),properties=await handles.getProperties(),inputs:ElementHandle<Element>[]=[];
  for(const[key,handle]of properties){const input=handle.asElement();if(/^\d+$/.test(key)&&input)inputs.push(input);else await handle.dispose();}await handles.dispose();
  if(inputs.length===1)return inputs[0]!;
  for(const input of inputs)await input.dispose();
  if(inputs.length>1)throw Error('OWNED_SEARCH_INPUT_AMBIGUOUS');return null;
 };
 const performQuery=async(value:string,control:ElementHandle<Element>):Promise<OwnedSelectRead>=>{
  await valid();const current=await queryControl();
  try{if(!current||!await current.evaluate((e,expected)=>e===expected,control))throw Object.assign(Error('OWNED_SELECT_CHANGED'),{controlDiagnostic:{stage:'query-control-replaced'}});}finally{await current?.dispose();}
  const before=await read();beginActivity(before,'query');
  closingUntil=0;popupBindingUntil=Date.now()+15000;await nativeAction('query',control,()=>control.fill(value,{timeout:2500}));opened=true;await valid();return await read();
 };
 const query=async(value:string):Promise<OwnedSelectRead>=>{
  let input:JSHandle<Element|null>|undefined;
  try{
   if(typeof value!=='string'||value.length>1000)throw Error('INVALID_SELECT_QUERY');await valid();
   input=await queryControl()??undefined;const control=input?.asElement();if(!control)throw Error('SELECT_NOT_SEARCHABLE');return await performQuery(value,control);
  }catch(error){await close();throw error;}finally{await input?.dispose();}
 };
 const open=async(value?:string):Promise<OwnedSelectRead>=>{
  try{await valid();closingUntil=0;const initial=await read();if(!initial.open&&await target!.evaluate(e=>e.tagName!=='SELECT')){
    beginActivity(initial,'open');
    // Open in the middle of the real viewport so fixed navigation bars do
    // not cover the option list. Scrolling cannot authorize a write.
    await target!.evaluate(element=>{
     element.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
     const r=element.getBoundingClientRect(),x=Math.max(1,Math.min(innerWidth-1,r.left+r.width/2));let cover=0;
     // Leave the full picker height below its trigger. Centering left only
     // half a viewport; scrolling its footer later could close the picker.
     for(const hit of document.elementsFromPoint(x,1))for(let p:Element|null=hit;p&&!['BODY','HTML'].includes(p.tagName);p=p.parentElement){const box=p.getBoundingClientRect(),style=getComputedStyle(p);if(['fixed','sticky'].includes(style.position)&&box.top<=1&&box.bottom>0&&box.height<innerHeight/2)cover=Math.max(cover,box.bottom);}
     const delta=r.top-cover-16;
     let scroller:Element|null=element.parentElement;while(scroller){const style=getComputedStyle(scroller);if(['auto','scroll'].includes(style.overflowY)&&scroller.scrollHeight>scroller.clientHeight+2)break;scroller=scroller.parentElement;}
     if(scroller)scroller.scrollBy(0,delta);else window.scrollBy(0,delta);
    });await valid();
    await popupBaseline?.dispose();popupBaseline=await target!.evaluateHandle(visibleMenusBefore);await boundPopup?.dispose();boundPopup=undefined;
    popupBindingUntil=Date.now()+2500;
    // Some single selects expose their search input for accessibility but put
    // the hit target on its one-control selector wrapper/HTML label. Do not force-click
    // the overlaid input or use that internal search box as a value field.
    const triggerHandle=await target!.evaluateHandle(e=>{const wrapper=e.closest('.ud__select__selector,label');return wrapper&&Array.from(wrapper.querySelectorAll('input,textarea,select')).length===1&&!wrapper.closest('a[href],button:not([type="button"])')?wrapper:e;});
    try{await nativeAction('open',triggerHandle.asElement()!,()=>triggerHandle.asElement()!.click({timeout:2500}));}finally{await triggerHandle.dispose();}opened=true;
   }else opened=true;
   if(value!==undefined){
    if(typeof value!=='string'||value.length>1000)throw Error('INVALID_SELECT_QUERY');
    // Search can remove a valid alias (本科 -> 学士) from an already opened
    // list. Prefer its observed exact/equivalent option before filtering it.
    let current=await read();for(let turn=0;!current.open&&turn<4;turn++){await pause(40);current=await read();}
    if(context?.label.replace(/[*＊]/g,'').trim()==='籍贯'&&menus.length===1){
     const menu=menus[0]!,geography=await menu.evaluate(element=>{const text=(element as HTMLElement).innerText;return text.includes('省份')&&text.includes('城市')&&text.includes('县区');});
     if(geography){const candidates=await menu.$$('button,[role="tab"],span,div'),tabs:ElementHandle<Element>[]=[];
      try{for(const candidate of candidates)if(await candidate.evaluate(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&((e as HTMLElement).innerText||'').trim()==='省份'&&!e.querySelector('input,textarea,select,a[href]')&&!Array.from(e.children).some(n=>((n as HTMLElement).innerText||'').trim()==='省份');}))tabs.push(candidate);
       if(tabs.length!==1)throw Error('GEOGRAPHY_TAB_NOT_UNIQUE');await valid();await nativeAction('geography-tab',tabs[0]!,()=>tabs[0]!.click({timeout:1200}));current=await read();
      }finally{for(const candidate of candidates)await candidate.dispose();}
     }
    }
    if(current.options.some(option=>option.aliases.some(label=>optionMatchesFact(label,value))))return current;
    const input=await queryControl(true);if(input)try{return await performQuery(value,input);}finally{await input.dispose();}
   }
   await valid();return await read();
  }catch(error){await close();throw error;}
 };
 // Only a change observed during the actual option-click dispatch (after its
 // capture phase, before any later cleanup/blur) can back a bare ARIA value.
 // A query's mousedown/blur change happens before click capture and is excluded.
 const clickWithNativeProof=async(clickTarget:ElementHandle<Element>,click:()=>Promise<unknown>):Promise<{value:string}|undefined>=>{
  const proof=await target!.evaluateHandle((e,clickTarget)=>{
   const input=(e.matches('input,textarea')?e:e.querySelector('input:not([type="hidden"]),textarea')) as HTMLInputElement|null;
   const label=input?.closest('label'),eligible=!!input&&(e.matches('[role="combobox"]')||input.matches('[role="combobox"]'))&&!label?.matches('label.select')&&!label?.querySelector('[class*="Input-display-value-"]')&&!input.closest('.month-range-select,.phoenix-select');
   const state={armed:false,changed:false,value:''};
   const start=(event:Event)=>{if(event.isTrusted)state.armed=true;};
   const change=(event:Event)=>{if(eligible&&state.armed&&event.target===input){state.changed=true;state.value=input!.value;}};
   if(eligible){clickTarget.addEventListener('click',start,true);input!.addEventListener('change',change,true);}
   return {state,dispose:()=>{clickTarget.removeEventListener('click',start,true);input?.removeEventListener('change',change,true);}};
  },clickTarget);
  try{await click();return await proof.evaluate(proof=>{proof.state.armed=false;return proof.state.changed?{value:proof.state.value}:undefined;});}
  finally{await proof.evaluate(proof=>proof.dispose()).catch(()=>{});await proof.dispose();}
 };
 const verifySelection=async(fact:OwnedSelectFact,nativeProof?:{value:string},observedAliases?:string[],checkUnchanged:()=>Promise<void>=async()=>{}):Promise<OwnedSelectCommit>=>{
  await valid();
  if(fact.kind==='applicationHometown'){
    await refreshMenus();if(menus.length===1){const menu=menus[0]!;
      const geography=await menu.evaluate(element=>{const text=(element as HTMLElement).innerText;return text.includes('省份')&&text.includes('城市')&&text.includes('县区');});
      if(geography){const buttons=await menu.$$('button,[role="button"]');try{const confirm:ElementHandle<Element>[]=[];for(const button of buttons)if(await button.evaluate(element=>element.isConnected&&(element as HTMLElement).innerText.trim()==='确认'&&!element.matches('button[type="submit"]')))confirm.push(button);if(confirm.length!==1)throw Error('GEOGRAPHY_CONFIRM_NOT_UNIQUE');await checkUnchanged();await valid();await nativeAction('geography-confirm',confirm[0]!,()=>confirm[0]!.click({timeout:1200}));}finally{for(const button of buttons)await button.dispose();}}
    }
  }
  const cleanup=await close();if(!cleanup.closed)throw Error('OWNED_SELECT_POPUP_NOT_CLOSED');
  const matches=(value:string)=>observedAliases?observedAliases.some(alias=>optionMatchesFact(value,alias)):ownedOptionMatches(fact,value);
  const deadline=Date.now()+1100;let first:OwnedSelectCommit|undefined;
  while(Date.now()<deadline){await valid();let committed=await target!.evaluate(readCommit);
   if(!committed.committed&&nativeProof){const native=await target!.evaluate(e=>{const input=e.matches('input,textarea')?e:e.querySelector('input:not([type="hidden"]),textarea');return input&&e.ownerDocument.activeElement!==input?(input as HTMLInputElement).value:'';});if(native===nativeProof.value&&native&&matches(native))committed={value:native,source:'selected-native-value',committed:true};}
   if(committed.committed&&matches(committed.value)){
    if(first&&first.source===committed.source&&first.value===committed.value)return committed;first=committed;await pause(150);
   }else{first=undefined;await pause(80);}
  }
  const targetShape=await target!.evaluate((e,value)=>{
   const input=e.matches('input,textarea')?e:e.querySelector('input,textarea'),owner=e.closest('.ud__select')||e.parentElement;
   const classes=(node:Element)=>Array.from(node.classList).filter(name=>/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(name)).slice(0,8);
   return {tag:e.tagName,role:e.getAttribute('role'),readOnly:!!(input as HTMLInputElement|null)?.readOnly,udSelect:!!e.closest('.ud__select'),classes:classes(e),markers:owner?Array.from(owner.querySelectorAll('*')).filter(node=>!node.querySelector('input,textarea')&&((node as HTMLElement).innerText||'').trim()===value).slice(0,12).map(node=>({tag:node.tagName,classes:classes(node)})):[]};
  },fact.value);
  throw Object.assign(Error('OWNED_SELECTION_NOT_COMMITTED'),{controlDiagnostic:{stage:'commit',targetShape}});
 };
 const clickCategory=async(option:ObservedOption,checkUnchanged:()=>Promise<void>)=>{
   if(!await option.node.evaluate(e=>e.matches('.list-item-container')&&!!e.closest('.constant-main-selector-container')))return false;
   const icon=await option.node.$('.icon-container');if(!icon)throw Error('OWNED_OPTION_REFERENCE_EXPIRED');
   const rootHandle=await option.node.evaluateHandle(e=>e.closest('.constant-main-selector-container')),root=rootHandle.asElement();if(!root)throw Object.assign(Error('OWNED_SELECT_CHANGED'),{controlDiagnostic:{stage:'category-root-disappeared'}});
   try{
    // Selecting a radio replaces its virtual row. Retain the stable picker
    // before clicking, instead of asking the detached old row for its parent.
    try{await valid();await checkUnchanged();await icon.click({timeout:2000});}finally{await icon.dispose();}
    const selected=await root.evaluate((e,label)=>{const count=e.querySelector('.select-data-num-text'),summary=e.querySelector('.select-data-container');return (count?.textContent??'').replace(/\s/g,'')==='1/'&&(summary as HTMLElement|null)?.innerText.trim()===label;},option.label);
    if(!selected)throw Error('OWNED_CATEGORY_NOT_SELECTED');
    const buttons=await root.$$('.selector-footer-button .phoenix-button'),confirm:ElementHandle<Element>[]=[];
    try{for(const button of buttons)if(await button.isVisible()&&await button.evaluate(e=>(e as HTMLElement).innerText.trim()==='确定'&&!e.closest('a[href],button[type="submit"],[aria-disabled="true"],.disabled')))confirm.push(button);
     if(confirm.length!==1)throw Error('OWNED_CATEGORY_CONFIRM_AMBIGUOUS');await checkUnchanged();await valid();await confirm[0]!.click({timeout:2000});
    }finally{for(const button of buttons)await button.dispose();}
   }finally{await rootHandle.dispose();}return true;
 };
 const chooseObserved=async(ref:string,checkUnchanged:()=>Promise<void>=async()=>{}):Promise<OwnedSelectCommit>=>{
  try{
   await valid();const option=options.find(option=>option.ref===ref);if(!option)throw Error('OWNED_OPTION_REFERENCE_EXPIRED');
   const observed=await option.node.evaluate((e,menu)=>{const button=e.closest('button'),native=e.tagName==='OPTION'&&menu.tagName==='SELECT',labelOwner=e.closest('label');return {valid:e.isConnected&&menu.isConnected&&menu.contains(e)&&!e.closest('a[href],[disabled],[aria-disabled="true"]')&&(native||(!labelOwner||!menu.contains(labelOwner))&&(!button||button===e&&e.matches('[role="option"][type="button"]'))),label:((e as HTMLElement).innerText||e.textContent||'').replace(/\s+/g,' ').trim()};},option.menu);
   if(!observed.valid||observed.label!==option.label)throw Object.assign(Error('OWNED_SELECT_CHANGED'),{controlDiagnostic:{stage:'option-snapshot',valid:observed.valid,labelMatches:observed.label===option.label}});
   const aliases=[...option.aliases];for(const label of option.aliases){const pair=/^(.+?)\s*\/\s*([A-Za-z][\s\S]*)$/u.exec(label);if(pair&&/[\u3400-\u9fff]/u.test(pair[1]!))aliases.push(pair[1]!.trim(),pair[2]!.trim());}
   await checkUnchanged();await valid();let nativeProof:{value:string}|undefined;
   if(await target!.evaluate(e=>e.tagName==='SELECT')){const value=await option.node.getAttribute('value');await target!.selectOption(value===null?{label:option.label}:{value});}
   else if(!await clickCategory(option,checkUnchanged)){
    const children=await option.node.$$('span,div'),exact:ElementHandle<Element>[]=[];
    for(const child of children)if(await child.isVisible()&&await child.evaluate((e,aliases)=>{const value=(e.textContent??'').trim();return aliases.includes(value)&&!Array.from(e.children).some(child=>(child.textContent??'').trim()===value);},aliases))exact.push(child);
    try{const clickTarget=exact.length===1?exact[0]!:option.node;nativeProof=await clickWithNativeProof(option.node,()=>nativeAction('choose',clickTarget,()=>clickTarget.click({timeout:2500})));}finally{for(const child of children)await child.dispose();}
   }
   return await verifySelection({kind:'observed-option',value:option.label},nativeProof,aliases,checkUnchanged);
  }finally{await close();}
 };
 const choose=async(ref:string,fact:OwnedSelectFact,checkUnchanged:()=>Promise<void>=async()=>{}):Promise<OwnedSelectCommit>=>{
  try{
   await valid();let option=options.find(o=>o.ref===ref);if(!option)throw Error('OWNED_OPTION_REFERENCE_EXPIRED');
   if(!option.aliases.some(label=>ownedOptionMatches(fact,label)))throw Error('OPTION_FACT_MISMATCH');
   for(let refresh=0;refresh<2;refresh++){
    const observed=await option.node.evaluate((e,menu)=>{const button=e.closest('button'),native=e.tagName==='OPTION'&&menu.tagName==='SELECT',labelOwner=e.closest('label');return {valid:e.isConnected&&menu.isConnected&&menu.contains(e)&&!e.closest('a[href],[disabled],[aria-disabled="true"]')&&(native||(!labelOwner||!menu.contains(labelOwner))&&(!button||button===e&&e.matches('[role="option"][type="button"]'))),label:((e as HTMLElement).innerText||e.textContent||'').replace(/\s+/g,' ').trim()};},option.menu);
    if(observed.valid&&observed.label===option.label)break;
    if(refresh)throw Object.assign(Error('OWNED_SELECT_CHANGED'),{controlDiagnostic:{stage:'option-snapshot',refreshExhausted:true}});
    // No click has happened: refresh once inside the same still-bound control.
    // Never repeat an attempted click or bypass unknown-write protection.
    await checkUnchanged();await valid();const next=await waitForOptions(fact),matches=next.options.filter(entry=>entry.aliases.some(label=>ownedOptionMatches(fact,label)));
    if(matches.length!==1)throw Error(matches.length?'OWNED_OPTION_AMBIGUOUS':'OWNED_OPTION_NOT_FOUND');option=options.find(entry=>entry.ref===matches[0]!.ref)!;
   }
   await checkUnchanged();await valid();
   let nativeProof:{value:string}|undefined;
   if(await target!.evaluate(e=>e.tagName==='SELECT')){
    const value=await option.node.getAttribute('value');await target!.selectOption(value===null?{label:option.label}:{value});
   }else if(!await clickCategory(option,checkUnchanged)){
    const children=await option.node.$$('span,div'),exact:ElementHandle<Element>[]=[];
    for(const child of children)if(await child.isVisible()&&await child.evaluate((e,value)=>(e.textContent??'').trim()===value&&!Array.from(e.children).some(c=>(c.textContent??'').trim()===value),fact.value.trim()))exact.push(child);
    try{const clickTarget=exact.length===1?exact[0]!:option.node;nativeProof=await clickWithNativeProof(option.node,()=>nativeAction('choose',clickTarget,()=>clickTarget.click({timeout:2500})));}finally{for(const child of children)await child.dispose();}
   }
   return await verifySelection(fact,nativeProof,undefined,checkUnchanged);
  }finally{await close();}
 };
 const choosePath=async(labels:string[],checkUnchanged:()=>Promise<void>=async()=>{}):Promise<OwnedSelectCommit>=>{
  if(!labels.length||labels.length>4)throw Error('INVALID_SELECTION_PATH');
  let pathInteracted=false;try{
  for(let index=0;index<labels.length;index++){
    const until=Date.now()+900;let snapshot=await read(),matched=snapshot.options.filter(option=>option.aliases.some(label=>optionMatchesFact(label,labels[index]!)));
    while(!matched.length&&Date.now()<until){await pause(50);snapshot=await read();matched=snapshot.options.filter(option=>option.aliases.some(label=>optionMatchesFact(label,labels[index]!)));}
    if(matched.length!==1)throw Error('OBSERVED_PATH_NOT_UNIQUE');
    if(index===labels.length-1){pathInteracted=true;return await chooseObserved(matched[0]!.ref,checkUnchanged);}
    const parent=options.find(option=>option.ref===matched[0]!.ref);if(!parent)throw Error('OBSERVED_OPTION_REQUIRED');await checkUnchanged();await valid();
    pathInteracted=true;await parent.node.click({timeout:1200});await pause(50);
  }
  throw Error('OBSERVED_PATH_NOT_COMMITTED');
  }catch(error){if(error instanceof Error)Object.assign(error,{pathInteracted});throw error;}
 };
 const create=async(fact:OwnedSelectFact,checkUnchanged:()=>Promise<void>=async()=>{}):Promise<OwnedSelectCommit>=>{
  let createStage='entry';
  try{
   await valid();const preflight=await read();
   if(!preflight.canCreate&&!preflight.options.some(option=>option.aliases.some(label=>ownedOptionMatches(fact,label)))){
    if(preflight.loading||queryActivity?.pending.size)throw Error('OWNED_OPTIONS_NOT_SETTLED');
    throw Error('EXPLICIT_CREATE_OPTION_REQUIRED');
   }
   const initialQuery=await target!.evaluate(e=>{const input=e.matches('input,textarea')?e:e.querySelector('input:not([type="hidden"]),textarea');return input?(input as HTMLInputElement).value:null;});
   if(initialQuery!==fact.value)throw Error('CREATE_QUERY_FACT_MISMATCH');
   const settled=await waitForOptions(fact,15000,true);
   const existing=settled.options.filter(option=>option.aliases.some(label=>ownedOptionMatches(fact,label)));
   if(existing.length===1)return await choose(existing[0]!.ref,fact,checkUnchanged);
   await valid();const entry=createEntry;if(!entry)throw Error('EXPLICIT_CREATE_OPTION_REQUIRED');
   const query=await target!.evaluate(e=>{const input=e.matches('input,textarea')?e:e.querySelector('input:not([type="hidden"]),textarea');return input?(input as HTMLInputElement).value:null;});
   if(query!==fact.value)throw Error('CREATE_QUERY_FACT_MISMATCH');
   const expectedLabel=entry.label;
   await checkUnchanged();await valid();
   // Search results can replace their footer during the independent form read.
   // Re-observe the one explicit create entry before dispatch; never retry an
   // unknown click or retain a detached footer handle as an operation target.
   createStage='entry-refresh';let freshEntry:CreateEntry|undefined;const refreshUntil=Date.now()+1200;let refreshed:OwnedSelectRead;
   do{
    refreshed=await read();
    const queryRetained=await target!.evaluate((e,value)=>{const input=e.matches('input,textarea')?e:e.querySelector('input:not([type="hidden"]),textarea');return input&&(input as HTMLInputElement).value===value;},fact.value);
    if(!queryRetained)throw Error('CREATE_QUERY_FACT_MISMATCH');
    const exact=refreshed.options.filter(option=>option.aliases.some(label=>ownedOptionMatches(fact,label)));
    if(exact.length===1)return await choose(exact[0]!.ref,fact,checkUnchanged);
    if(exact.length>1)throw Error('OWNED_OPTION_AMBIGUOUS');
    const current=createEntry;
    if(current&&current.label===expectedLabel&&await current.node.evaluate((e,menu)=>e.isConnected&&menu.isConnected&&menu.contains(e),current.menu)){freshEntry=current;break;}
    if(!refreshed.open||Date.now()>=refreshUntil)throw Object.assign(Error('OWNED_SELECT_CHANGED'),{controlDiagnostic:{stage:'create-entry-refresh',hasEntry:!!current,labelMatches:current?.label===expectedLabel,open:refreshed.open,optionCount:refreshed.options.length,menuCount:menus.length}});
    await pause(60);
   }while(true);
   createStage='entry-click';await nativeAction('create-open',freshEntry.node,async()=>{
    const frame=await freshEntry.node.ownerFrame();if(!frame||frame.parentFrame())throw Error('OWNED_ACTION_NOT_REACHABLE');
    // ElementHandle.click may scroll the popup before dispatch and thereby
    // unmount it. Use a native pointer click only after the actual button is
    // visible and its own centre wins the hit test. Never force or dispatch JS.
    const point=await freshEntry.node.evaluate(e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=e.ownerDocument.elementFromPoint(x,y);return e.isConnected&&r.width>0&&r.height>0&&x>0&&x<innerWidth&&y>0&&y<innerHeight&&!!hit&&(hit===e||e.contains(hit))?{x,y}:null;});
    if(!point)throw Error('OWNED_ACTION_NOT_REACHABLE');await guard();await frame.page().mouse.click(point.x,point.y);
   });
   const deadline=Date.now()+2000;
   while(Date.now()<deadline){createStage='subform-inspect';await valid();await refreshMenus();
    if(menus.length!==1){await pause(60);continue;}
    const menu=menus[0]!,inputs=await menu.$$('input,textarea,select'),editable:ElementHandle<Element>[]=[];
    for(const input of inputs)if(await input.isVisible()&&await input.evaluate((e,target)=>e!==target&&e.matches('input[type="text"],input[type="search"],input:not([type])')&&!(e as HTMLInputElement).readOnly&&!(e as HTMLInputElement).disabled&&!e.closest('a[href]'),target!))editable.push(input);
    const buttons=await menu.$$('button[type="button"],[role="button"]'),add:ElementHandle<Element>[]=[];
    for(const button of buttons){const label=await button.textContent();if(label&&createConfirmLabel.test(label.trim())&&await button.isVisible()&&await button.evaluate(e=>!e.closest('a[href]')&&!(e.tagName==='BUTTON'&&(e as HTMLButtonElement).type!=='button')&&!e.matches('[disabled],[aria-disabled="true"]')))add.push(button);}
    try{
     if(editable.length===1){
      if(await editable[0]!.inputValue()!==fact.value){createStage='subform-query';await valid();await nativeAction('create-query',editable[0]!,()=>editable[0]!.fill(fact.value,{timeout:2500}));continue;}
      if(add.length!==1)continue;
      // Filling can replace both input and enabled confirm button. This loop
      // re-reads their current owner instead of clicking the pre-fill handle.
      createStage='subform-confirm';await valid();
      if(!await editable[0]!.evaluate((e,menu)=>e.isConnected&&menu.isConnected&&menu.contains(e),menu)||!await add[0]!.evaluate((e,menu)=>e.isConnected&&menu.isConnected&&menu.contains(e),menu))continue;
      const nativeProof=await clickWithNativeProof(add[0]!,()=>nativeAction('create-confirm',add[0]!,()=>add[0]!.click({timeout:2500})));createStage='commit';return await verifySelection(fact,nativeProof,undefined,checkUnchanged);
     }
    }finally{for(const handle of inputs)await handle.dispose();for(const handle of buttons)await handle.dispose();}
    await pause(60);
   }
   throw Error('CREATE_OPTION_SUBFORM_UNPROVEN');
  }catch(error){if(error instanceof Error&&!(error as any).controlDiagnostic)Object.assign(error,{controlDiagnostic:{stage:'create-'+createStage,menuCount:menus.length}});throw error;}finally{await close();}
 };
 const scroll=async(direction:'up'|'down'):Promise<OwnedSelectRead>=>{
  if(direction!=='up'&&direction!=='down')throw Error('INVALID_SCROLL_DIRECTION');await valid();await refreshMenus();
  if(menus.length!==1)throw Error('UNIQUE_OWNED_MENU_REQUIRED');
  const before=options.map(option=>option.label).join('|');
  await menus[0]!.evaluate((menu,sign)=>{const category=menu.matches('.constant-main-selector-container')?menu:menu.querySelector('.constant-main-selector-container'),root=category?.querySelector('.left-container .list-data-container')??menu;const candidates=[root,...root.querySelectorAll('*')].filter(e=>!e.closest('.resize-triggers')&&e.clientHeight>0&&e.scrollHeight>e.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(e).overflowY));if(candidates.length!==1)throw Error('UNIQUE_SCROLL_CONTAINER_REQUIRED');candidates[0]!.scrollBy(0,sign*300);},direction==='down'?1:-1);
  const until=Date.now()+500;let result:OwnedSelectRead;
  do{await pause(60);result=await read();if(result.options.map(option=>option.label).join('|')!==before)break;}while(Date.now()<until);
  return result;
 };
 // Experimental callers may explore tabs, but only inside the already bound
 // popup. No page-wide buttons, selectors, coordinates or confirm actions.
 let navigation:Array<OwnedSelectNavigation&{node:ElementHandle<Element>;menu:ElementHandle<Element>}>=[];
 const clearNavigation=async()=>{for(const entry of navigation){await entry.node.dispose();await entry.menu.dispose();}navigation=[];};
 const navigationState=(e:Element,menu:Element)=>{
  const box=e.getBoundingClientRect(),label=(e.getAttribute('aria-label')||(e as HTMLElement).innerText||'').replace(/\s+/g,' ').trim();
  const panelId=e.getAttribute('aria-controls'),panel=panelId&&e.ownerDocument.getElementById(panelId);
  const safe=e.isConnected&&menu.isConnected&&menu.contains(e)&&e.getAttribute('role')==='tab'&&!!panel&&menu.contains(panel)&&Array.from(e.ownerDocument.querySelectorAll('[id]')).filter(node=>node.id===panelId).length===1&&box.width>0&&box.height>0&&!e.closest('a[href],[disabled],[aria-disabled="true"]')&&!e.querySelector('a[href],button,input,textarea,select,[role="button"]')&&!(e.tagName==='BUTTON'&&(e as HTMLButtonElement).type!=='button')&&label.length>0&&label.length<=80&&!/提交|投递|发送|支付|删除|同意|声明|隐私|协议|submit|apply|send|delete|remove|agree|consent|privacy/i.test(label);
  return{safe,label,selected:e.getAttribute('aria-selected')==='true'};
 };
 const inspectNavigation=async():Promise<OwnedSelectNavigation[]>=>{
  await clearNavigation();await refreshMenus();
  if(menus.length!==1)return [];
  const menu=menus[0]!;
  const nodes=await menu.$$('[role="tab"]');
  for(const node of nodes){
   if(navigation.length>=30){await node.dispose();continue;}
   const state=await node.evaluate(navigationState,menu);
   if(state.safe){const ownedMenu=(await menu.evaluateHandle(e=>e)).asElement()!;navigation.push({ref:await reference(node,'navigation'),role:'tab',label:state.label,selected:state.selected,node,menu:ownedMenu});}else await node.dispose();
  }
  return navigation.map(({node,menu,...entry})=>entry);
 };
 const navigate=async(ref:string,checkUnchanged:()=>Promise<void>)=>{
  await valid();const entry=navigation.find(entry=>entry.ref===ref);if(!entry)throw Error('OWNED_NAVIGATION_EXPIRED');
  const state=await entry.node.evaluate(navigationState,entry.menu);
  if(!state.safe||state.label!==entry.label||state.selected)throw Error('OWNED_NAVIGATION_CHANGED');
  const before=await target!.evaluate(readCommit);await checkUnchanged();await valid();
  await nativeAction('navigate-tab',entry.node,()=>entry.node.click({timeout:2000}));
  await valid();await checkUnchanged();const after=await target!.evaluate(readCommit);
  if(after.value!==before.value||after.committed!==before.committed)throw Error('NAVIGATION_CHANGED_VALUE');
  await clearNavigation();
 };
 return {open,query,read,waitForOptions,inspectNavigation,navigate,choose,chooseObserved,choosePath,create,scroll,close,dispose:async()=>{if(disposed)return;try{await close();}finally{disposed=true;ownerPage?.off('request',onRequest);ownerPage?.off('response',onResponse);ownerPage?.off('requestfinished',finishRequest);ownerPage?.off('requestfailed',finishRequest);await clearNavigation();await disposeOptions();await popupBaseline?.dispose();await boundPopup?.dispose();await identityRegistry.dispose();await scope!.dispose();await target!.dispose();}}};
}

/** Compatibility entry point used by group filling; the same engine backs the
 * model's inspect/open/query/choose/close path, so a new field needs no adapter.
 */
export async function fillOwnedSelect(node:Locator,fact:ApplicationFact,guard:()=>Promise<void>,checkUnchanged:()=>Promise<void>):Promise<void>{
 const controller=await createOwnedSelectController(node,guard);
 try{
  await controller.open(fact.value);const snapshot=await controller.waitForOptions(fact);
  {const matches=snapshot.options.filter(o=>o.aliases.some(label=>ownedOptionMatches(fact,label)));
   if(matches.length>1)throw Error('OWNED_OPTION_AMBIGUOUS');
   if(matches.length===1){await controller.choose(matches[0]!.ref,fact,checkUnchanged);return;}
   if(snapshot.canCreate){await controller.create(fact,checkUnchanged);return;}throw Error('OWNED_OPTION_NOT_FOUND');
  }
 }finally{await controller.dispose();}
}
