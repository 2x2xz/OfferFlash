import {READ_FORM} from './read-scripts.js';
import {OWNED_SELECT_HELPERS} from './select-shape.js';
import {OWNED_RECORD_KIND_HELPERS,READ_OWNED_SECTIONS} from './owned-sections.js';
import {FORM_TOPOLOGY_HELPERS} from './form-topology.js';
export const UNIVERSAL_CONTROL_SELECTOR='input,textarea,select,[role="combobox"]';
// Same ordered set as the reader's parentElement.closest filter, evaluated in
// Chromium once. Never enumerate every locator through a separate host RPC.
export const UNIVERSAL_BOUND_CONTROL_SELECTOR=':is(input,textarea,select,[role="combobox"]):not([role="combobox"] *)';
export const UNIVERSAL_ACTION_SELECTOR='button,[role="button"],a,span,div';
/** Fixed, read-only semantic observation; no values, selectors or scripts supplied by the model. */
export const READ_UNIVERSAL_FORM=String.raw`((registry,includeBirthForVerification) => {
 const raw=${READ_FORM};
 ${OWNED_SELECT_HELPERS}
 ${OWNED_RECORD_KIND_HELPERS}
 const selector='${UNIVERSAL_CONTROL_SELECTOR}';
 // These caches live for ONE synchronous observation only. No values, labels,
 // visibility or topology are reused across browser actions or documents.
 const visibilityCache=new WeakMap(),hiddenCache=new WeakMap(),controlListCache=new WeakMap();
 const visible=e=>{if(!e)return false;if(visibilityCache.has(e))return visibilityCache.get(e);const r=e.getBoundingClientRect();let shown=!!r.width&&!!r.height;for(let p=e;shown&&p;p=p.parentElement){if(!hiddenCache.has(p)){const s=getComputedStyle(p);hiddenCache.set(p,p.hidden||p.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden');}if(hiddenCache.get(p))shown=false;}visibilityCache.set(e,shown);return shown;};
 const txt=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim();
 const controls=Array.from(document.querySelectorAll(selector)).filter(e=>!e.parentElement?.closest('[role="combobox"]'));
 const existingSelector='fieldset,[role="group"],section,.form-part,.form-record,[data-record],.education-item,.internship-item,.project-item,.language-item,.software-item,.award-item';
 const explicitGroup=e=>e?.closest(existingSelector);
 const visibleControls=p=>{if(!controlListCache.has(p))controlListCache.set(p,controls.filter(c=>p.contains(c)&&visible(c)&&c.type!=='hidden'));return controlListCache.get(p);};
 const validationText=s=>/^(?:必填(?:项(?:未填写)?)?|不能为空|此项不能为空|请选择|请输入|内容|content|required(?:\s+(?:field|items?)(?:\s+(?:are|is)\s+not\s+filled\s+in)?)?|this\s+field\s+is\s+required|please\s+(?:select|enter))(?:\s*[。.!！:：])?$/i.test(s);
 const instructionText=s=>/^(?:提示|温馨提示|填写说明|hint|tip|note)\s*[:：]/i.test(s);
 const isStatus=n=>instructionText(txt(n))||selectMenu(n)||n.matches('ul,ol,[role="listbox"],[role="option"],[role="menu"],[role="alert"],[role="status"],.error,.help,.hint,.form-item-error,.ant-form-item-explain,.ant-form-item-extra,[class*="dropdown"],[class*="Dropdown"],[class*="options"],[class*="Options"],[class*="Input-message-"],[class*="Input-display-value-"],.phoenix-select__calcEle,.phoenix-select__tipWrapper,.phoenix-select__placeHolder')||/(?:^|[\s_-])(?:error|validation|invalid|help|hint)(?:[\s_-]|$)/i.test(n.getAttribute('class')||'')||!!n.querySelector('[role="option"],[role="listbox"]');
 const title=n=>{const s=txt(n);return visible(n)&&s&&s.length<=180&&!n.matches(selector)&&!n.querySelector(selector)&&!n.querySelector('button,a[href],[role="button"]')&&!isStatus(n)&&!/^[^\p{L}\p{N}]+$/u.test(s)&&!/^[\d\s/年月日+.-]+$/.test(s)&&!validationText(s)?s:'';};
 // A search query is not a committed option. Recognise an empty SD select too,
 // using its observed arrow/owner, rather than waiting for a selected-value span.
 const displayProxy=e=>{if(e.tagName==='SELECT')return null;const committed=selectCommitted(e),owned=selectOwned(e),separate=e.matches('input.phoenix-select__input')&&!!e.closest('.phoenix-select');return owned||committed.committed||separate?{value:committed.committed?committed.value:'',owned,source:committed.source}:null;};
 const labelFor=e=>{
   const owner=fieldOwner(e);if(owner)return owner.label;
   const aria=e.getAttribute('aria-label');if(aria?.trim())return aria.trim();
   const ids=(e.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean),linked=ids.map(id=>txt(document.getElementById(id))).filter(Boolean);if(linked.length)return linked.join(' ');
   const associated=Array.from(e.labels||[]).filter(n=>n.htmlFor&&n.htmlFor===e.id).map(n=>txt(n)).filter(Boolean);if(associated.length===1&&!displayProxy(e))return associated[0];
   const candidates=[];
   for(let p=e.parentElement,d=0;p&&d<12;p=p.parentElement,d++){
     if(['FORM','BODY','HTML','MAIN'].includes(p.tagName))break;
     const owned=visibleControls(p),rangeRoot=e.closest('.month-range-select,.date_info'),range=rangeRoot&&owned.length>1&&owned.length<=5&&owned.every(c=>rangeRoot.contains(c));
     if(owned.length!==1&&!range)continue;
     if(p.matches('ul,ol,.phoenix-select,.phoenix-select__content'))continue;
     const titles=Array.from(p.children).flatMap(node=>{const value=title(node);if(!value)return [];const explicit=node.matches('label,[role="heading"]')||/(?:field|form.item).*?(?:title|label)|(?:title|label).*?(?:field|form.item)/i.test(node.getAttribute('class')||'')||Array.from(node.querySelectorAll('label,[role="heading"],[class]')).some(child=>/(?:field|form.item).*?(?:title|label)/i.test(child.getAttribute('class')||''));return [{value,explicit,depth:d}];});
     if(titles.length===1)candidates.push(titles[0]);
   }
   const explicit=candidates.filter(candidate=>candidate.explicit);if(explicit.length)return explicit[0].value;
   const metadata=[e.getAttribute('title'),e.getAttribute('placeholder')].find(value=>value?.trim()&&value.trim().length<=120&&!validationText(value.trim()));
   if(e.closest('nav,[role="navigation"],[role="banner"],search,[role="search"]'))return metadata?.trim()||'';
   return candidates[0]?.value||metadata?.trim()||'';
 };
 const family=s=>{s=s.replace(/^[^\p{L}\p{N}]+/u,'');const kind=recordKindFromCaption(s);if(kind)return recordSectionName(kind);if(/^(个人信息|基本信息|personal\s+info|AI应用技能|AI\s+skills|申请信息|applications)(?:\s|\/|$)/i.test(s))return '其它区块';return '';};
 const sectionCaption=node=>{const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT,{acceptNode:text=>text.parentElement?.closest('button,[role="button"],a[href],input,textarea,select')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}),parts=[];while(parts.length<80&&walker.nextNode())parts.push(walker.currentNode.nodeValue||'');return parts.join(' ').replace(/\s+/g,' ').trim();};
 ${FORM_TOPOLOGY_HELPERS}
 const sectionFor=topologySection;
 const anchor=f=>/学校名称|院校|^学校$|university|institution|\bschool\b/i.test(f.label)?'教育经历':/公司名称|单位名称|实习单位|employer|\bcompany\b|organization/i.test(f.label)?'实习经历':/项目名称|project.name|project.title/i.test(f.label)?'项目经历':/语言类型|语言名称|语种|^language(?:\s+(?:name|type))?(?:\s*\/.*)?$/i.test(f.label)?'语言能力':/软件名称|软件类型|^software(?:\s+(?:name|type))?(?:\s*\/.*)?$/i.test(f.label)?'软件技能':/奖项名称|奖励名称|荣誉名称|获奖名称|award\s+(?:name|title)|honou?r\s+(?:name|title)/i.test(f.label)?'荣誉奖励':'';
 // SD clears the input placeholder when a value is selected. The separate
 // committed marker still proves which half of an explicit year/month pair it
 // is; an uncommitted query must never supply that evidence.
 const monthPart=e=>{const placeholder=(e.getAttribute('placeholder')||'').trim();
   if(/^(?:年|year)(?:\s*\/\s*(?:年|year))?$/i.test(placeholder))return 'year';
   if(/^(?:月|month)(?:\s*\/\s*(?:月|month))?$/i.test(placeholder))return 'month';
   const scope=selectScope(e);if(!e.closest('.month-range-select')||!scope||!selectArrow(scope))return '';
   // Focus hides SD's display span with CSS, without removing the committed
   // selection. Preserve only its unit identity here; value readback still
   // requires a visible committed marker after blur.
   const markers=Array.from(selectLabel(e)?.querySelectorAll('[class*="Input-display-value-"]')||[]).filter(n=>!n.hidden&&n.getAttribute('aria-hidden')!=='true');
   const selected=markers.length===1?txt(markers[0]):'';
   return /^\d{4}年?$/.test(selected)?'year':/^(?:0?[1-9]|1[0-2])月?$/.test(selected)?'month':'';
 };
 // Keep every raw control/index for locator freshness. Purpose distinguishes
 // application answers from adjacent site navigation and optional site actions.
 // A word such as "search" in an applicant question is not exclusion evidence.
 const purposeFor=(e,label,required,owned,section)=>{
   const normalized=label.replace(/\s+/g,' ').replace(/[。.!！]+$/u,'').trim();
   const syncAction=/^(?:同步(?:更新)?(?:我的)?在线简历|(?:sync(?:hronize)?|(?:synchronously\s+)?update)(?:\s+(?:my|the))?\s+online\s+(?:resume|cv)|(?:sync(?:hronize)?|(?:synchronously\s+)?update)(?:\s+(?:my|the))?\s+(?:resume|cv)\s+online)$/iu;
   // Translations can be separate spans. Every complete alias must mean the
   // same optional action; one matching half cannot hide another real question.
   const syncAliases=normalized.split(/\s*\/\s*/u).map(part=>part.replace(/[。.!！]+$/u,'').trim());
   const optionalSync=syncAliases.length<=2&&syncAliases.every(part=>syncAction.test(part));
   if(e.type==='checkbox'&&!required&&!e.required&&e.getAttribute('aria-required')!=='true'&&optionalSync)return {purpose:'site-preference',purposeReason:'optional-resume-sync'};
   if(owned||e.tagName!=='INPUT'||!['text','search'].includes(e.type)||e.closest('fieldset,[role="group"],.application-question')||section)return {purpose:'application'};
   const form=e.form||e.closest('form'),formControls=form?visibleControls(form).filter(control=>!['button','submit','reset','image'].includes(control.type)):[];
   // A shared application form is not a navbar search just because one of its
   // fields happens to be rendered in a header or uses input[type=search].
   if(form&&(formControls.length!==1||formControls[0]!==e||form.querySelector('fieldset,[role="group"],.application-question')))return {purpose:'application'};
   const jobSearch=/^(?:搜索(?:职位|岗位)(?:关键词)?|(?:职位|岗位)搜索|(?:search|find)(?:\s+for)?\s+(?:jobs?|positions?|vacancies)|(?:job|position)\s+search)$/iu;
   const jobIntent=[e.getAttribute('title'),e.getAttribute('aria-label'),e.getAttribute('placeholder')].some(value=>value&&jobSearch.test(value.replace(/\s+/g,' ').trim()));
   const searchLandmark=e.closest('search,[role="search"]'),navigation=e.closest('nav,header,[role="navigation"],[role="banner"]');
   const explicitSearch=e.type==='search'||e.getAttribute('role')==='searchbox'||!!searchLandmark;
   if((searchLandmark||navigation)&&(explicitSearch||jobIntent))return {purpose:'site-search',purposeReason:'navigation-search'};
   if(jobIntent)return {purpose:'site-search',purposeReason:'standalone-job-search'};
   return {purpose:'application'};
 };
 const rows=raw.fields.map(f=>{const e=controls[f.index],proxy=displayProxy(e);let label=['checkbox','radio'].includes(f.type)?f.label:labelFor(e)||f.label;const section=sectionFor(e);const declared=f.type==='combobox'?e.getAttribute('aria-valuetext'):null;
   let datePart;const part=monthPart(e);
   const owner=fieldOwner(e),datePair=owner&&/起止|开始.*结束|start.*end|date.*range|period/i.test(owner.label)&&owner.controls.filter(c=>!['checkbox','radio'].includes(c.type));
   const pairedDates=datePair&&datePair.length===2&&datePair.every(c=>c.matches('input')&&!!c.closest('[class*="date-range-picker"],[class*="DateRangePicker"],[class*="range-picker"],[class*="RangePicker"]'));
   if(pairedDates)label=owner.label+' · '+(datePair.indexOf(e)===0?'开始时间':'结束时间');
   const range=e.closest('.month-range-select');if(part&&range){const pairs=Array.from(range.children).filter(n=>{const cs=visibleControls(n).filter(c=>!['checkbox','radio'].includes(c.type));return cs.length===2&&cs.filter(c=>monthPart(c)==='year').length===1&&cs.filter(c=>monthPart(c)==='month').length===1;});
    const pair=pairs.findIndex(n=>n.contains(e)),separator=Array.from(range.children).some(n=>!n.querySelector(selector)&&/^[—–-]$/.test(txt(n)));
    if(pairs.length===2&&separator&&pair>=0){datePart=part;label+=' · '+(pair===0?'开始时间':'结束时间')+' · '+(part==='year'?'年':'月');}
    else if(pairs.length===1&&pair===0&&/毕业时间|graduation.date/i.test(label)){datePart=part;label+=' · '+(part==='year'?'年':'月');}
    else if(pairs.length===1&&pair===0&&/起止时间|\bperiod\b/i.test(label)&&range.querySelectorAll('input[type="checkbox"]').length===1&&range.querySelector('input[type="checkbox"]').checked&&Array.from(range.querySelectorAll('span,label,div')).some(n=>(!n.querySelector(selector)||n.matches('label')&&n.querySelectorAll(selector).length===1&&n.querySelector('input[type="checkbox"]'))&&/^(?:至今|present)(?:\s*\/\s*(?:至今|present))?$/i.test(txt(n)))){datePart=part;label+=' · 开始时间 · '+(part==='year'?'年':'月');}
   }
   const calendarWidget=!!pairedDates;
   const retainedDate=proxy?.value?.replace(/年|\//g,'-').replace(/月$/,'').replace(/月/,'-').replace(/日$/,'');
   const datePrecision=e.type==='date'||/年月日|yyyy\s*[-/.年]\s*mm\s*[-/.月]\s*dd/i.test(e.getAttribute('placeholder')||'')?'day':e.type==='month'||retainedDate&&/^\d{4}-\d{2}$/.test(retainedDate)?'month':retainedDate&&/^\d{4}-\d{2}-\d{2}$/.test(retainedDate)?'day':undefined;
   const readOnlyWidget=e.tagName!=='SELECT'&&!['checkbox','radio'].includes(f.type)&&(!!proxy||calendarWidget||!!e.closest('label.select,.month-range-select'));
   const baseValue=proxy?proxy.value:declared!==null?declared:f.value;
   // The default reader and diagnostics retain their DOB mask. The dedicated
   // host verifier may compare a confirmed native birthday without exporting it
   // through model observations. Never broaden this exception to credentials.
   const birthName=/^(?:出生日期|出生年月日|生日|date\s+of\s+birth|birth\s*date|birthday|dob)$/i;
   const birthAliases=label.replace(/[*＊:：]/g,'').trim().split(/\s*\/\s*/u);
   const credential=/密码|验证码|身份证|护照|password|passcode|captcha|passport|national.?id|social.?security/i.test(label+' '+(section?.family||'')+' '+(f.section||''));
   const hostBirth=includeBirthForVerification===true&&!credential&&(!readOnlyWidget||proxy?.owned)&&e.tagName==='INPUT'&&['text','date'].includes(e.type)&&birthAliases.length<=2&&birthAliases.every(part=>birthName.test(part.trim()));
   const value=hostBirth?(proxy?.owned?baseValue:String(e.value||'')):baseValue;
   const sensitive=/密码|验证码|身份证|护照|出生|生日|password|captcha|passport|birth|national.?id|social.?security/i.test(label);
   const scope=proxy?.owned?selectScope(e):null;
   const popupVisible=selectPopupRoots(scope||e,e).some(selectPopupRendered);
   const required=f.required||/[*＊]/.test(label),purpose=purposeFor(e,label,required,!!proxy?.owned,section?.family||'');
   return {...f,...purpose,label,value:sensitive&&!hostBirth?(value?'[已有值]':''):value,type:readOnlyWidget?'combobox':f.type,editable:proxy?.owned||calendarWidget?!selectDisabled(e):f.editable,readOnlyWidget,ownedSelect:!!proxy?.owned||calendarWidget,datePart,datePrecision,queryPending:!!proxy?.owned&&!!e.value&&!proxy.value,controlValue:sensitive?'':String(e.value||''),expanded:e.getAttribute('aria-expanded')==='true',popupVisible,required,invalid:e.getAttribute('aria-invalid')==='true'||!(proxy?.owned&&proxy.value)&&e.validity?.valid===false,_e:e,_section:section};});
 // An unnamed experience is still a record when one primary description and
 // one date range share a DOM container. Values/order never select its source.
 const anonymousPrimary=r=>r.type==='textarea'&&(/项目|project/i.test(r._section?.family||'')&&/^(?:项目描述|project\s+description)$/i.test(r.label)||/实习|internship/i.test(r._section?.family||'')&&/^(?:实习职责|实习描述|internship\s+(?:description|responsibilities))$/i.test(r.label));
 const anonymousNodes=cap=>rows.filter(r=>cap.node.contains(r._e)&&anonymousPrimary(r)).map(primary=>{
  let chosen=null;
  for(let p=primary._e.parentElement;p&&cap.node.contains(p);p=p.parentElement){
   const contained=rows.filter(r=>p.contains(r._e));
   if(contained.filter(anonymousPrimary).length!==1||contained.some(anchor))break;
   const ranges=new Set(contained.map(r=>r._e.closest('.month-range-select,.date_info')).filter(Boolean));
   if(ranges.size===1&&contained.filter(r=>r.datePart||/开始|结束|start|end/i.test(r.label)&&r.type!=='textarea').length>=2)chosen=p;
   if(p===cap.node)break;
  }return chosen;
 }).filter(Boolean);
 const groupIds=new WeakMap(),recordNodesCache=new WeakMap();
 const groups=Array.from(document.querySelectorAll(existingSelector));const groupId=g=>{
  if(groupIds.has(g))return groupIds.get(g);
  if(typeof registry==='object'&&registry?.nodes){const anchors=rows.filter(r=>g.contains(r._e)&&anchor(r)),prose=rows.filter(r=>g.contains(r._e)&&anonymousPrimary(r)),key=anchors.length===1?anchors[0]._e:!anchors.length&&prose.length===1?prose[0]._e:g;let id=registry.nodes.get(key);
   registry.anchors??=new Map();const stable=anchors.length===1&&key.id&&document.querySelectorAll('[id="'+CSS.escape(key.id)+'"]').length===1?key.tagName+'|'+key.id+'|'+anchor(anchors[0]):'';
   const prior=stable?registry.anchors.get(stable):null;
   // A single anchor can be seen from both its record fieldset and an outer
   // application module. Preserve every previously observed connected scope,
   // rather than overwriting it with the last sibling's outer scope.
   if(id===undefined&&prior&&!prior.node.isConnected&&(prior.scope===g||prior.scopes?.has(g))&&g.isConnected)id=prior.id;
   if(id===undefined)id=registry.next++;registry.nodes.set(key,id);if(stable){const scopes=prior?.id===id?prior.scopes??new WeakSet():new WeakSet();scopes.add(g);registry.anchors.set(stable,{node:key,scope:g,scopes,id});}const value='group-'+id;groupIds.set(g,value);return value;}
  if(!groups.includes(g))groups.push(g);const value='group-'+groups.indexOf(g);groupIds.set(g,value);return value;};
 const ownerGroup=g=>{if(typeof registry==='object'&&registry?.nodes){registry.owners??=new WeakMap();registry.ownerNext??=0;let id=registry.owners.get(g);if(id===undefined){id=registry.ownerNext++;registry.owners.set(g,id);}return 'owner-'+id;}if(!groups.includes(g))groups.push(g);return 'owner-'+groups.indexOf(g);};
 for(const row of rows){const cap=row._section,original=explicitGroup(row._e);let chosen=original,section=row.section||'';
   if(cap&&cap.family!=='其它区块'){
     section=cap.family;
     let byFamily=recordNodesCache.get(cap.node);if(!byFamily){byFamily=new Map();recordNodesCache.set(cap.node,byFamily);}
     if(!byFamily.has(cap.family)){const anchors=rows.filter(f=>cap.node.contains(f._e)&&anchor(f)===cap.family);
      byFamily.set(cap.family,anchors.length?anchors.map(a=>{let chosen=null;for(let p=a._e.parentElement;p&&cap.node.contains(p);p=p.parentElement){const contained=rows.filter(f=>p.contains(f._e));if(contained.filter(f=>anchor(f)===cap.family).length!==1||contained.some(f=>anchor(f)&&anchor(f)!==cap.family))break;if(contained.length>=1)chosen=p;if(p===cap.node)break;}return chosen;}).filter(Boolean):anonymousNodes(cap));
     }const recordNodes=byFamily.get(cap.family);
     const matches=recordNodes.filter(n=>n.contains(row._e));if(matches.length===1)chosen=matches[0];else if(!original)chosen=null;
   }
   if(!section&&chosen){const headings=Array.from(chosen.querySelectorAll('legend,h1,h2,h3,h4,.form-part-title,.form-part__title,.section-title,[role="heading"]')).filter(n=>visible(n)&&explicitGroup(n)===chosen);if(headings.length===1)section=txt(headings[0]);}
   // An explicit record wrapper can lack a heading. A single owned identity
   // field still proves its family; never borrow a sibling module's heading.
   if(!section&&chosen){const identities=rows.filter(f=>chosen.contains(f._e)&&anchor(f));if(identities.length===1)section=anchor(identities[0]);}
   row.section=section;row.group=chosen?groupId(chosen):'contact';
   if(typeof registry==='object'&&registry?.nodes){
    registry.controlNodes??=new WeakMap();registry.controlNext??=0;registry.controlAnchors??=new Map();
    let id=registry.controlNodes.get(row._e);const e=row._e;
    const stable=e.id&&document.querySelectorAll('[id="'+CSS.escape(e.id)+'"]').length===1?e.tagName+'|'+e.id+'|'+row.group+'|'+row.label:'';
    const prior=stable?registry.controlAnchors.get(stable):null;
    if(id===undefined&&prior&&!prior.node.isConnected)id=prior.id;
    if(id===undefined)id=registry.controlNext++;registry.controlNodes.set(e,id);if(stable)registry.controlAnchors.set(stable,{node:e,id});
    row.identity+='|host-control-'+id;
   }
 }
 const actions=[];const all=Array.from(document.querySelectorAll('${UNIVERSAL_ACTION_SELECTOR}'));
 for(let nodeIndex=0;nodeIndex<all.length&&actions.length<30;nodeIndex++){const e=all[nodeIndex],label=txt(e)||Array.from(e.querySelectorAll('img[alt]')).map(img=>img.getAttribute('alt')||'').join(' ').trim();if(!visible(e)||!label||label.length>60||label.includes('\n')||e.querySelector('button,[role="button"],a,input,textarea,select'))continue;
   let widgetAction=false;for(let p=e.parentElement;p&&!['FORM','BODY','HTML','SECTION','FIELDSET'].includes(p.tagName);p=p.parentElement){if(p.matches('[role="listbox"],[role="menu"],.phoenix-select,label.select')||selectMenu(p)&&['absolute','fixed'].includes(getComputedStyle(p).position)){widgetAction=true;break;}}if(widgetAction)continue;
   const suffix=label.replace(/^[^\p{L}\p{N}]*(?:添加|新增|增加|add)(?:\s+(?:a|new))?\s*/iu,''),typed=recordKindFromCaption(suffix)||({语言:'language',软件:'software',奖项:'award',language:'language',software:'software'}[suffix.toLowerCase()]||'');
   const explicit=/^[^\p{L}\p{N}]*(?:添加|新增|增加|add)/iu.test(label)&&!!typed;
   const generic=/^[^\p{L}\p{N}]*(?:添加|新增|增加)\s*(?:\/\s*add)?$/iu.test(label)||/^add$/i.test(label);
   const cap=sectionFor(e),kind=typed||recordKindFromCaption(cap?.family||'');if(!kind||!explicit&&!(generic&&cap&&cap.family!=='其它区块'))continue;
   if(e.closest('a[href],button:not([type="button"]),input[type="submit"]'))continue;
   // Text/span grandchildren are aliases of the same button, not extra actions.
   if(e.parentElement?.closest('button,[role="button"]'))continue;
   const nested=actions.find(a=>all[a.nodeIndex].contains(e)&&txt(all[a.nodeIndex])===label);if(nested)continue;
   const owner=cap?.node||e.closest(existingSelector)||e.parentElement;if(!owner||['BODY','HTML'].includes(owner.tagName))continue;
   actions.push({index:actions.length,nodeIndex,label:generic?'添加'+recordSectionName(kind):label,kind,recordKind:kind,section:cap?.family||recordSectionName(kind),group:ownerGroup(owner)});
 }
 const options=Array.from(document.querySelectorAll('[role="option"],.phoenix-select__option,.ant-select-item-option,.el-select-dropdown__item')).filter(visible).slice(0,200).map((e,index)=>({index,label:txt(e).slice(0,160)}));
 const sections=${READ_OWNED_SECTIONS};
 // Interpret short captions inside the same record, never from values or
 // website names, and never borrow context from another project.
 const caption=row=>row.label.replace(/[*✱＊:：]/g,'').trim();
 const projectRows=new Map();
 for(const row of rows)if(/项目|project/i.test(row.section)){
   if(caption(row)==='职责')row.responsibilityKind='ambiguous';
   if(row.group!=='contact'){const group=projectRows.get(row.group)||[];group.push(row);projectRows.set(row.group,group);}
 }
 for(const group of projectRows.values()){
   const short=group.filter(row=>caption(row)==='职责');
   const descriptions=group.filter(row=>/^(?:项目描述|project\s+description)$/i.test(caption(row)));
   const otherRoles=group.filter(row=>/^(?:项目职责|项目角色|角色|职务|职位|project\s+role)$/i.test(caption(row)));
   if(short.length===1&&short[0].type==='text'&&descriptions.length===1&&!otherRoles.length)short[0].responsibilityKind='role';
 }
 return {url:raw.url,fields:rows.map(({_e,_section,...row})=>row),actions,options,sections};
})(/* host-group-registry */null,/* host-birth-verification */false)`;
/** Session-only comparison reader. Model projections and diagnostics use the
 * masked default script; this literal policy is never supplied by the model. */
export const READ_UNIVERSAL_FORM_FOR_HOST_VERIFICATION=READ_UNIVERSAL_FORM.replace('/* host-birth-verification */false','true');
