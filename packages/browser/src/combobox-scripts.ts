/** Shared read-only DOM helpers. These do not invoke page handlers or mutate DOM. */
export const COMBOBOX_READ_HELPERS = String.raw`
  const formControlSelector = 'input,textarea,select,[role="combobox"]';
  const formControls = root => Array.from(root.querySelectorAll(formControlSelector)).filter(element => {
    // A composite combobox owns its internal input; observe the owner once.
    const owner = element.parentElement?.closest('[role="combobox"]');
    return !owner;
  });
  const comboVisible = element => {
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute?.('aria-hidden') === 'true' || node.matches?.('[inert]')) return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const comboDisabled = element => {
    for (let node = element; node; node = node.parentElement) {
      if (node.disabled || node.getAttribute?.('aria-disabled') === 'true' || node.matches?.('[inert]')) return true;
    }
    return false;
  };
  const comboActivatingElement = element => {
    const role = (element.getAttribute('role') || '').trim().toLowerCase();
    return ['BUTTON', 'SUMMARY', 'LABEL', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)
      || element.tagName === 'A' && element.hasAttribute('href')
      || element.hasAttribute('contenteditable')
      || ['button', 'link', 'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab'].includes(role);
  };
  const comboActivatingAncestor = element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (comboActivatingElement(parent)) return true;
    }
    return false;
  };
  const comboInput = element => {
    if (element.tagName === 'INPUT') return ['text', 'search'].includes(element.type || 'text') ? element : null;
    const inputs = Array.from(element.querySelectorAll?.('input') || []);
    return inputs.length === 1 && ['text', 'search'].includes(inputs[0].type || 'text') ? inputs[0] : null;
  };
  // A cached sibling menu is accepted only inside a two-child, one-owner wrapper.
  // No class names, model selectors or DOM mutation establish this relationship.
  const localComboMenu = element => {
    if(element?.tagName!=='INPUT'||!['text','search'].includes(element.type)||element.getAttribute('role')!=='combobox'
      ||!['true','false'].includes(element.getAttribute('aria-expanded'))||element.hasAttribute('aria-controls')||element.hasAttribute('aria-owns'))return null;
    const parent=element.parentElement;
    if(!parent||parent.tagName!=='DIV'||parent.children.length!==2||parent.querySelectorAll(formControlSelector).length!==1)return null;
    const menu=Array.from(parent.children).find(n=>n!==element);
    if(!menu||!['DIV','UL','OL'].includes(menu.tagName)||!['','listbox'].includes(menu.getAttribute('role')||'')||menu.getAttribute('aria-multiselectable')==='true')return null;
    const options=Array.from(menu.querySelectorAll('[role="option"]'));
    if(!options.length||options.length>80||options.some(n=>!['DIV','SPAN','LI','BUTTON'].includes(n.tagName)
      ||n.tagName==='BUTTON'&&n.getAttribute('type')!=='button'
      ||n.querySelector('button,a[href],input,textarea,select,[role="option"],[contenteditable],iframe,object,embed,summary')))return null;
    const active=Array.from(menu.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[role="combobox"],[role="listbox"],[contenteditable],iframe,object,embed,summary'));
    if(active.some(n=>!options.includes(n)))return null;
    return menu;
  };
  const comboBinding = element => {
    if ((element.getAttribute('role') || '').trim().toLowerCase() !== 'combobox' || element.tagName === 'SELECT') return null;
    // Native clicks must not activate navigation or the form's default submit.
    // A harmless-looking span may still activate an enclosing submit button,
    // link or label. Its own role and descendants are not enough to prove safety.
    if (comboActivatingAncestor(element)) return null;
    if (['SUMMARY', 'LABEL', 'TEXTAREA', 'FORM', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO'].includes(element.tagName)
      || element.hasAttribute('contenteditable')) return null;
    if ((element.tagName === 'A' && element.hasAttribute('href'))
      || (element.tagName === 'BUTTON' && (element.getAttribute('type') || '').trim().toLowerCase() !== 'button')) return null;
    if (Array.from(element.querySelectorAll('button,a,[role="button"],summary,iframe,object,embed,[contenteditable]'))
      .some(child => child.tagName !== 'A' || child.hasAttribute('href') || child.getAttribute('role') === 'button')) return null;
    if ((element.tagName === 'INPUT' || element.querySelectorAll('input').length > 0) && !comboInput(element)) return null;
    if (element.querySelectorAll('textarea,select,[role="combobox"]').length > 0
      || element.querySelectorAll('input').length > 1) return null;
    const controls = (element.getAttribute('aria-controls') || '').trim();
    const owns = (element.getAttribute('aria-owns') || '').trim();
    if (controls && owns && controls !== owns) return null;
    if(!controls&&!owns){
      const menu=localComboMenu(element);
      return menu?{kind:'local-single-select',relationship:'sibling',popupId:':local-sibling:',valueSource:'input-value'}:null;
    }
    const relationship = controls ? 'controls' : 'owns';
    const ids = (controls || owns).split(/\s+/).filter(Boolean);
    if (ids.length !== 1 || ids[0].length > 240 || /[\u0000-\u001f\u007f]/u.test(ids[0])) return null;
    const popupType = (element.getAttribute('aria-haspopup') || '').trim().toLowerCase();
    const autocomplete = (element.getAttribute('aria-autocomplete') || '').trim().toLowerCase();
    if ((popupType && popupType !== 'listbox') || (autocomplete && autocomplete !== 'none')) return null;
    const valueSource = element.tagName !== 'INPUT' && element.hasAttribute('aria-valuetext') ? 'aria-valuetext'
      : comboInput(element) ? 'input-value' : element.hasAttribute('aria-valuetext') ? 'aria-valuetext' : '';
    if (!valueSource) return null;
    return { kind: 'aria-single-select', relationship, popupId: ids[0], valueSource };
  };
  const comboValue = (element, binding) => binding?.valueSource === 'aria-valuetext'
    ? String(element.getAttribute('aria-valuetext') || '')
    : String(comboInput(element)?.value || '');
  const comboOwnerIdentity = (element, binding) => {
    const input = comboInput(element),menu=binding?.kind==='local-single-select'?localComboMenu(element):null;
    return JSON.stringify([
      menu?[menu.tagName,menu.id||'',menu.getAttribute('role')||'',menu.children.length]:null,
      element.tagName, element.id || '', element.name || '', (element.getAttribute('role') || '').trim().toLowerCase(),
      element.getAttribute('aria-controls') || '', element.getAttribute('aria-owns') || '',
      element.getAttribute('aria-haspopup') || '', element.getAttribute('aria-autocomplete') || '', binding,
      input ? [input.id || '', input.name || '', input.type || 'text', Boolean(input.readOnly),
        input.getAttribute('autocomplete') || '', input.maxLength ?? -1] : null,
    ]);
  };
  const comboFocused = element => Boolean(element && document.activeElement
    && (element === document.activeElement || element.contains?.(document.activeElement)));
  const comboOptionLabel = element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement && comboVisible(node.parentElement)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const parts = [];
    while (parts.length < 80 && walker.nextNode()) parts.push(walker.currentNode.nodeValue || '');
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  };
  const observeComboPopup = (index, popupId) => {
    const element = formControls(document).slice(0, 300)[index];
    const binding = element ? comboBinding(element) : null;
    const owner = { exists: Boolean(element), expanded: element?.getAttribute('aria-expanded') === 'true',
      popupId: binding?.popupId || '', value: element ? comboValue(element, binding) : '',
      disabled: !element || comboDisabled(element), identity: element ? comboOwnerIdentity(element, binding) : '',
      focused: comboFocused(element) };
    const empty = { owner, popup: null, element, popupElement: null, entries: [] };
    if (!element || !binding || binding.popupId !== popupId || !owner.expanded || owner.disabled || !comboVisible(element)) return empty;
    if (binding.kind!=='local-single-select' && formControls(document).some(other => other !== element && other.getAttribute('aria-expanded') === 'true'
      && comboBinding(other)?.popupId === popupId)) return empty;
    const local=binding.kind==='local-single-select';
    const candidates=local?[localComboMenu(element)].filter(Boolean):Array.from(document.querySelectorAll('[id]')).filter(node=>node.id===popupId);
    if (candidates.length !== 1) return empty;
    const popup = candidates[0];
    if ((!local&&(popup.getAttribute('role') || '').trim().toLowerCase() !== 'listbox') || !comboVisible(popup)
      || comboDisabled(popup) || comboActivatingElement(popup) || comboActivatingAncestor(popup)
      || popup.getAttribute('aria-multiselectable') === 'true'
      || popup.querySelectorAll(formControlSelector).length > 0
      || popup.querySelectorAll('[role="listbox"]').length > 0) return empty;
    const rawOptions = Array.from(popup.querySelectorAll('[role="option"]'));
    if (rawOptions.length > 500) return empty;
    const identity = JSON.stringify([owner.identity, popupId, local?'local-single-select':'listbox', false]);
    const entries = rawOptions.flatMap((option, optionIndex) => {
      if ((!local&&option.closest('[role="listbox"]') !== popup) || !comboVisible(option) || comboDisabled(option)
        || !(local&&option.tagName==='BUTTON'&&option.getAttribute('type')==='button')&&comboActivatingElement(option) || comboActivatingAncestor(option)) return [];
      if ((!local&&option.tagName==='BUTTON')||['A', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SUMMARY', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO', 'FORM'].includes(option.tagName)
        || Array.from(option.querySelectorAll('button,a,[role="button"],input,textarea,select,[role="combobox"],summary,iframe,object,embed,[contenteditable]'))
          .some(child => child.tagName !== 'A' || child.hasAttribute('href') || child.getAttribute('role') === 'button')) return [];
      const label = comboOptionLabel(option);
      if (!label) return [];
      const rect = option.getBoundingClientRect();
      const data = { index: optionIndex, id: option.id || '', label, disabled: false,
        selected: option.getAttribute('aria-selected') === 'true',
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      return [{ element: option, data: { ...data, identity: JSON.stringify([
        identity, data.index, data.id, data.label, data.disabled, data.selected,
      ]) } }];
    });
    return { owner, popup: { id: popupId, multi: false, options: entries.map(entry => entry.data), identity },
      element, popupElement: popup, entries };
  };
`;

