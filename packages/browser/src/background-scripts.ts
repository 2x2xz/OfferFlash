import { READ_FORM } from './read-scripts.js';
import { COMBOBOX_READ_HELPERS } from './combobox-scripts.js';

/** Fixed host scripts. This separate executor never sends native keys or mouse events. */
export const BACKGROUND_READ_FORM = String.raw`(() => {
  if(document.querySelector('input[type="password"]'))return {url:location.href,title:document.title,fields:[],protected:[],loginRequired:true};
  const raw = ${READ_FORM};
  const controls = Array.from(document.querySelectorAll('input,textarea,select'));
  const indexed=Array.from(document.querySelectorAll('input,textarea,select,[role="combobox"]')).filter(element=>!element.parentElement?.closest('[role="combobox"]'));
  return { ...raw, truncated: controls.length>300,
    validity:Object.fromEntries(raw.fields.map(field=>{const element=indexed[field.index];return [field.index,Boolean(element&&(!element.validity||element.validity.valid)&&element.getAttribute('aria-invalid')!=='true')]})),
    oversizedValue: controls.some(node=>!['hidden','password','file'].includes(node.type)&&String(node.value||'').length>2000),
    protected: controls.filter(node => ['checkbox','radio','file','password','hidden'].includes(node.type))
    .map((node,index) => ({index,type:node.type,name:node.getAttribute('name')||'',checked:Boolean(node.checked),
      files:node.type==='file'?Number(node.files?.length||0):0, hasValue:node.type==='password'?Boolean(node.value):false})),
    loginRequired: Boolean(document.querySelector('input[type="password"]')) };
})()`;

/** Snapshot excludes moving coordinates, but includes observed identities, values and control state. */
export function backgroundSnapshot(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || !('fields' in raw) || !Array.isArray(raw.fields)) throw new Error('后台网页结构无效。');
  const source = raw as Record<string, unknown>;
  return JSON.stringify({ url: source.url, fields: raw.fields.map(value => {
    if (!value || typeof value !== 'object') throw new Error('后台字段无效。');
    const { bounds: _bounds, ...stable } = value; return stable;
  }), protected: source.protected });
}

export interface BackgroundWriteRequest { url: string; index: number; value: string; expectedSnapshot: string; }
export function backgroundWriteScript(request: BackgroundWriteRequest): string {
  if (!Number.isInteger(request.index) || request.index < 0 || request.index >= 300 || typeof request.value !== 'string'
    || !request.value || request.value.length > 2000 || !request.expectedSnapshot || request.expectedSnapshot.length > 2_000_000) throw new Error('后台填写参数无效。');
  const payload = JSON.stringify(request).replace(/</g, '\\u003c');
  return String.raw`(() => {
    const request=${payload};
    const current=${BACKGROUND_READ_FORM};
    const stable=JSON.stringify({url:current.url,fields:current.fields.map(({bounds,...field})=>field),protected:current.protected});
    if(current.url!==request.url || stable!==request.expectedSnapshot) return {status:'stale'};
    if(current.loginRequired || current.truncated || current.oversizedValue) return {status:'unsupported'};
    ${COMBOBOX_READ_HELPERS}
    const target=formControls(document).slice(0,300)[request.index];
    const field=current.fields.find(field=>field.index===request.index);
    if(!target || !field || !field.editable || target.disabled || target.readOnly || target.closest('[role="combobox"],[contenteditable],[inert]')
      || !['text','email','tel','textarea','select','month'].includes(field.type)) return {status:'unsupported'};
    for(let parent=target.parentElement;parent;parent=parent.parentElement) {
      if(parent.matches('button,a[href],[role="button"],[role="link"]')) return {status:'unsupported'};
      if(parent.tagName==='LABEL' && (parent.control!==target || formControls(parent).length!==1
        || formControls(parent)[0]!==target || parent.querySelectorAll('button,a[href],[role="button"],[role="link"],[contenteditable]').length))return {status:'unsupported'};
    }
    const tag=target.tagName;
    if(!['INPUT','TEXTAREA','SELECT'].includes(tag)) return {status:'unsupported'};
    if(field.type==='month'){
      const month=/^\d{4}-(?:0[1-9]|1[0-2])$/;
      if(!month.test(request.value)||Number(request.value.slice(0,4))<1||month.test(target.min)&&request.value<target.min||month.test(target.max)&&request.value>target.max)return {status:'unsupported'};
    }
    if(tag==='SELECT') {
      if(target.multiple || target.size>1) return {status:'unsupported'};
      const currentOption=target.selectedOptions[0];
      const placeholder=/^(?:请选择|请选|选择|select|choose|please select|please choose|[-—\s]+)$/i;
      if(String(target.value||'').trim() && !(currentOption && placeholder.test(currentOption.text.trim()))) return {status:'nonempty'};
      const matches=Array.from(target.options).filter(option=>option.value===request.value && !option.disabled && !option.hidden && !option.closest('optgroup')?.disabled);
      if(matches.length!==1 || !request.value) return {status:'unsupported'};
    } else if(String(target.value||'').trim()!=='') return {status:'nonempty'};
    if(target.maxLength>=0 && request.value.length>target.maxLength) return {status:'unsupported'};
    const prototype=tag==='SELECT'?HTMLSelectElement.prototype:tag==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;
    if(typeof setter!=='function') return {status:'unsupported'};
    // No focus, click, key, submit, upload, date-picker or synthetic agreement event.
    // The website can still autosave in its own input/change handlers.
    setter.call(target,request.value);
    target.dispatchEvent(new Event('input',{bubbles:true}));
    target.dispatchEvent(new Event('change',{bubbles:true}));
    return {status:'written'};
  })()`;
}
