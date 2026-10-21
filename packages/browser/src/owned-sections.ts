import type {Page} from 'playwright-core';

export type OwnedRecordKind='education'|'internship'|'employment'|'project'|'publication'|'language'|'software'|'award';
export const OWNED_RECORD_KIND_HELPERS=String.raw`
 const recordKindFromCaption=value=>{const s=(value||'').replace(/^[^\p{L}\p{N}]+/u,'').trim();
  if(/^(?:教育(?:背景|经历)?|education(?:\s+(?:background|experience))?)(?:\s|\/|添加|$)/i.test(s))return 'education';
  if(/^(?:实习(?:经历)?|internship(?:\s+experience)?)(?:\s|\/|添加|$)/i.test(s))return 'internship';
  if(/^(?:工作经历|work\s+experience|employment)(?:\s|\/|添加|$)/i.test(s))return 'employment';
  if(/^(?:项目(?:经历|经验)?|projects?(?:\s+experience)?)(?:\s|\/|添加|$)/i.test(s))return 'project';
  if(/^(?:论文|出版|publications?)(?:\s|\/|添加|$)/i.test(s))return 'publication';
  if(/^(?:语言能力|语言技能|外语能力|外语技能|languages?(?:\s+(?:ability|skills?|proficiency))?)(?:\s|\/|添加|$)/i.test(s))return 'language';
  if(/^(?:软件技能|软件能力|计算机技能|计算机能力|software(?:\s+(?:skills?|ability|proficiency))?|computer\s+skills?)(?:\s|\/|添加|$)/i.test(s))return 'software';
  if(/^(?:荣誉奖励|奖励情况|获奖经历|荣誉|奖励|获奖|honou?rs?(?:\s*(?:and|&)\s*awards?)?|awards?)(?:\s|\/|添加|$)/i.test(s))return 'award';return '';
 };
 const recordSectionName=kind=>({education:'教育经历',internship:'实习经历',employment:'工作经历',project:'项目经历',publication:'论文成果',language:'语言能力',software:'软件技能',award:'荣誉奖励'}[kind]||'');
`;
export const OWNED_SECTION_SELECTOR='details > summary,button[aria-expanded],[role="button"][aria-expanded]';
export interface OwnedSectionDescriptor{
 ref:string;index:number;kind:'details'|'aria';label:string;state:'collapsed'|'expanded';identity:string;
 panelId?:string;recordKind?:OwnedRecordKind;panelVisible:boolean;
}
/** Fixed read-only inventory. Only explicit DOM relationships confer expansion. */
export const READ_OWNED_SECTIONS=String.raw`(() => {
 ${OWNED_RECORD_KIND_HELPERS}
 const visible=e=>{if(!e)return false;for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(p.hidden||p.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden')return false;}const r=e.getBoundingClientRect();return !!r.width&&!!r.height;};
 const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
 const unsafe=/提交|投递|发送|支付|删除|取消|同意|声明|隐私|协议|登录|验证码|上传|submit|apply.now|send|delete|remove|cancel|consent|agree|privacy|password|captcha|sign.?in|log.?in|upload/i;
 return Array.from(document.querySelectorAll('${OWNED_SECTION_SELECTOR}')).flatMap((trigger,index)=>{
  if(!visible(trigger)||trigger.closest('a[href],button:not([type="button"]),[role="combobox"],[role="listbox"],[role="menu"]')||trigger.querySelector('input,textarea,select,a[href]'))return [];
  const ids=(trigger.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean),label=(trigger.getAttribute('aria-label')||ids.map(id=>text(document.getElementById(id))).filter(Boolean).join(' ')||text(trigger)).trim();
  if(!label||label.length>160||unsafe.test(label))return [];
  const recordKind=recordKindFromCaption(label),known=recordKind||/附加信息|补充信息|其他信息|个人信息|基本信息|additional\s+(?:info|detail)|supplementary|other\s+(?:info|detail)|personal\s+info|basic\s+info|more\s+(?:information|details)/i.test(label);
  if(!known&&!trigger.closest('form,main,[role="main"],fieldset,.application-question,.form-part'))return [];
  if(trigger.closest('nav,[role="navigation"],[role="banner"]')&&!trigger.closest('fieldset,.application-question'))return [];
  let panel,kind,state,panelId;
  if(trigger.tagName==='SUMMARY'){
   panel=trigger.parentElement;if(panel?.tagName!=='DETAILS'||panel.querySelector(':scope > summary')!==trigger)return [];
   kind='details';state=panel.open?'expanded':'collapsed';panelId=panel.id||undefined;
  }else{
   if(!['true','false'].includes(trigger.getAttribute('aria-expanded')))return [];
   const controls=(trigger.getAttribute('aria-controls')||'').split(/\s+/).filter(Boolean);if(controls.length!==1)return [];
   const matches=Array.from(document.querySelectorAll('[id]')).filter(e=>e.id===controls[0]);if(matches.length!==1||matches[0].contains(trigger))return [];
   panel=matches[0];kind='aria';state=trigger.getAttribute('aria-expanded')==='true'?'expanded':'collapsed';panelId=controls[0];
  }
  const identity=JSON.stringify([trigger.tagName,trigger.id||'',trigger.getAttribute('role')||'',trigger.getAttribute('aria-controls')||'',label,kind,panelId||'']);
  return [{ref:'section-'+index,index,kind,label,state,identity,panelId,recordKind:recordKind||undefined,panelVisible:visible(panel)}];
 });
})()`;