function validateArguments(index: number, popupId: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= 300 || typeof popupId !== 'string'
    || !popupId || popupId.length > 240 || /[\s\u0000-\u001f\u007f]/u.test(popupId)) throw new Error('自定义下拉定位无效。');
}

export function readComboboxPopup(index: number, popupId: string): string {
  validateArguments(index, popupId);
  return `(() => { /* offeragent-read-combobox-popup */ ${COMBOBOX_READ_HELPERS}
    const observed = observeComboPopup(${index}, ${JSON.stringify(popupId)});
    return { url: location.href, owner: observed.owner, popup: observed.popup };
  })()`;
}

export function readComboboxOptionTarget(index: number, popupId: string, optionIndex: number, x: number, y: number): string {
  validateArguments(index, popupId);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= 500 || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('自定义下拉选项定位无效。');
  }
  return `(() => { /* offeragent-read-combobox-option-target */ ${COMBOBOX_READ_HELPERS}
    const observed = observeComboPopup(${index}, ${JSON.stringify(popupId)});
    const entry = observed.entries.find(candidate => candidate.data.index === ${optionIndex});
    const hit = document.elementFromPoint(${x}, ${y});
    return { url: location.href, exists: Boolean(entry),
      uncovered: Boolean(entry && hit && (hit === entry.element || entry.element.contains(hit))),
      focused: observed.owner.focused || comboFocused(observed.popupElement), value: observed.owner.value,
      valid: Boolean(observed.element && (!observed.element.validity || observed.element.validity.valid)
        && observed.element.getAttribute('aria-invalid') !== 'true'),
      selected: entry?.data.selected === true, identity: entry?.data.identity || '',
      ownerIdentity: observed.owner.identity, popupIdentity: observed.popup?.identity || '',
      label: entry?.data.label || '', id: entry?.data.id || '', popupId: observed.owner.popupId,
      expanded: observed.owner.expanded };
  })()`;
}
