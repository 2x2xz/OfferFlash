import type {Locator,ElementHandle} from 'playwright-core';
import {OWNED_SELECT_HELPERS} from './select-shape.js';
import {DIV_CALENDAR_HELPERS} from './calendar-shape.js';

const calendarTables=new Function('root',OWNED_SELECT_HELPERS+String.raw`
 return Array.from(root.querySelectorAll('table,[role="grid"]')).filter(selectVisible).filter(table=>{
 const cells=Array.from(table.querySelectorAll('td,[role="gridcell"]')).filter(selectVisible).map(selectText);
 return cells.length>=4&&cells.length<=49&&cells.filter(t=>/^\d{1,4}(?:月|年)?$/.test(t)).length>=4;
 });`) as (root:Element)=>Element[];
const visibleCalendarRoots=new Function('root',OWNED_SELECT_HELPERS+DIV_CALENDAR_HELPERS+String.raw`
 const tables=Array.from(root.querySelectorAll('table,[role="grid"]')).filter(selectVisible),roots=[];
 for(const table of tables){const cells=Array.from(table.querySelectorAll('td,[role="gridcell"]')).filter(selectVisible).map(selectText);if(cells.length<4||cells.length>49||cells.filter(t=>/^\d{1,4}(?:月|年)?$/.test(t)).length<4)continue;
 let popup=null;for(let p=table.parentElement,d=0;p&&d<16;p=p.parentElement,d++){if(['BODY','HTML','FORM','MAIN'].includes(p.tagName))break;
 // Year/month/day panels can be independently positioned. Keep their shared
 // rendered popup, so switching panel does not look like closing the calendar.
 if(['absolute','fixed'].includes(getComputedStyle(p).position)&&selectVisible(p)&&selectText(p).length<4000&&!p.querySelector('input[type="password"],input[type="file"],button[type="submit"]'))popup=p;}if(popup)roots.push(popup);
 }roots.push(...divCalendarRoots(root));return Array.from(new Set(roots)).filter(n=>!roots.some(parent=>parent!==n&&parent.contains(n)));`) as (root:Element)=>Element[];
const divGrid=new Function('root',OWNED_SELECT_HELPERS+DIV_CALENDAR_HELPERS+'return divCalendarGrid(root);') as (root:Element)=>{mode:string;cells:Element[];header?:Element}|null;
const stamp=(element:Element)=>({tag:element.tagName,id:element.id,type:element.getAttribute('type'),role:element.getAttribute('role')});
const label=(element:Element)=>{
 const text=(element as HTMLElement).innerText||element.textContent||element.getAttribute('aria-label')||element.getAttribute('aria-valuetext')||element.getAttribute('title')||('value'in element?String(element.value):'');
 return text.replace(/[\uE000-\uF8FF]/g,'').replace(/\s+/g,' ').trim().replace(/^(\d{4}|\d{1,2})\s+(年|月)$/,'$1$2');
};
const navigationDirection=(text:string)=>/^(?:(?:previous|prev)(?:\s+(?:year|month|decade|page))?|上(?:一)?(?:年|月|页)|前(?:一)?(?:年|月|页))$/i.test(text)?'previous':/^(?:next(?:\s+(?:year|month|decade|page))?|下(?:一)?(?:年|月|页)|后(?:一)?(?:年|月|页))$/i.test(text)?'next':undefined;
const calendarVisible=new Function('e',OWNED_SELECT_HELPERS+'return selectVisible(e);') as (e:Element)=>boolean;
const pause=()=>new Promise(resolve=>setTimeout(resolve,70));

/** Date-only transaction. The host supplies an exact confirmed date, never a
 * model-generated selector or date. Calendar navigation is bounded and every
 * click is on a current, uniquely observed control inside the opened calendar. */
