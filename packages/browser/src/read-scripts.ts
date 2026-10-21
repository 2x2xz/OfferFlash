/** Read-only page observations. No setters, focus(), clicks or synthetic DOM events. */
import { COMBOBOX_READ_HELPERS } from './combobox-scripts.js';
import {OWNED_SELECT_HELPERS} from './select-shape.js';

export const READ_FORM = String.raw`(() => {
  ${COMBOBOX_READ_HELPERS}
  const text = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const visibleTextNode = element => {
    for (let parent = element; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.getAttribute?.('aria-hidden') === 'true') return false;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const labelText = label => {
    if (!label || !visibleTextNode(label) || label.closest('input,textarea,select,[role="combobox"],script,style')) return '';
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest('input,textarea,select,[role="combobox"],script,style') || !visibleTextNode(node.parentElement)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const parts = [];
    while (parts.length < 80 && walker.nextNode()) parts.push(walker.currentNode.nodeValue || '');
    return parts.join(' ');
  };
  const controlSelector = formControlSelector;
  const questionSelector = '.application-question,fieldset,[role="group"]';
  const sectionSelector = questionSelector + ',section,.form-section';
  const ownHeading = group => {
    if (!group) return '';
    const headings = Array.from(group.querySelectorAll?.('legend,h1,h2,h3,h4,.application-label') || [])
      .filter(candidate => candidate.closest(sectionSelector) === group && text(labelText(candidate)));
    if (headings.length === 1) return text(labelText(headings[0]));
    if (headings.length) return '';
    const localTitles = Array.from(group.children || []).filter(candidate => candidate.matches?.('div,span')
      && !candidate.querySelector(controlSelector) && !candidate.querySelector('button,a[href],[role="button"]')
      && visibleTextNode(candidate) && text(labelText(candidate)) && labelText(candidate).trim().length <= 120);
    return localTitles.length === 1 ? text(labelText(localTitles[0])) : '';
  };
  const nearbyLabel = element => {
    // Phoenix separates its label and control, sometimes by nine wrapper levels.
    // Use the nearest explicit field owner, never a whole section or widget hint.
    let phoenixOwner = null;
    for (let p = element.parentElement, depth = 0; p && depth < 12; p = p.parentElement, depth++) {
      if (['FORM','BODY','HTML','MAIN'].includes(p.tagName)) break;
      if (p.matches('.form-item') && p.matches('.form-item--phoenix')) { phoenixOwner = p; break; }
    }
    if (phoenixOwner) {
      const owned = formControls(phoenixOwner).filter(c => c.type !== 'hidden' && visibleTextNode(c) && c.getBoundingClientRect().width > 0 && c.getBoundingClientRect().height > 0);
      const titles = Array.from(phoenixOwner.querySelectorAll('.form-item__title')).filter(t => t.closest('.form-item') === phoenixOwner && visibleTextNode(t) && text(labelText(t)));
      if (owned.length === 1 && owned[0] === element && titles.length === 1) return text(labelText(titles[0]));
      return '';
    }
    // A single field wrapper may omit for/ARIA. Do not infer ownership from
    // a whole form or from a container holding another visible control.
    const parents = [];
    for (let parent = element.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
      if (['FORM', 'BODY', 'HTML', 'MAIN'].includes(parent.tagName)) break;
      const controls = formControls(parent).filter(control => {
        const rect = control.getBoundingClientRect();
        return control.type !== 'hidden' && rect.width > 0 && rect.height > 0 && visibleTextNode(control);
      });
      if (controls.length !== 1 || controls[0] !== element) continue;
      parents.push(parent);
    }
    for (const parent of parents) {
      if (parent.matches?.('.application-question')) {
        const question = ownHeading(parent);
        if (question) return question;
      }
    }
    for (const parent of parents) {
      const children = Array.from(parent.children || []);
      for (const selector of ['label', 'p,h1,h2,h3,h4', 'div,span']) {
        const candidates = children.filter(candidate => candidate.matches(selector)
          && (!candidate.getAttribute('for') || candidate.getAttribute('for') === element.id)
          && !candidate.querySelector(controlSelector) && text(labelText(candidate))
          && (selector !== 'div,span' || (labelText(candidate).trim().length <= 120
            && !candidate.matches('[role="alert"],[role="status"],.error,.help,.hint,.form-item-error,.ant-form-item-explain,.ant-form-item-extra')
            && !candidate.querySelector('button,a[href],[role="button"],h1,h2,h3,h4,label'))));
        if (candidates.length === 1) return text(labelText(candidates[0]));
      }
    }
    return '';
  };
  const controls = formControls(document).slice(0, 300);
  const fields = controls.flatMap((element, index) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const type = element.tagName !== 'SELECT' && ((element.getAttribute('role') || '').trim().toLowerCase() === 'combobox' || element.matches?.('.phoenix-select__input'))
      ? 'combobox' : element.tagName === 'SELECT' ? (element.multiple || element.size > 1 ? 'select-multiple' : 'select') : element.tagName === 'TEXTAREA' ? 'textarea' : element.type || 'text';
    const binding = type === 'combobox' ? comboBinding(element) : null;
    if (type === 'hidden' || rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || !visibleTextNode(element)) return [];
    const ariaIds = (element.getAttribute('aria-labelledby') || '').split(/\s+/);
    const labelled = text(ariaIds.map(id => labelText(document.getElementById(id))).join(' '));
    const labels = Array.from(element.labels || []).map(labelText).join(' ');
    const label = text(element.getAttribute('aria-label') || labelled || text(labels) || nearbyLabel(element) || element.getAttribute('placeholder') || element.name || element.id);
    const group = element.closest(questionSelector) || element.closest('section,.form-section');
    const section = text(ownHeading(group) || group?.getAttribute('aria-label'));
    const unsafe = /紧急联系|推荐人|联系人姓名|联系人电话|亲属|配偶|父亲|母亲|监护|证明人|emergency|referee|reference|guardian|spouse|parent|supervisor|密码|验证码|身份证|证件号码|护照|银行卡|银行账号|出生|生日|password|passcode|verification|captcha|passport|national.?id|social.?security|bank|birth/i.test(label + ' ' + section) || type === 'password';
    const rawValue = type === 'combobox' ? comboValue(element, binding) : String(element.value || '');
    const value = unsafe ? (rawValue ? '[已有值]' : '') : rawValue.slice(0, 2000);
    const options = type==='combobox'&&binding?.kind==='local-single-select'?Array.from(localComboMenu(element).querySelectorAll('[role="option"]')).map(n=>({label:text(n.textContent),value:text(n.textContent)})):type === 'select' ? Array.from(element.options).filter(option => !option.disabled && !option.hidden && !option.closest('optgroup')?.disabled).map(option => ({ label: text(option.text), value: String(option.value).slice(0, 500) })) : [];
    return [{ index, label, type, value, section, options, required: Boolean(element.required) || element.getAttribute('aria-required') === 'true' || /^[*＊﹡✱✳⋆]/u.test(label),
      ...(['radio', 'checkbox'].includes(type) ? { checked: Boolean(element.checked) } : {}),
      ...(binding ? { customSelect: binding } : {}),
      editable: !comboDisabled(element) && (!element.readOnly || Boolean(binding)) && !(type === 'select' && element.options.length > 500),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      identity: [element.id || '', element.name || '', element.getAttribute('autocomplete') || '', element.maxLength ?? -1,
        element.min || '', element.max || '', element.step || '', element.multiple ? 'multiple' : '', element.size || 0].join('|')
        + (type === 'combobox' ? '|' + comboOwnerIdentity(element, binding) : '') }];
  });
  return { url: location.href, title: document.title, fields, viewport: { width: innerWidth, height: innerHeight } };
})()`;

