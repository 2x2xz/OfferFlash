import type { FormFieldOracle, FormValue } from './form-scoring.js';

export interface FixtureField extends Omit<FormFieldOracle, 'fieldId'> {
  domId: string; label: string; type: string; section: string;
  profileKey?: string; options?: Array<{ label: string; value: string }>; multiline?: boolean;
}
export interface FormFixtureCase {
  id: string; title: string; description?: string; fields: FixtureField[];
  behavior?: 'none' | 'reset-first-input' | 'mutate-other-on-input' | 'delayed-reset';
}
export interface FormAudit {
  values: Record<string, FormValue>;
  events: Array<{ fieldId: string; before: FormValue; after: FormValue; cause: 'agent-input' | 'environment-injection' }>;
  submits: number; filesTouched: number; clicks: number; activeElement: string;
}
const escapeHTML = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]!);
const scriptJSON = (value: unknown): string => JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const types = new Set(['text','email','tel','textarea','select','month','date','checkbox','radio','file','hidden','combobox']);
function validID(id: string): boolean { return typeof id==='string' && /^[a-z][a-z0-9-]{0,100}$/.test(id); }

/** Return only renderable controls, never the case oracle, expected values, classifications or profile keys. */
export function renderFormFixture(scenario: FormFixtureCase): string {
  if (!scenario || typeof scenario.title!=='string' || !Array.isArray(scenario.fields) || scenario.fields.length===0 || scenario.fields.length>300
    || !['none','reset-first-input','mutate-other-on-input','delayed-reset'].includes(scenario.behavior??'none')) throw new Error('Invalid fixture case.');
  const ids = new Set<string>();
  for (const field of scenario.fields) {
    if (!validID(field.domId) || ids.has(field.domId) || !types.has(field.type) || typeof field.label!=='string' || typeof field.section!=='string'
      || typeof field.required!=='boolean' || !['string','boolean'].includes(typeof field.initialValue)) throw new Error('Invalid fixture field.');
    ids.add(field.domId);
    if (['checkbox','radio'].includes(field.type) ? typeof field.initialValue!=='boolean' : typeof field.initialValue!=='string') throw new Error('Invalid typed fixture initial value.');
    if (field.type==='file' && field.initialValue!=='') throw new Error('A fixture cannot preselect a file.');
    if (field.type==='select' && (!Array.isArray(field.options) || !field.options.length || !field.options.some(option=>option.value===field.initialValue))) throw new Error('Invalid fixture select initial option.');
    for (const option of field.options??[]) if (typeof option.label!=='string'||typeof option.value!=='string') throw new Error('Invalid fixture option.');
  }
  const trigger = scenario.fields.find(field=>field.kind==='eligible');
  const victim = scenario.fields.find(field=>field.kind==='protected' && field.protection==='existing');
  if ((scenario.behavior??'none')!=='none' && (!trigger || !['text','email','tel','textarea'].includes(trigger.type))) throw new Error('Controlled behavior requires a text target.');
  if (scenario.behavior==='mutate-other-on-input' && (!victim || !['text','email','tel','textarea'].includes(victim.type))) throw new Error('Mutation behavior requires a text counterpart.');
  const controls = scenario.fields.map(field=>{
    const id = escapeHTML(field.domId), label = escapeHTML(field.label), initial = escapeHTML(String(field.initialValue));
    const required = field.required?' required':'';
    let control: string;
    if (field.type==='select') control = `<select id="${id}" name="${id}"${required}>${field.options!.map(option=>`<option value="${escapeHTML(option.value)}"${option.value===field.initialValue?' selected':''}>${escapeHTML(option.label)}</option>`).join('')}</select>`;
    else if (field.type==='textarea') control = `<textarea id="${id}" name="${id}" rows="${field.multiline?4:2}"${required}>${initial}</textarea>`;
    else if (field.type==='combobox') {
      const options = field.options??[{label:'演示选项甲',value:'fictional-choice-a'},{label:'演示选项乙',value:'fictional-choice-b'}];
      // A genuinely interactive free-text dropdown, deliberately without a reviewed ARIA binding.
      // Its lack of binding is part of the unsupported-control workload, not a production bypass.
      control = `<div class="fixture-combo"><input id="${id}" name="${id}" role="combobox" aria-expanded="false" autocomplete="off" value="${initial}"${required}><div class="fixture-menu" hidden>${options.map(option=>`<button type="button" role="option" data-choice="${escapeHTML(option.value)}">${escapeHTML(option.label)}</button>`).join('')}</div></div>`;
    } else if (field.type==='checkbox'||field.type==='radio') control = `<input id="${id}" name="${id}" type="${field.type}" value="on"${field.initialValue?' checked':''}${required}>`;
    else if (field.type==='file') control = `<input id="${id}" name="${id}" type="file"${required}>`;
    else control = `<input id="${id}" name="${id}" type="${field.type}" value="${initial}"${required}>`;
    if (field.type==='hidden') return control;
    return `<section class="fixture-section" aria-label="${escapeHTML(field.section)}"><h2>${escapeHTML(field.section)}</h2><div class="fixture-row"><label for="${id}">${label}</label>${control}</div></section>`;
  }).join('\n');
  // Host-only kind/protection are projected into neutral behavior anchors; none of the source case is serialized.
  const behavior = scenario.behavior??'none';
  const setup = scriptJSON({ids:[...ids],trigger:behavior==='none'?null:trigger?.domId??null,
    victim:behavior==='mutate-other-on-input'?victim?.domId??null:null,behavior});
  // A declared long-page scenario gets a deterministic minimum height, independent of font metrics.
  // This layout decision uses the public title, never field classifications or answer metadata.
  const longLayout = /长表|long[ -]?form/i.test(scenario.title);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><title>${escapeHTML(scenario.title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f5fa;color:#202b42;font:16px system-ui,sans-serif}main{max-width:880px;margin:auto;padding:28px 48px 90px}h1{font-size:24px}h2{font-size:14px;margin:0 0 14px;color:#66758d}.fixture-section{padding:20px;margin:20px 0;border:1px solid #c6cfdd;border-radius:8px;background:white}.fixture-row>label{display:block;margin-bottom:9px;font-weight:600}input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea{display:block;width:100%;min-height:40px;border:1px solid #91a3bd;border-radius:4px;padding:8px;font:inherit}textarea{resize:vertical}.fixture-combo{position:relative}.fixture-menu{position:absolute;z-index:5;top:100%;width:100%;background:#fff;border:1px solid #91a3bd}.fixture-menu button{display:block;width:100%;padding:12px;border:0;background:white;text-align:left}.fixture-menu button:hover{background:#e7efff}button{font:inherit}button[type=submit]{padding:12px 24px}[hidden]{display:none!important}
  .fixture-long-form .fixture-section{min-height:164px}
  </style></head><body${longLayout?' class="fixture-long-form"':''}><main><h1>${escapeHTML(scenario.title)}</h1><p>原创隔离测评样表；人物虚构，不向企业发送申请。</p><form id="fixture-form">${controls}<button type="submit">样表提交按钮（自动填写不得点击）</button></form></main><script>
  (()=>{
    'use strict';
    const setup=${setup};
    const events=[], last=new Map(); let submits=0, filesTouched=0, clicks=0, fired=false;
    const inputValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    const inputChecked=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked');
    const inputFiles=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'files');
    const textValue=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
    const selectValue=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
    const read=element=>{
      if(element.tagName==='SELECT')return selectValue.get.call(element);
      if(element.tagName==='TEXTAREA')return textValue.get.call(element);
      if(element.type==='checkbox'||element.type==='radio')return inputChecked.get.call(element);
      if(element.type==='file')return inputFiles.get.call(element).length?'[file-selected]':'';
      return inputValue.get.call(element);
    };
    for(const id of setup.ids){const element=document.getElementById(id);if(element)last.set(id,read(element));}
    const record=(element,cause)=>{if(!element||!last.has(element.id))return;const before=last.get(element.id),after=read(element);if(before!==after){events.push({fieldId:element.id,before,after,cause});last.set(element.id,after);}};
    const inject=(id,value)=>{const element=document.getElementById(id);if(!element)return;const setter=element.tagName==='TEXTAREA'?textValue.set:inputValue.set;setter.call(element,value);record(element,'environment-injection');};
    document.addEventListener('input',event=>{
      const element=event.target;record(element,'agent-input');if(element&&element.type==='file')filesTouched++;
      if(fired||!element||element.id!==setup.trigger)return;fired=true;
      if(setup.behavior==='reset-first-input')inject(setup.trigger,'');
      else if(setup.behavior==='mutate-other-on-input')inject(setup.victim,'DEMO-ENVIRONMENT-CHANGED');
      else if(setup.behavior==='delayed-reset')setTimeout(()=>inject(setup.trigger,''),100);
    },true);
    document.addEventListener('change',event=>{record(event.target,'agent-input');if(event.target&&event.target.type==='file')filesTouched++;},true);
    document.addEventListener('click',()=>{clicks++;},true);
    document.addEventListener('submit',event=>{event.preventDefault();submits++;},true);
    for(const wrapper of document.querySelectorAll('.fixture-combo')){
      const input=wrapper.querySelector('input'),menu=wrapper.querySelector('.fixture-menu');
      const open=()=>{menu.hidden=false;input.setAttribute('aria-expanded','true');};
      const close=()=>{menu.hidden=true;input.setAttribute('aria-expanded','false');};
      input.addEventListener('click',open);input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();open();menu.querySelector('button')?.focus();}else if(event.key==='Escape')close();});
      for(const option of menu.querySelectorAll('button'))option.addEventListener('click',()=>{inputValue.set.call(input,option.getAttribute('data-choice'));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));close();input.focus();});
    }
    Object.defineProperty(window,'__offerflashFormAudit',{configurable:false,writable:false,value:()=>{
      const values=Object.create(null);for(const id of setup.ids){const element=document.getElementById(id);if(element)values[id]=read(element);}
      return {values,events:events.map(event=>({...event})),submits,filesTouched,clicks,activeElement:document.activeElement?.id||document.activeElement?.tagName||''};
    }});
  })();
  </script></body></html>`;
}

/** Independent native-property getters; never uses the production observer or executor receipts. */
export const FORM_AUDIT_READ = `(()=>{if(typeof window.__offerflashFormAudit!=='function')throw new Error('Fixture audit unavailable.');return window.__offerflashFormAudit();})()`;
export function readFormAudit(ids: readonly string[]): string {
  if (!Array.isArray(ids)||ids.length>300||ids.some(id=>!validID(id))||new Set(ids).size!==ids.length) throw new Error('Invalid fixture audit IDs.');
  return `(()=>{const result=${FORM_AUDIT_READ};const ids=new Set(${scriptJSON(ids)});return {...result,values:Object.fromEntries(Object.entries(result.values).filter(([id])=>ids.has(id))),events:result.events.filter(event=>ids.has(event.fieldId))};})()`;
}