export async function fillOwnedCalendar(node:Locator,value:string,guard:()=>Promise<void>,checkUnchanged:()=>Promise<void>):Promise<{value:string;source:'calendar-marker';committed:true}>{
 const present=value==='至今',parts=/^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);if(!parts&&!present)throw Error('DATE_PRECISION_MISSING');
 const year=present?2000:Number(parts![1]),month=present?1:Number(parts![2]),day=parts?.[3]?Number(parts[3]):undefined;
 if(year<1900||year>2100||month<1||month>12||day!==undefined&&(day<1||new Date(Date.UTC(year,month,0)).getUTCDate()<day))throw Error('DATE_PRECISION_MISSING');
 const page=node.page(),target=await node.elementHandle();if(!target)throw Error('FIELD_DISAPPEARED');
 const signature=await target.evaluate(stamp),before=await page.locator('body').evaluateHandle(visibleCalendarRoots),url=page.url();let popup:ElementHandle<Element>|undefined,committed=false,selectionAttempted=false,diagnostic:Record<string,unknown>={stage:'open'};
 const safeContext=async()=>{await guard();if(page.url()!==url||!await target.evaluate((e,s)=>e.isConnected&&e.tagName===s.tag&&e.id===s.id&&e.getAttribute('type')===s.type&&e.getAttribute('role')===s.role,signature))throw Error('APPLICATION_CONTEXT_CHANGED:calendar');};
 const safe=async()=>{await safeContext();await checkUnchanged();};
 const click=async(element:ElementHandle<Element>)=>{await safe();if(!await element.isVisible()||await element.evaluate(e=>{const button=e.closest('button');return !!e.closest('a[href],[disabled],[aria-disabled="true"],.disabled,[class*="disabled" i]')||!!button&&button.type==='submit'&&!!button.form;}))throw Error('CALENDAR_CONTROL_DISABLED');await element.click({timeout:2000});await pause();await safe();};
 const navFor=async(buttons:ElementHandle<Element>[],direction:'previous'|'next')=>{const labels=await Promise.all(buttons.map(button=>button.evaluate(label))),matches=buttons.filter((_button,index)=>navigationDirection(labels[index]!)===direction);if(matches.length===1)return matches[0]!;if(buttons.length===2&&labels.every(text=>!text))return buttons[direction==='previous'?0:1]!;throw Error('CALENDAR_NAVIGATION_AMBIGUOUS');};
 try{
  if(!present&&day===undefined&&await target.evaluate(element=>/年月日|yyyy\s*[-/.年]\s*mm\s*[-/.月]\s*dd/i.test(element.getAttribute('placeholder')??'')))throw Error('CALENDAR_PRECISION_UNSUPPORTED');
  await safe();if(await target.evaluate(e=>!!e.closest('a[href],button:not([type="button"])')))throw Error('UNSAFE_CALENDAR_TARGET');await target.click({timeout:2000});
  for(let i=0;i<8;i++){await safe();const roots=await page.locator('body').evaluateHandle(visibleCalendarRoots);const fresh=await roots.evaluateHandle((nodes,old)=>nodes.filter(node=>!old.includes(node)),before);const properties=await fresh.getProperties();const candidates=[...properties.values()].map(h=>h.asElement()).filter((h):h is ElementHandle<Element>=>!!h);
   if(candidates.length===1)popup=candidates[0];else for(const candidate of candidates)await candidate.dispose();await roots.dispose();if(popup)break;await fresh.dispose();await pause();}
  if(!popup)throw Error('CALENDAR_NOT_FOUND');
  const calendarOpen=async()=>!!popup&&(await popup.evaluate(calendarTables).then(tables=>tables.length>0)||!!await popup.evaluate(divGrid));
  const until=Date.now()+8000;
  for(let turn=0;turn<40&&Date.now()<until;turn++){
   await safe();if(!await calendarOpen())break;
   if(present){
    const presentHandle=await popup.evaluateHandle(root=>Array.from(root.querySelectorAll('div,span,button,[role="option"]')).filter(node=>{const text=(node as HTMLElement).innerText?.trim(),r=node.getBoundingClientRect();return !!r.width&&!!r.height&&/^(?:至今|present)$/i.test(text||'')&&!Array.from(node.children).some(child=>(child as HTMLElement).innerText?.trim()===text)&&!node.closest('[disabled],[aria-disabled="true"]');}));
    const properties=await presentHandle.getProperties(),matches=[...properties.values()].map(handle=>handle.asElement()).filter((handle):handle is ElementHandle<Element>=>!!handle);
    try{if(matches.length!==1)throw Error('CALENDAR_MONTH_NOT_FOUND');selectionAttempted=true;await click(matches[0]!);break;}
    finally{for(const element of matches)await element.dispose();await presentHandle.dispose();}
   }
   // A table-based year grid also contains numeric div/span descendants.
   // Keep it on the table path; the div-only adapter has a different header.
   const numeric=(await popup.evaluate(calendarTables)).length?null:await popup.evaluate(divGrid).then(grid=>grid?{mode:grid.mode,values:grid.cells.map(()=>0)}:null);
   if(numeric){
    diagnostic={stage:'numeric-grid',mode:numeric.mode,cells:numeric.values.length};
    const grid=await popup.evaluateHandle(divGrid),cellsHandle=await grid.evaluateHandle(grid=>grid!.cells),properties=await cellsHandle.getProperties();
    const cells=[...properties.values()].map(handle=>handle.asElement()).filter((handle):handle is ElementHandle<Element>=>!!handle);
    try{
     if(numeric.mode==='month'){
      const headerHandle=await grid.evaluateHandle(grid=>grid!.header!),header=headerHandle.asElement();
      if(!header)throw Error('CALENDAR_HEADER_UNAVAILABLE');
      try{const current=Number((await header.evaluate(label)).replace('年',''));
       if(current!==year){await click(header);continue;}
      }finally{await headerHandle.dispose();}
      if(day!==undefined)throw Error('CALENDAR_PRECISION_UNSUPPORTED');
      const matches=[];for(const cell of cells)if(Number((await cell.evaluate(label)).replace('月',''))===month)matches.push(cell);
      if(matches.length!==1)throw Error('CALENDAR_MONTH_AMBIGUOUS');selectionAttempted=true;await click(matches[0]!);break;
     }
     const matches=[];for(const cell of cells)if(Number((await cell.evaluate(label)).replace('年',''))===year)matches.push(cell);
     if(matches.length===1){await click(matches[0]!);continue;}
     const years=await Promise.all(cells.map(async cell=>Number((await cell.evaluate(label)).replace('年',''))));
     const buttons=await popup.$$('button,[role="button"]'),nav=[];
     try{for(const button of buttons)if(await button.evaluate(calendarVisible)){const text=await button.evaluate(label);if(!text||navigationDirection(text))nav.push(button);}
      if(nav.length!==2)throw Error('CALENDAR_NAVIGATION_AMBIGUOUS');await click(await navFor(nav,year<Math.min(...years)?'previous':'next'));
     }finally{for(const button of buttons)await button.dispose();}
     continue;
    }finally{for(const cell of cells)await cell.dispose();await cellsHandle.dispose();await grid.dispose();}
   }

   const handle=await popup.evaluateHandle(calendarTables),properties=await handle.getProperties(),renderedTables=[...properties.values()].map(h=>h.asElement()).filter((h):h is ElementHandle<Element>=>!!h);await handle.dispose();
   const tables:ElementHandle<Element>[]=[];
   for(const table of renderedTables){
    // Some calendars overlay their year/month grid on the still rendered day
    // table. The active grid must actually receive a hit at its visible centre.
    if(await table.evaluate(e=>{const r=e.getBoundingClientRect(),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);if(right<=left||bottom<=top)return false;const hit=e.ownerDocument.elementFromPoint((left+right)/2,(top+bottom)/2);return !!hit&&(hit===e||e.contains(hit));}))tables.push(table);else await table.dispose();
   }
   diagnostic={...diagnostic,renderedGrids:renderedTables.length,activeGrids:tables.length};
   if(tables.length!==1){for(const table of tables)await table.dispose();throw Error('CALENDAR_GRID_AMBIGUOUS');}
   const table=tables[0]!,texts=await table.$$eval('td,[role="gridcell"]',cells=>cells.map(e=>(e.textContent??'').replace(/\s+/g,' ').trim()));
   const mode=texts.filter(text=>/^\d{4}年?$/.test(text)).length>=4?'year':texts.filter(text=>/^(?:[1-9]|1[0-2])月$/.test(text)).length>=4?'month':'day';
   if(mode==='day'&&day===undefined){await table.dispose();throw Error('CALENDAR_PRECISION_UNSUPPORTED');}
   const paneHandle=await table.evaluateHandle(new Function('e',OWNED_SELECT_HELPERS+`for(let p=e.parentElement,d=0;p&&d<16;p=p.parentElement,d++){if(['BODY','HTML','FORM','MAIN'].includes(p.tagName))break;const headers=Array.from(p.querySelectorAll('button,[role="button"]')).filter(n=>selectVisible(n)&&!e.contains(n));if(headers.some(n=>/^\\d{4}(?:年|\\s*[-–]\\s*\\d{4})?$/.test(selectText(n)))&&Array.from(p.querySelectorAll('table,[role="grid"]')).filter(selectVisible).length===1)return p;}return null;`) as (e:Element)=>Element|null),pane=paneHandle.asElement();if(!pane){await table.dispose();await paneHandle.dispose();throw Error('CALENDAR_HEADER_UNAVAILABLE');}
   try{
    const cells=await table.$$('td,[role="gridcell"]'),buttons=await pane.$$('button,[role="button"]').then(async handles=>{const headers=[];for(const handle of handles){if(await handle.evaluate(calendarVisible)&&await handle.evaluate((e,t)=>!t.contains(e),table))headers.push(handle);else await handle.dispose();}return headers;});
    const cellFor=async(pattern:RegExp)=>{const matches:ElementHandle<Element>[]=[];for(const cell of cells)if(await cell.isVisible()&&pattern.test(await cell.evaluate(label))&&!await cell.evaluate(e=>!!e.closest('[disabled],[aria-disabled="true"],[class*="disabled" i],[class*="other-month" i],[class*="outside" i]')))matches.push(cell);return matches.length===1?matches[0]:undefined;};
    const yearButtons:ElementHandle<Element>[]=[];for(const button of buttons)if(await button.isVisible()&&/^\d{4}年?$/.test(await button.evaluate(label)))yearButtons.push(button);
    diagnostic={stage:'navigate',mode,headerButtons:buttons.length,yearButtons:yearButtons.length,cells:cells.length,headerKinds:await Promise.all(buttons.map(async b=>{const t=await b.evaluate(label);return /^\d{4}年?$/.test(t)?'year':/^\d{4}\s*[-–]\s*\d{4}$/.test(t)?'range':/^\d{1,2}月$/.test(t)?'month':!t?'icon':'other';}))};
    if(yearButtons.length>1){const plain=[];for(const button of yearButtons)if(/^\d{4}$/.test(await button.evaluate(label)))plain.push(button);if(plain.length===1)yearButtons.splice(0,yearButtons.length,plain[0]!);}
    if(mode==='year'){
     const exact=await cellFor(new RegExp('^'+year+'年?$'));if(exact){await click(exact);continue;}
     const years=texts.filter(text=>/^\d{4}年?$/.test(text)).map(text=>Number(text.replace('年',''))),direction=year<Math.min(...years)?'previous':'next';
     let nav:ElementHandle<Element>[]=[];const rangeButtons=[];for(const button of buttons)if(await button.isVisible()&&/^\d{4}\s*[-–]\s*\d{4}$/.test(await button.evaluate(label)))rangeButtons.push(button);if(rangeButtons.length===1){const header=await rangeButtons[0]!.evaluateHandle(e=>{for(let p=e.parentElement,d=0;p&&d<5;p=p.parentElement,d++){const visible=(n:Element)=>{const r=n.getBoundingClientRect();return !!r.width&&!!r.height&&getComputedStyle(n).visibility!=='hidden'};if(Array.from(p.querySelectorAll('button,[role="button"]')).filter(visible).filter(b=>!(b.textContent??'').trim()).length===2)return p;}return null;});const h=header.asElement();if(h)nav=await h.$$('button,[role="button"]');await header.dispose();nav=await Promise.all(nav.map(async button=>await button.isVisible()&&((text:string)=>!text||!!navigationDirection(text))(await button.evaluate(label))?button:null)).then(xs=>xs.filter((x):x is ElementHandle<Element>=>!!x));}else for(const button of buttons)if(await button.isVisible()){const text=await button.evaluate(label);if(!text||navigationDirection(text))nav.push(button);}if(nav.length!==2)throw Error('CALENDAR_NAVIGATION_AMBIGUOUS');await click(await navFor(nav,direction));continue;
    }
    const currentYear=yearButtons.length===1?Number((await yearButtons[0]!.evaluate(label)).replace('年','')):undefined;
    if(currentYear!==year){if(yearButtons.length!==1)throw Error('CALENDAR_YEAR_AMBIGUOUS');await click(yearButtons[0]!);continue;}
    if(mode==='month'){
     const exact=await cellFor(new RegExp('^'+month+'月$'));if(!exact)throw Error('CALENDAR_MONTH_NOT_FOUND');if(day===undefined)selectionAttempted=true;await click(exact);if(day===undefined)break;continue;
    }
    if(day===undefined)throw Error('CALENDAR_PRECISION_UNSUPPORTED');
    const monthButtons=[];for(const button of buttons)if(await button.isVisible()&&/^(?:[1-9]|1[0-2])月$/.test(await button.evaluate(label)))monthButtons.push(button);
    if(monthButtons.length!==1)throw Error('CALENDAR_MONTH_AMBIGUOUS');
    if(Number((await monthButtons[0]!.evaluate(label)).replace('月',''))!==month){await click(monthButtons[0]!);continue;}
    let exact=await cellFor(new RegExp('^'+day+'$'));
    if(!exact){
     const length=new Date(Date.UTC(year,month,0)).getUTCDate(),starts:number[]=[];
     for(let start=0;start+length<=texts.length;start++)if(Array.from({length},(_,offset)=>texts[start+offset]===String(offset+1)).every(Boolean))starts.push(start);
     if(starts.length===1)exact=cells[starts[0]!+day-1];
    }
    if(!exact)throw Error('CALENDAR_DAY_NOT_FOUND');selectionAttempted=true;await click(exact);break;
   }finally{await paneHandle.dispose();await table.dispose();}
  }
  await target.evaluate(e=>{if(e===e.ownerDocument.activeElement)(e as HTMLElement).blur();});
  for(let check=0;check<10;check++){await safe();const actual=await target.evaluate(new Function('e',OWNED_SELECT_HELPERS+"const selected=selectCommitted(e);if(!selected.committed&&e.matches('input')&&e.value)return {value:e.value,committed:true};return selected;") as (e:Element)=>{value:string;committed:boolean});
   const normalize=(text:string)=>{const match=/^(\d{4})[年/.-](\d{1,2})(?:[月/.-](\d{1,2}))?[月日]?$/.exec(text.trim());return match?[match[1],match[2]!.padStart(2,'0'),...(match[3]?[match[3].padStart(2,'0')]:[])].join('-'):text;};
   if(actual.committed&&normalize(actual.value)===value&&!await calendarOpen()){committed=true;return{value:actual.value,source:'calendar-marker',committed:true};}await pause();}
  throw Error('CALENDAR_VALUE_NOT_RETAINED');
 }catch(error){if(error instanceof Error){diagnostic={...diagnostic,cause:/^[A-Z_]+$/.test(error.message)?error.message:error.name,change:(error as Error&{controlDiagnostic?:unknown}).controlDiagnostic};Object.assign(error,{calendarSelectionAttempted:selectionAttempted,controlDiagnostic:diagnostic});}throw error;}finally{
  const activePopup=async()=>!!popup&&(await popup.evaluate(calendarTables).then(tables=>tables.length>0).catch(()=>false)||!!await popup.evaluate(divGrid).catch(()=>null));
  if(popup&&!committed&&await activePopup()){
   // press() on the trigger focuses it again and can reopen the calendar.
   if(await target.evaluate(e=>e===e.ownerDocument.activeElement))await page.keyboard.press('Escape').catch(()=>{});
   if(await activePopup()){
    await safeContext();const heading=await target.evaluateHandle(e=>{const owner=e.closest('.form-item');return owner?.querySelector('.form-item__title')??null;}),element=heading.asElement();
    try{if(element&&await element.isVisible()&&!await element.evaluate(e=>!!e.querySelector('input,textarea,select,button,a[href],[role="button"]')))await element.click({timeout:1500});}finally{await heading.dispose();}
   }
   for(let i=0;i<6&&await activePopup();i++)await pause();
   if(await activePopup())throw Object.assign(Error('CALENDAR_NOT_CLOSED'),{calendarSelectionAttempted:selectionAttempted,controlDiagnostic:diagnostic});
  }
  await popup?.dispose();await before.dispose();await target.dispose();
 }
}