/** Local locator comparison only. Values/identities remain private; scrolling may change geometry. */
export function locationObservationSnapshot(value: unknown): string {
  const result = JSON.stringify(value, (key, entry: unknown) => key === 'bounds' || key === 'viewport' ? undefined
    : entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
  if (typeof result !== 'string' || result.length > 4_000_000) throw new Error('定位观察快照无效。');
  return result;
}

/** Host-owned locator only: exact freshly reread snapshot + existing control index, no focus or input. */
export function revealObservedField(index: number, expectedSnapshot: string): string {
  if (!Number.isInteger(index) || index < 0 || index >= 300 || typeof expectedSnapshot !== 'string'
    || !expectedSnapshot || expectedSnapshot.length > 4_000_000) throw new Error('字段定位快照无效。');
  return `(() => { /* offeragent-reveal-observed-field */
    ${COMBOBOX_READ_HELPERS}
    const observed = ${READ_FORM};
    const snapshot = (${locationObservationSnapshot.toString()})(observed);
    if (snapshot !== ${JSON.stringify(expectedSnapshot)}) return {url:location.href,exists:false,scrolled:false,reason:'changed'};
    const matches = observed.fields.filter(field => field.index === ${index});
    const target = formControls(document).slice(0,300)[${index}];
    if (matches.length !== 1 || !target) return {url:location.href,exists:false,scrolled:false,reason:'missing'};
    try { Element.prototype.scrollIntoView.call(target,{behavior:'instant',block:'center',inline:'nearest'}); }
    catch { return {url:location.href,exists:true,scrolled:false,reason:'blocked'}; }
    return {url:location.href,exists:true,scrolled:true,reason:'requested'};
  })()`;
}

export const READ_PAGE = String.raw`(() => ({
  url: location.href, title: document.title,
  text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 12000)
}))()`;

/** Local diagnostics only. No values, IDs, URLs or executable selectors are returned. */
export const READ_FORM_STRUCTURE = String.raw`(() => {
  ${COMBOBOX_READ_HELPERS}
  ${OWNED_SELECT_HELPERS}
  const visible = e => {for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(n.hidden||n.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden')return false;}const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const classes = e => Array.from(e.classList||[]).filter(s=>/^[a-zA-Z][a-zA-Z_-]{1,70}$/.test(s)).slice(0,8);
  const label = e => {if(e.querySelector(formControlSelector))return '';const value=(e.textContent||'').replace(/\s+/g,' ').trim();return value.length<=120?value:'';};
  return {controls:formControls(document).slice(0,300).flatMap((e,index)=>{
    if(e.type==='hidden'||!visible(e))return [];
    const ancestors=[];
    for(let p=e.parentElement,depth=1;p&&depth<=10;p=p.parentElement,depth++){
      if(['FORM','BODY','HTML','MAIN'].includes(p.tagName))break;
      const children=Array.from(p.children||[]);
      ancestors.push({depth,tag:p.tagName,classes:classes(p),visibleControls:formControls(p).filter(visible).length,
        labels:children.filter(n=>n.matches('label,p,h1,h2,h3,h4,div,span')&&visible(n)&&label(n)).slice(0,8).map(n=>({tag:n.tagName,classes:classes(n),text:label(n)})),
        nestedLabelCount:Array.from(p.querySelectorAll('label')).filter(n=>visible(n)&&label(n)).length});
    }
    const owner=selectLabel(e),scope=owner?selectScope(e):null;
    return [{index,tag:e.tagName,type:e.type||e.getAttribute('role')||'',classes:classes(e),ancestors,
      selectSignals:{owned:selectOwned(e),labelSelect:!!owner?.matches('label.select'),range:!!e.closest('.month-range-select'),arrowInLabel:!!owner&&selectArrow(owner),scopeFound:!!scope,selectedMarkers:owner?Array.from(owner.querySelectorAll('[class*="Input-display-value-"]')).filter(visible).length:0}}];
  })};
})()`;

export const READ_JOB_LINKS = String.raw`(() => {
  const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 3000).flatMap(anchor => {
    const rect = anchor.getBoundingClientRect();
    const style = getComputedStyle(anchor);
    if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') return [];
    // A recruiting link often wraps the entire card. Preserve its heading,
    // instead of turning location, team introduction and requirements into a title.
    const rawText = (anchor.innerText || '').trim();
    const heading = anchor.querySelector('h1,h2,h3,h4,[role="heading"]');
    const title = (heading?.innerText || rawText.split(/\n+/).find(line => line.trim()) || '').replace(/\s+/g, ' ').trim();
    if (!title) return [];
    const card = anchor.closest('li,article,[role="listitem"],.job-item,.position-item') || anchor.querySelector('.positionItem');
    const bytedanceMetadata = location.hostname === 'jobs.bytedance.com'
      ? anchor.querySelector('.positionItem-subTitle')?.querySelectorAll(':scope > span') : undefined;
    return [{ url: anchor.href, title: title.slice(0, 140),
      city: (bytedanceMetadata?.[0]?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      recruitmentLabel: (bytedanceMetadata?.[1]?.innerText || '').trim().slice(0, 40),
      context: (card?.innerText || rawText).replace(/\s+/g, ' ').trim().slice(0, 1400) }];
  });
  return { url: location.href, title: document.title, anchors };
})()`;

/** Only trusted numeric coordinates and an observed control index enter this reader. */
export function readTarget(index: number, x: number, y: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 300 || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('字段定位无效。');
  }
  return `(() => {
    ${COMBOBOX_READ_HELPERS}
    const target = formControls(document).slice(0, 300)[${index}];
    const hit = document.elementFromPoint(${x}, ${y});
    const binding = target ? comboBinding(target) : null;
    const isCombo = target && (target.getAttribute('role') || '').trim().toLowerCase() === 'combobox';
    return { exists: Boolean(target), focused: Boolean(target && (target === document.activeElement || (isCombo && target.contains(document.activeElement)))),
      uncovered: Boolean(target && hit && (hit === target || target.contains(hit))),
      value: target && target.type !== 'password' ? (isCombo ? comboValue(target, binding) : String(target.value || '')) : '',
      valid: Boolean(target && (!target.validity || target.validity.valid) && target.getAttribute('aria-invalid') !== 'true'), url: location.href };
  })()`;
}