/** The descriptor must be resolved from the host's last observed inventory. */
export async function expandOwnedSection(page:Page,descriptor:OwnedSectionDescriptor,guard:()=>Promise<void>):Promise<{expanded:boolean;changed:boolean}>{
 await guard();const url=page.url(),inventory=await page.evaluate(READ_OWNED_SECTIONS) as OwnedSectionDescriptor[];
 const matches=inventory.filter(item=>item.ref===descriptor.ref&&item.index===descriptor.index&&item.identity===descriptor.identity);
 if(matches.length!==1)throw Error('SECTION_CHANGED_REOBSERVE');
 const trigger=await page.locator(OWNED_SECTION_SELECTOR).nth(descriptor.index).elementHandle();if(!trigger)throw Error('SECTION_DISAPPEARED');
 const snapshot=await page.evaluateHandle(()=>new Map(Array.from(document.querySelectorAll('input,textarea,select')).filter(e=>!(e instanceof HTMLInputElement&&['password','file','hidden'].includes(e.type))).slice(0,300).map(e=>[e,{value:(e as HTMLInputElement).value,checked:(e as HTMLInputElement).checked}])));
 try{
  const panel=await trigger.evaluateHandle((e,{kind,panelId})=>kind==='details'?e.parentElement:document.getElementById(panelId||''),descriptor);
  try{
   const element=panel.asElement();if(!element)throw Error('SECTION_PANEL_DISAPPEARED');
   const unchanged=async()=>{await guard();if(page.url()!==url||!await snapshot.evaluate(values=>Array.from(values).every(([e,before])=>e.isConnected&&(e as HTMLInputElement).value===before.value&&(e as HTMLInputElement).checked===before.checked)))throw Error('SECTION_CONTEXT_CHANGED');};
   await unchanged();let changed=false;
   if(matches[0]!.state==='collapsed'){await trigger.click({timeout:2500});changed=true;}
   const deadline=Date.now()+800;
   do{await unchanged();
    const expanded=await trigger.evaluate((e,{panel,kind})=>e.isConnected&&panel.isConnected&&(kind==='details'?(panel as HTMLDetailsElement).open:e.getAttribute('aria-expanded')==='true'),{panel:element,kind:descriptor.kind});
    if(expanded&&await element.isVisible())return{expanded:true,changed};
    if(Date.now()>=deadline)throw Error('SECTION_DID_NOT_EXPAND');await new Promise(resolve=>setTimeout(resolve,50));
   }while(true);
  }finally{await panel.dispose();}
 }finally{await snapshot.dispose();await trigger.dispose();}
}