/** Locator-only page wheel point. It cannot target controls, links or popup lists. */
export function readLocationWheelTarget(point?: { x: number; y: number }): string {
  if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('滚动位置无效。');
  return `(() => { /* offeragent-read-location-wheel-target */
    const active = document.activeElement;
    const wheelControl = active && (active.matches('select,input[type="number"],input[type="range"],input[type="date"],input[type="month"],input[type="time"],[role="combobox"],[role="spinbutton"],[role="slider"]')
      || active.closest('[role="listbox"],[role="menu"]'));
    const points = ${point ? JSON.stringify([point]) : '[{x:12,y:innerHeight/2},{x:innerWidth-12,y:innerHeight/2},{x:12,y:innerHeight/3}]'};
    for (const {x,y} of points) {
      const hit = !wheelControl && document.elementFromPoint(x,y);
      if (!hit || hit.closest('input,textarea,select,button,a[href],[role="combobox"],[role="button"],[role="spinbutton"],[role="slider"],[role="listbox"],[role="menu"],[contenteditable]')) continue;
      const style = getComputedStyle(hit); if (style.visibility !== 'visible' || style.display === 'none') continue;
      const path=[]; let node=hit;
      for (let depth=0;node && depth<24;depth++,node=node.parentElement) path.push([typeof node.tagName==='string'?node.tagName:'',node.getAttribute('id')||'',node.getAttribute('class')||'',node.parentElement?Array.from(node.parentElement.children).indexOf(node):-1]);
      return {url:location.href,exists:true,x,y,pointerIdentity:JSON.stringify(path)};
    }
    return {url:location.href,exists:false};
  })()`;
}

/** Atomic host-owned YYYY-MM write; foreground callers must retain all native focus/position guards. */
export function writeObservedMonth(index:number,url:string,value:string,expectedSnapshot:string):string {
  if(!Number.isInteger(index)||index<0||index>=300||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)||Number(value.slice(0,4))<1||!url||!expectedSnapshot||expectedSnapshot.length>4_000_000)throw new Error('月份写入参数无效。');
  return `(()=>{ /* offeragent-write-observed-month */
    ${COMBOBOX_READ_HELPERS}
    const raw=${READ_FORM};
    if(location.href!==${JSON.stringify(url)}||(${locationObservationSnapshot.toString()})(raw)!==${JSON.stringify(expectedSnapshot)})return {written:false};
    const target=formControls(document)[${index}],field=raw.fields.find(f=>f.index===${index});
    const value=${JSON.stringify(value)},month=/^\\d{4}-(?:0[1-9]|1[0-2])$/;
    if(!target||target.tagName!=='INPUT'||target.type!=='month'||!field?.editable||target.disabled||target.readOnly||target.value!==''||!document.hasFocus()||document.activeElement!==target
      ||target.closest('[inert],[role="combobox"],button,a[href]')||month.test(target.min)&&value<target.min||month.test(target.max)&&value>target.max)return {written:false};
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)return {written:false};
    setter.call(target,value);target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));
    const after=${READ_FORM};
    const expected={...raw,fields:raw.fields.map(f=>f.index===${index}?{...f,value}:f)};
    return {written:true,stable:(${locationObservationSnapshot.toString()})(after)===(${locationObservationSnapshot.toString()})(expected),valid:target.value===value&&target.validity.valid};
  })()`;
}
