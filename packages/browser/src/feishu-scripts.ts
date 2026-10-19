/**
 * Read-only adapter for the reviewed legacy Feishu recruiting form. The page is
 * never asked to run handlers: the host uses the returned identities and native
 * mouse/keyboard events, then reads again. Formily and other tenants are outside
 * this adapter's scope until their actual DOM has been reviewed.
 */
import { locationObservationSnapshot } from './read-scripts.js';

export type FeishuCareerKind = 'education' | 'internship' | 'project';
export type FeishuDateSide = 'start' | 'end';

const FEISHU_PRODUCTION_SCOPE = String.raw`const fsScope = () => location.protocol === 'https:' && location.hostname === 'modelbest.jobs.feishu.cn'
    && (!location.port || location.port === '443');`;

export const FEISHU_READ_HELPERS = String.raw`
  const fsKinds = ['education', 'internship', 'project'];
  const fsProperties = { education: ['school', 'degree', 'fieldOfStudy', 'period'],
    internship: ['company', 'title', 'desc', 'period'], project: ['name', 'role', 'link', 'desc', 'period'] };
  const fsText = (value, limit = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const fsClasses = node => (node?.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  // Reviewed rc-select/date-picker state classes change during a native hover or
  // expansion. Their values are observed separately; they are not identity.
  const fsIdentityClass = node => {
    const classes = fsClasses(node);
    const dateScrollList = classes.includes('ps') && classes.includes('atsx-date-picker-period-month-panel-list');
    return classes.filter(value => !/-(?:focus|focused|open|item-selected|item-focused)$/.test(value)
      && !(dateScrollList && ['ps--scrolling-x', 'ps--scrolling-y'].includes(value))).join(' ');
  };
  const fsHasClass = (node, value) => fsClasses(node).includes(value);
  ${FEISHU_PRODUCTION_SCOPE}
  const fsVisible = element => {
    if (!element) return false;
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('inert')) return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return false;
    }
    const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0;
  };
  const fsDisabled = element => {
    for (let node = element; node; node = node.parentElement) {
      if (node.disabled || node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('inert')) return true;
    }
    return false;
  };
  const fsBounds = node => { const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
  const fsAll = (node, selector) => Array.from(node.querySelectorAll(selector));
  const fsCy = (node, value) => fsAll(node, '[data-cy]').filter(candidate => candidate.getAttribute('data-cy') === value);
  const fsUniqueCy = (node, value) => { const found = fsCy(node, value); return found.length === 1 ? found[0] : null; };
  const fsActivating = node => ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'FORM', 'IFRAME', 'OBJECT', 'EMBED'].includes(node.tagName)
    || node.tagName === 'A' && node.hasAttribute('href') || node.hasAttribute('contenteditable')
    || ['button', 'link', 'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab'].includes(node.getAttribute('role'));
  const fsDangerousAncestor = (node, stop) => {
    for (let parent = node.parentElement; parent && parent !== stop; parent = parent.parentElement) {
      // A form is a container; its default button and label descendants are not.
      if (parent.tagName !== 'FORM' && fsActivating(parent)) return true;
    }
    return false;
  };
  const fsDangerousDescendant = node => fsAll(node, 'button,a,input,textarea,select,summary,label,iframe,object,embed,[contenteditable],[role="button"],[role="link"],[role="checkbox"],[role="radio"]')
    .some(child => child.tagName !== 'A' || child.hasAttribute('href'));
  const fsPath = path => {
    const found = /^(education|internship|project)\[(0|[1-9]\d{0,5})\]\.(school|degree|fieldOfStudy|company|title|desc|name|role|link|period)$/.exec(path || '');
    return found && fsProperties[found[1]].includes(found[3]) ? { kind: found[1], key: found[2], property: found[3], path: found[0] } : null;
  };
  const fsGroupRoot = node => node.closest('.resumeEditForm-item');
  const fsSections = kind => fsAll(document, '.resumeEditForm-' + kind).filter(node => !fsHasClass(node, 'resumeEditForm-item')
    && node.closest('.createFormSection-container') && fsClasses(node).some(value => /^createFormSection__[a-zA-Z0-9]+$/.test(value)));
  const fsSection = kind => { const found = fsSections(kind); return found.length === 1 ? found[0] : null; };
  const fsGroupNodes = (section, kind) => fsAll(section, '.resumeEditForm-item').filter(node => fsHasClass(node, 'resumeEditForm-' + kind)
    && node.closest('.createFormSection-container') === section.closest('.createFormSection-container')
    && !fsGroupRoot(node.parentElement));
  const fsFieldWrappers = node => fsAll(node, '[data-cy]').filter(candidate => fsPath(candidate.getAttribute('data-cy')));
  const fsSelect = (wrapper, path) => {
    // Live legacy DOM places data-cy on the selection owner, not its outer
    // rc-select shell. That shell supplies the actual mode/disabled classes.
    const owner = fsUniqueCy(wrapper, path + 'Input');
    const shell = owner?.parentElement;
    if (!owner || owner.getAttribute('role') !== 'combobox' || !fsHasClass(owner, 'atsx-select-selection--single')
      || !shell || !fsHasClass(shell, 'atsx-select') || fsDangerousAncestor(shell, wrapper) || fsAll(shell, '[data-cy="notSingleMode"]').length
      || fsClasses(shell).some(value => /(?:^|-)(?:multiple|tags|combobox)(?:$|-)/.test(value))) return null;
    const owners = fsAll(shell, '[role="combobox"]');
    if (owners.length !== 1) return null;
    if (owners[0] !== owner) return null;
    if (!['DIV', 'SPAN'].includes(owner.tagName) || fsDangerousAncestor(owner, wrapper)) return null;
    const controls = (owner.getAttribute('aria-controls') || '').trim();
    const owns = (owner.getAttribute('aria-owns') || '').trim();
    if (!controls || /[\s\u0000-\u001f\u007f]/u.test(controls) || controls.length > 240 || owns && owns !== controls
      || !['true', 'listbox', ''].includes(owner.getAttribute('aria-haspopup') || '')) return null;
    const inputs = fsAll(shell, 'input');
    if (inputs.length > 1 || inputs.some(input => !['text', 'search'].includes(input.type || 'text'))
      || fsAll(shell, 'textarea,select,button,a[href],[role="button"],[contenteditable]').length) return null;
    const selected = fsCy(owner, 'selectedValue');
    if (selected.length > 1 || !selected.length && inputs.some(input => String(input.value || '').trim())) return null;
    const value = selected.length ? fsText(selected[0].textContent, 2000) : '';
    if (selected.length && !value) return null;
    return { shell, owner, popupId: controls, value, identity: JSON.stringify([
      path, shell.tagName, shell.id || '', fsIdentityClass(shell), owner.tagName,
      owner.id || '', controls, owns, owner.getAttribute('aria-haspopup') || '', fsIdentityClass(owner),
    ]) };
  };
  const fsDate = (wrapper, path, side) => {
    const root = fsUniqueCy(wrapper, path + 'Input');
    if (!root || !fsClasses(root).some(value => /-date-picker-period-month$/.test(value))) return null;
    const suffix = side === 'start' ? 'Begin' : 'End';
    const target = fsUniqueCy(root, path + 'Input' + suffix);
    if (!target || target.tagName !== 'DIV' || fsDangerousAncestor(target, wrapper)) return null;
    const years = fsCy(target, 'year'), months = fsCy(target, 'month');
    const toToday = fsAll(target, 'span').filter(node => fsClasses(node).some(value => /-toToday$/.test(value)));
    let value = '', year = '', month = '', untilNow = false;
    if (side === 'end' && toToday.length === 1 && !years.length && !months.length) {
      if (!fsHasClass(toToday[0], 'atsx-date-picker-period-month-label-toToday') || !fsVisible(toToday[0])) return null;
      value = fsText(toToday[0].textContent); if (value !== '至今') return null; untilNow = true;
    }
    else {
      if (years.length !== 1 || months.length !== 1 || toToday.length) return null;
      year = fsText(years[0].textContent); month = fsText(months[0].textContent);
      if (!/^(?:\d{4}|YYYY)$/.test(year) || !/^(?:0[1-9]|1[0-2]|MM)$/.test(month)) return null;
      value = year === 'YYYY' && month === 'MM' ? '' : year + '-' + month;
    }
    return { root, target, value, year, month, untilNow, popupCy: path + 'Input' + suffix + 'Dropdown',
      identity: JSON.stringify([path, side, root.id || '', fsIdentityClass(root), target.getAttribute('data-cy'), fsIdentityClass(target)]) };
  };
  const fsField = (wrapper, parsed) => {
    if (!wrapper || fsDangerousAncestor(wrapper, null)) return null;
    const common = { path: parsed.path, property: parsed.property, kind: parsed.kind, key: parsed.key };
    if (parsed.property === 'period') {
      const start = fsDate(wrapper, parsed.path, 'start'), end = fsDate(wrapper, parsed.path, 'end');
      if (!start || !end) return null;
      return [start, end].map((date, index) => ({ ...common, fieldId: parsed.path + ':' + (index ? 'end' : 'start'),
        type: 'feishu-month', side: index ? 'end' : 'start', value: date.value, year: date.year, month: date.month,
        untilNow: date.untilNow,
        supportsUntilNow: index === 1 && ['internship', 'project'].includes(parsed.kind),
        editable: !fsDisabled(date.target), bounds: fsBounds(date.target), identity: date.identity }));
    }
    if (parsed.property === 'degree') {
      const select = fsSelect(wrapper, parsed.path); if (!select) return null;
      return [{ ...common, fieldId: parsed.path, type: 'feishu-single-select', value: select.value, popupId: select.popupId,
        editable: !fsDisabled(select.shell) && !fsDisabled(select.owner), bounds: fsBounds(select.owner), identity: select.identity }];
    }
    const inputs = fsAll(wrapper, 'input,textarea').filter(node => (node.type || 'text') !== 'hidden');
    if (inputs.length !== 1) return null;
    const input = inputs[0];
    if (!['INPUT', 'TEXTAREA'].includes(input.tagName) || input.tagName === 'INPUT' && !['text', 'search', 'url'].includes(input.type || 'text')
      || fsDangerousAncestor(input, wrapper)) return null;
    const marked = fsUniqueCy(wrapper, parsed.path + 'Input');
    if (!marked || marked !== input && !marked.contains(input)) return null;
    if (parsed.property !== 'school' && (marked.getAttribute('role') === 'combobox' || fsAll(marked, '[role="combobox"]').length)) return null;
    if (parsed.property === 'school' && fsAll(wrapper, '[data-cy="notSingleMode"]').length) return null;
    const value = String(input.value || '');
    if (value.length > 20000) return null;
    return [{ ...common, fieldId: parsed.path, type: input.tagName === 'TEXTAREA' ? 'textarea' : input.type === 'url' ? 'url' : 'text',
      value, editable: !input.readOnly && !fsDisabled(input), bounds: fsBounds(input),
      identity: JSON.stringify([parsed.path, input.tagName, input.id || '', input.name || '', input.type || 'text',
        Boolean(input.readOnly), input.maxLength ?? -1, marked.tagName, marked.getAttribute('data-cy')]) }];
  };
  const fsReadGroups = (section, kind) => {
    const nodes = fsGroupNodes(section, kind); const keys = new Set(); const groups = [];
    if (nodes.length > 30) return { error: 'too-many-groups', groups: [] };
    for (const node of nodes) {
      const wrappers = fsFieldWrappers(node).filter(wrapper => fsGroupRoot(wrapper) === node);
      const parsed = wrappers.map(wrapper => fsPath(wrapper.getAttribute('data-cy')));
      const key = parsed[0]?.key;
      if (!parsed.length || parsed.some(field => !field || field.kind !== kind || field.key !== key)
        || keys.has(key) || new Set(parsed.map(field => field.path)).size !== parsed.length) return { error: 'ambiguous-group-fields', groups: [] };
      keys.add(key);
      const fields = [];
      for (let i = 0; i < wrappers.length; i++) {
        const found = fsField(wrappers[i], parsed[i]);
        if (!found) return { error: 'unsupported-field-dom:' + kind + '.' + parsed[i].property, groups: [] };
        fields.push(...found);
      }
      if (!fields.length) return { error: 'empty-group-structure', groups: [] };
      const id = kind + '[' + key + ']';
      groups.push({ id, kind, key, fields, identity: JSON.stringify([id, fields.map(field => [field.fieldId, field.type, field.identity])]) });
    }
    return { error: '', groups };
  };
  const fsAdd = (section, kind, groups) => {
    const nodes = fsGroupNodes(section, kind);
    const selector = nodes.length ? '.formOperate-addBtn' : '.createFormSection-addBtn';
    const candidates = fsAll(section, selector).filter(node => fsVisible(node));
    if (candidates.length !== 1) return null;
    const node = candidates[0];
    if (node.tagName !== 'DIV' || fsDisabled(node) || fsDangerousAncestor(node, section) || fsDangerousDescendant(node)) return null;
    if (nodes.length && fsGroupRoot(node) !== nodes[nodes.length - 1] || !nodes.length && fsGroupRoot(node)) return null;
    const labels = fsAll(node, '.addMore-add');
    if (labels.length !== 1 || !/^(?:添加|添加更多|新增|新增一项|添加一项|Add|Add more)$/i.test(fsText(labels[0].textContent))) return null;
    const label = fsText(labels[0].textContent);
    return { kind, id: kind + ':add', label, enabled: true, bounds: fsBounds(node),
      identity: JSON.stringify([kind, fsIdentityClass(section), groups.map(group => group.id), selector,
        node.tagName, fsIdentityClass(node), label]), element: node };
  };
  // This exact reviewed legacy node is a structural renderer counter. Its
  // value (including its empty/nonempty state) is not applicant information.
  const fsCounterSentinel = (element, type) => {
    const counter = 'formControlChangeFlag';
    const id = element.id || '', name = element.name || '';
    if (element.tagName !== 'INPUT' || type !== 'text' || !(id === counter || name === counter)
      || id && id !== counter || name && name !== counter) return false;
    const sameName = fsAll(document, '[id],[name]').filter(node => node.getAttribute('id') === counter || node.getAttribute('name') === counter);
    if (sameName.length !== 1 || sameName[0] !== element) return false;
    const hiddenRoots = fsAll(document, '.resumeEditForm-hiddenField');
    if (hiddenRoots.length !== 1 || hiddenRoots[0].tagName !== 'DIV' || !hiddenRoots[0].contains(element) || fsActivating(hiddenRoots[0])
      || fsDangerousAncestor(element, hiddenRoots[0])) return false;
    let computedHidden = false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) { computedHidden = true; break; }
    }
    if (!computedHidden) return false;
    const forms = fsAll(document, 'form'), form = element.closest('form');
    const sections = fsKinds.flatMap(kind => fsSections(kind));
    return forms.length === 1 && forms[0] === form && hiddenRoots[0].closest('form') === form
      && sections.length > 0 && sections.every(section => section.closest('form') === form);
  };
  const fsProtected = groups => {
    const careerPaths = new Set(groups.flatMap(group => group.fields.map(field => field.path)));
    const controls = fsAll(document, 'input,textarea,select,[role="combobox"]').filter(element =>
      !element.parentElement?.closest('[role="combobox"]'));
    if (controls.length > 500) return { error: 'too-many-form-controls', controls: [] };
    const observed = [];
    for (let index = 0; index < controls.length; index++) {
      const element = controls[index]; let career = false;
      for (let parent = element; parent; parent = parent.parentElement) {
        if (careerPaths.has(parent.getAttribute('data-cy'))) { career = true; break; }
      }
      if (career) continue;
      const type = element.tagName === 'TEXTAREA' ? 'textarea' : element.tagName === 'SELECT' ? 'select' : element.type || 'text';
      const context = [element.name || '', element.id || '', element.getAttribute('aria-label') || '', element.getAttribute('autocomplete') || '', element.getAttribute('placeholder') || '',
        ...fsAll(document, 'label').filter(label => element.id && label.getAttribute('for') === element.id).map(label => label.textContent || '')].join(' ');
      // Every hidden input is opaque. Even a harmless-looking name may carry a
      // CSRF/session/authentication token. Sensitive controls contribute only a
      // local boolean presence result; never materialize/copy their text value,
      // aria-valuetext, selected labels or file names into an observation.
      const counterSentinel = fsCounterSentinel(element, type);
      const sensitive = counterSentinel || type === 'hidden' || type === 'password' || !fsVisible(element)
        || /密码|口令|验证码|校验码|动态码|认证码|安全码|身份证|证件号码|护照|银行卡|银行账号|密钥|令牌|凭证|password|passcode|captcha|verification|one.?time.?code|otp|sms.?code|verify.?code|security.?code|passport|identification|national.?id|social.?security|id.?(?:card|number)|bank|credit.?card|debit.?card|card.?number|\b(?:cvv|cvc)\b|\bcc-(?:number|csc|exp|name)|token|auth|credential|secret|api.?key|csrf|xsrf|session|bearer|\bjwt\b|access.?key|private.?key/i.test(context);
      const sensitivePresence = !counterSentinel && sensitive && (Boolean(element.value) || Boolean(element.files?.length)
        || element.getAttribute('role') === 'combobox' && (Boolean(element.getAttribute('aria-valuetext'))
          || fsCy(element, 'selectedValue').some(node => Boolean(node.textContent))));
      const value = counterSentinel ? '[结构计数器]' : sensitive ? (sensitivePresence ? '[已有值]' : '')
        : type === 'file' ? (Boolean(element.files?.length) ? '[已有附件]' : '') : String(element.value || '');
      if (value.length > 20000) return { error: 'protected-value-too-long', controls: [] };
      observed.push({ index: observed.length, tag: element.tagName, type, id: element.id || '', name: element.name || '',
        value,
        sensitive, checked: Boolean(element.checked), disabled: Boolean(element.disabled), readOnly: Boolean(element.readOnly),
        ...(!sensitive && element.getAttribute('role') === 'combobox' ? { selectedLabels: fsCy(element, 'selectedValue').map(node => fsText(node.textContent, 2000)), ariaValueText: element.getAttribute('aria-valuetext') || '' } : {}),
        ...(!sensitive && type === 'file' ? { files: Array.from(element.files || []).map(file => ({ size: Number(file.size || 0), type: String(file.type || ''), lastModified: Number(file.lastModified || 0) })) } : {}),
        identity: JSON.stringify([element.tagName, type, element.id || '', element.name || '', element.getAttribute('role') || '',
          element.getAttribute('aria-controls') || '', element.getAttribute('aria-owns') || '', element.maxLength ?? -1]) });
    }
    return { error: '', controls: observed };
  };
  const fsObserve = () => {
    const base = { url: location.href, origin: location.origin, supported: false, reason: '', groups: [], addControls: [], protectedControls: [] };
    if (!fsScope()) return { ...base, reason: 'unsupported-origin' };
    const allGroups = [], addControls = []; let sections = 0;
    for (const kind of fsKinds) {
      const found = fsSections(kind);
      if (found.length > 1) return { ...base, reason: 'ambiguous-section' };
      if (!found.length) continue;
      sections++;
      const section = found[0];
      if (!fsVisible(section) || fsDangerousAncestor(section, null)) return { ...base, reason: 'unsupported-section' };
      const read = fsReadGroups(section, kind);
      if (read.error) return { ...base, reason: read.error };
      allGroups.push(...read.groups);
      const add = fsAdd(section, kind, read.groups);
      if (add) { const { element, ...observed } = add; addControls.push(observed); }
    }
    if (!sections) return { ...base, reason: 'legacy-form-not-observed' };
    const protectedRead = fsProtected(allGroups);
    if (protectedRead.error) return { ...base, reason: protectedRead.error };
    return { ...base, supported: true, reason: '', groups: allGroups, addControls, protectedControls: protectedRead.controls };
  };
  const fsLocate = fieldId => {
    if (!fsScope()) return null;
    const sideMatch = /^(.*):(start|end)$/.exec(fieldId), path = sideMatch ? sideMatch[1] : fieldId;
    const parsed = fsPath(path); if (!parsed) return null;
    const section = fsSection(parsed.kind); if (!section) return null;
    const wrapper = fsUniqueCy(section, path); if (!wrapper) return null;
    const group = fsGroupRoot(wrapper);
    if (!group || !fsGroupNodes(section, parsed.kind).includes(group)) return null;
    const fields = fsField(wrapper, parsed); if (!fields) return null;
    const field = fields.find(field => field.fieldId === fieldId); if (!field) return null;
    let element = null;
    if (field.type === 'feishu-month') element = fsDate(wrapper, path, sideMatch[2])?.target;
    else if (field.type === 'feishu-single-select') element = fsSelect(wrapper, path)?.owner;
    else element = fsAll(wrapper, 'input,textarea').find(node => (node.type || 'text') !== 'hidden');
    return element ? { parsed, section, wrapper, group, field, element } : null;
  };
  const fsFocused = node => Boolean(node && document.activeElement && (node === document.activeElement || node.contains(document.activeElement)));
  const fsHit = (node, x, y) => { const hit = document.elementFromPoint(x, y); return Boolean(node && hit && (node === hit || node.contains(hit))); };
  const fsCareerHit = (located, x, y) => {
    if (!located || !fsHit(located.element, x, y)) return false;
    const hit = document.elementFromPoint(x, y);
    // The optional date clear icon has its own handler. It is never a date
    // trigger, even though its pixels are inside the observed endpoint.
    if (located.field.type === 'feishu-month' && hit?.closest('[data-cy="clear"]')) return false;
    return true;
  };
  const fsMonthHitMeta = hit => {
    const tags = ['DIV', 'SPAN', 'UL', 'LI', 'INPUT', 'BUTTON', 'BODY', 'HTML', 'SVG', 'PATH', 'SECTION', 'MAIN', 'P', 'LABEL'];
    const knownClasses = new Set(['atsx-date-picker-period-month-panel', 'atsx-date-picker-period-month-panel-list',
      'atsx-date-picker-period-month-panel-list-item', 'atsx-date-picker-period-month-panel-list-item-selected',
      'atsx-date-picker-period-month-panel-list-item-focused', 'atsx-date-picker-period-month-label',
      'atsx-date-picker-period-month-label-year', 'atsx-date-picker-period-month-label-month',
      'atsx-date-picker-dropdown', 'ps', 'ps--active-x', 'ps--active-y', 'ps__rail-y', 'ps__rail-x', 'ps__thumb-y', 'ps__thumb-x',
      'addMore-add', 'addMore-plus', 'addMore__d36c7e', 'createFormSection-addBtn', 'createFormSection__740cd1',
      'createFormSection-container', 'createFormSection-container-empty', 'formOperate-addBtn', 'formOperate-addBtn-container',
      'formOperate-removeBtn', 'formOperate-removeBtn-container', 'formOperate-remove', 'formOperate-hidden']);
    const classes = hit ? fsClasses(hit).filter(value => knownClasses.has(value)).slice(0, 12) : [];
    const cy = hit?.getAttribute('data-cy') || '';
    return { tag: hit && tags.includes(hit.tagName) ? hit.tagName.toLowerCase() : 'other', classes,
      ...(classes.some(value => value.startsWith('atsx-date-picker-period-month-panel-list-item')) && /^(?:0[1-9]|1[0-2]|\d{4})$/.test(cy) ? { numericDataCy: cy } : {}) };
  };
  const fsSelectPopup = path => {
    const located = fsLocate(path), select = located && located.parsed.property === 'degree' ? fsSelect(located.wrapper, path) : null;
    if (!select || select.owner.getAttribute('aria-expanded') !== 'true') return null;
    const byId = fsAll(document, '[id]').filter(node => node.id === select.popupId);
    if (byId.length !== 1 || !fsVisible(byId[0]) || fsDangerousAncestor(byId[0], null) || fsActivating(byId[0])) return null;
    const container = byId[0];
    const menus = container.getAttribute('role') === 'listbox' ? [container] : fsAll(container, '[role="listbox"]');
    if (menus.length !== 1 || fsAll(container, 'input,textarea,select,button,a[href],[contenteditable]').length) return null;
    const menu = menus[0];
    if (!fsVisible(menu) || fsDisabled(menu) || menu.getAttribute('aria-multiselectable') === 'true'
      || fsAll(menu, '[role="listbox"]').length || fsDangerousAncestor(menu, container)) return null;
    const owners = fsAll(document, '[role="combobox"]').filter(node => node.getAttribute('aria-expanded') === 'true'
      && node.getAttribute('aria-controls') === select.popupId);
    if (owners.length !== 1 || owners[0] !== select.owner) return null;
    const raw = fsAll(menu, '[role="option"]'); if (raw.length > 500) return null;
    const identity = JSON.stringify([select.identity, container.id || '', fsIdentityClass(container), menu.id || '', fsIdentityClass(menu)]);
    const entries = raw.flatMap((option, index) => {
      if (option.closest('[role="listbox"]') !== menu || !fsVisible(option) || fsDisabled(option) || fsActivating(option)
        || fsDangerousAncestor(option, menu) || fsDangerousDescendant(option)) return [];
      const label = fsText(option.textContent); if (!label) return [];
      return [{ element: option, index, id: option.id || '', label, selected: option.getAttribute('aria-selected') === 'true',
        bounds: fsBounds(option), identity: JSON.stringify([identity, index, option.id || '', label]) }];
    });
    return { located, select, container, menu, identity, entries };
  };
  const fsMonthPopup = (path, side) => {
    const located = fsLocate(path + ':' + side); if (!located) return null;
    const date = fsDate(located.wrapper, path, side); if (!date) return null;
    const panel = fsUniqueCy(document, date.popupCy);
    if (!panel || !fsVisible(panel) || fsDisabled(panel) || fsDangerousAncestor(panel, null) || fsActivating(panel)
      || fsAll(panel, 'input,textarea,select,button,a[href],[contenteditable]').length) return null;
    const columns = fsAll(panel, 'div').filter(node => fsClasses(node).some(value => /-date-picker-period-month-panel-list$/.test(value)));
    if (columns.length !== 2 || columns.some(column => !fsVisible(column) || fsDisabled(column))) return null;
    const identity = JSON.stringify([date.identity, date.popupCy, fsIdentityClass(panel), columns.map(column => fsIdentityClass(column))]);
    const observed = columns.map((column, index) => {
      const columnKind = index ? 'month' : 'year';
      const items = fsAll(column, '[data-cy]');
      if (!items.length || items.length > 500) return null;
      // The audited legacy PeriodMonthPicker inserts data-cy="-" into the
      // end-year column; its rendered locale label is 至今. Never search outside
      // this exact popup/column or treat an arbitrary matching page label as an option.
      const present = items.filter(item => item.getAttribute('data-cy') === '-');
      if (present.length > 1 || present.length && (side !== 'end' || index !== 0)) return null;
      if (present.some(item => item.tagName !== 'DIV' || !fsHasClass(item, 'atsx-date-picker-period-month-panel-list-item')
        || fsText(item.textContent) !== '至今' || !fsVisible(item) || fsActivating(item)
        || fsDangerousAncestor(item, column) || fsDangerousDescendant(item) || fsDisabled(item))) return null;
      const numeric = items.filter(item => /^(?:\d{4}|0[1-9]|1[0-2])$/.test(item.getAttribute('data-cy') || ''));
      if (new Set(numeric.map(item => item.getAttribute('data-cy'))).size !== numeric.length) return null;
      const entries = items.flatMap(item => {
        const rawValue = item.getAttribute('data-cy') || '';
        const isPresent = side === 'end' && index === 0 && rawValue === '-';
        if (!isPresent && !(index ? /^(?:0[1-9]|1[0-2])$/ : /^\d{4}$/).test(rawValue)) return [];
        if (fsActivating(item) || fsDangerousAncestor(item, column) || fsDangerousDescendant(item) || fsDisabled(item)) return [];
        const value = isPresent ? '至今' : rawValue;
        const label = fsText(item.textContent); if (label !== value) return [];
        return [{ element: item, value, selected: fsClasses(item).some(value => /-item-selected$/.test(value)),
          bounds: fsBounds(item), visible: fsVisible(item), identity: JSON.stringify([identity, columnKind, value, fsIdentityClass(item)]) }];
      });
      if (new Set(entries.map(entry => entry.value)).size !== entries.length || !entries.length) return null;
      if (entries.filter(entry => entry.selected).length > 1) return null;
      if (index && (entries.length !== 12 || entries.some((entry, itemIndex) => entry.value !== String(itemIndex + 1).padStart(2, '0')))) return null;
      return { kind: columnKind, element: column, identity: JSON.stringify([identity, columnKind]), bounds: fsBounds(column),
        scrollTop: Number(column.scrollTop || 0), scrollHeight: Number(column.scrollHeight || 0), clientHeight: Number(column.clientHeight || 0),
        scrollState: { scrollingX: fsHasClass(column, 'ps--scrolling-x'), scrollingY: fsHasClass(column, 'ps--scrolling-y') }, entries };
    });
    return observed.some(column => !column) ? null : { located, date, panel, identity, columns: observed };
  };
`;

export const READ_FEISHU_CAREER = `(() => { /* offeragent-read-feishu-career */ ${FEISHU_READ_HELPERS} return fsObserve(); })()`;

function fieldArgument(path: string, allowSide = true): void {
  const expression = allowSide
    ? /^(education|internship|project)\[(0|[1-9]\d{0,5})\]\.(school|degree|fieldOfStudy|company|title|desc|name|role|link|period)(?::(?:start|end))?$/
    : /^(education|internship|project)\[(0|[1-9]\d{0,5})\]\.(school|degree|fieldOfStudy|company|title|desc|name|role|link|period)$/;
  if (!expression.test(path)) throw new Error('飞书履历字段定位无效。');
}
function point(x: number, y: number): void { if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('飞书履历坐标无效。'); }
function dateArgument(path: string, side: FeishuDateSide): void {
  fieldArgument(path, false);
  if (!path.endsWith('.period') || !['start', 'end'].includes(side)) throw new Error('飞书年月定位无效。');
}

export function readFeishuCareerTarget(fieldId: string, x: number, y: number): string {
  fieldArgument(fieldId); point(x, y);
  return `(() => { /* offeragent-read-feishu-career-target */ ${FEISHU_READ_HELPERS}
    const located = fsLocate(${JSON.stringify(fieldId)});
    return { url: location.href, exists: Boolean(located), field: located?.field || null,
      focused: fsFocused(located?.field.type === 'feishu-month' ? fsDate(located.wrapper, located.parsed.path, located.field.side)?.root : located?.element),
      uncovered: fsCareerHit(located, ${x}, ${y}),
      valid: Boolean(located && (!located.element.validity || located.element.validity.valid) && located.element.getAttribute('aria-invalid') !== 'true'
        && (located.field.type === 'feishu-month' || !fsHasClass(located.wrapper, 'form-item-has-error'))) };
  })()`;
}

/** Precise host-owned locator. This requests scrolling, never opens or edits the target control. */
export function revealFeishuCareerField(fieldId: string, expectedSnapshot: string): string {
  fieldArgument(fieldId);
  if (typeof expectedSnapshot !== 'string' || !expectedSnapshot || expectedSnapshot.length > 4_000_000) throw new Error('履历定位快照无效。');
  return `(() => { /* offeragent-reveal-feishu-career-field */
    ${FEISHU_READ_HELPERS}
    const observed=fsObserve();
    if (!observed.supported) return {url:location.href,exists:false,scrolled:false,reason:'unsupported'};
    if ((${locationObservationSnapshot.toString()})(observed) !== ${JSON.stringify(expectedSnapshot)}) return {url:location.href,exists:false,scrolled:false,reason:'changed'};
    const located=fsLocate(${JSON.stringify(fieldId)});
    if (!located?.element) return {url:location.href,exists:false,scrolled:false,reason:'missing'};
    try { Element.prototype.scrollIntoView.call(located.element,{behavior:'instant',block:'center',inline:'nearest'}); }
    catch { return {url:location.href,exists:true,scrolled:false,reason:'blocked'}; }
    return {url:location.href,exists:true,scrolled:true,reason:'requested'};
  })()`;
}

export function readFeishuAddTarget(kind: FeishuCareerKind, x: number, y: number): string {
  if (!['education', 'internship', 'project'].includes(kind)) throw new Error('飞书履历类别无效。'); point(x, y);
  return `(() => { /* offeragent-read-feishu-add-target */ ${FEISHU_READ_HELPERS}
    const observed = fsObserve(), section = fsSection(${JSON.stringify(kind)});
    const add = observed.supported && section ? fsAdd(section, ${JSON.stringify(kind)}, observed.groups.filter(group => group.kind === ${JSON.stringify(kind)})) : null;
    const control = add ? (({ element, ...data }) => data)(add) : null;
    const hit = document.elementFromPoint(${x}, ${y});
    return { url: location.href, supported: observed.supported, exists: Boolean(add), control,
      groupIds: observed.groups.map(group => group.id), uncovered: Boolean(add && hit && (hit === add.element || add.element.contains(hit))), hitMeta: fsMonthHitMeta(hit) };
  })()`;
}

export function readFeishuSelectPopup(path: string): string {
  fieldArgument(path, false);
  if (!path.endsWith('.degree')) throw new Error('飞书单选定位无效。');
  return `(() => { /* offeragent-read-feishu-select-popup */ ${FEISHU_READ_HELPERS}
    const read = fsSelectPopup(${JSON.stringify(path)});
    return { url: location.href, owner: read ? { identity: read.select.identity, value: read.select.value, focused: fsFocused(read.select.owner) } : null,
      popup: read ? { identity: read.identity, options: read.entries.map(({ element, ...data }) => data) } : null };
  })()`;
}

export function readFeishuSelectOptionTarget(path: string, optionIndex: number, x: number, y: number): string {
  fieldArgument(path, false); point(x, y);
  if (!path.endsWith('.degree') || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= 500) throw new Error('飞书单选选项定位无效。');
  return `(() => { /* offeragent-read-feishu-select-option-target */ ${FEISHU_READ_HELPERS}
    const read = fsSelectPopup(${JSON.stringify(path)}), entry = read?.entries.find(entry => entry.index === ${optionIndex});
    return { url: location.href, exists: Boolean(entry), uncovered: fsHit(entry?.element, ${x}, ${y}),
      focused: Boolean(read && (fsFocused(read.select.owner) || fsFocused(read.menu))), value: read?.select.value || '',
      ownerIdentity: read?.select.identity || '', popupIdentity: read?.identity || '',
      option: entry ? (({ element, ...data }) => data)(entry) : null };
  })()`;
}

export function readFeishuMonthPopup(path: string, side: FeishuDateSide): string {
  dateArgument(path, side);
  return `(() => { /* offeragent-read-feishu-month-popup */ ${FEISHU_READ_HELPERS}
    const read = fsMonthPopup(${JSON.stringify(path)}, ${JSON.stringify(side)});
    return { url: location.href, popup: read ? { identity: read.identity, field: read.located.field,
      focused: fsFocused(read.date.root) || fsFocused(read.panel),
      columns: read.columns.map(({ element, entries, ...data }) => ({ ...data, options: entries.map(({ element, ...entry }) => entry) })) } : null };
  })()`;
}

export function readFeishuMonthOptionTarget(path: string, side: FeishuDateSide, column: 'year' | 'month', value: string, x: number, y: number): string {
  dateArgument(path, side); point(x, y);
  const present = value === '至今' && side === 'end' && column === 'year';
  if (!['year', 'month'].includes(column) || !present && !(column === 'year' ? /^\d{4}$/ : /^(?:0[1-9]|1[0-2])$/).test(value)) throw new Error('飞书年月选项定位无效。');
  return `(() => { /* offeragent-read-feishu-month-option-target */ ${FEISHU_READ_HELPERS}
    const read = fsMonthPopup(${JSON.stringify(path)}, ${JSON.stringify(side)}), column = read?.columns.find(column => column.kind === ${JSON.stringify(column)});
    const entry = column?.entries.find(entry => entry.value === ${JSON.stringify(value)});
    const hit = document.elementFromPoint(${x}, ${y});
    return { url: location.href, exists: Boolean(entry), uncovered: Boolean(entry && hit && (hit === entry.element || entry.element.contains(hit))), hitMeta: fsMonthHitMeta(hit),
      focused: Boolean(read && (fsFocused(read.date.root) || fsFocused(read.panel))),
      popupIdentity: read?.identity || '', columnIdentity: column?.identity || '', field: read?.located.field || null,
      option: entry ? (({ element, ...data }) => data)(entry) : null${present ? ', observation: fsObserve()' : ''} };
  })()`;
}

/** Binding for a native wheel within this date picker's own list, never the page behind it. */
export function readFeishuMonthColumnTarget(path: string, side: FeishuDateSide, column: 'year' | 'month', x: number, y: number): string {
  dateArgument(path, side); point(x, y);
  if (!['year', 'month'].includes(column)) throw new Error('飞书年月列定位无效。');
  return `(() => { /* offeragent-read-feishu-month-column-target */ ${FEISHU_READ_HELPERS}
    const read = fsMonthPopup(${JSON.stringify(path)}, ${JSON.stringify(side)}), column = read?.columns.find(column => column.kind === ${JSON.stringify(column)});
    return { url: location.href, exists: Boolean(column), uncovered: fsHit(column?.element, ${x}, ${y}),
      focused: Boolean(read && (fsFocused(read.date.root) || fsFocused(read.panel))),
      popupIdentity: read?.identity || '', columnIdentity: column?.identity || '', field: read?.located.field || null,
      column: column ? (({ element, entries, ...data }) => data)(column) : null };
  })()`;
}

/** Read-only hit binding for a bounded page wheel away from editable/action controls. */
export function readFeishuPageWheelTarget(x: number, y: number): string {
  point(x, y);
  return `(() => { /* offeragent-read-feishu-page-wheel-target */ ${FEISHU_READ_HELPERS}
    const hit = fsScope() ? document.elementFromPoint(${x}, ${y}) : null;
    const allowed = Boolean(hit && fsVisible(hit) && !hit.closest('input,textarea,select,button,a[href],[role="combobox"],[role="button"],[contenteditable]'));
    return { url: location.href, allowed, identity: allowed ? JSON.stringify([hit.tagName, hit.id || '', hit.getAttribute('data-cy') || '', fsIdentityClass(hit)]) : '' };
  })()`;
}

/** Test-only origin substitution. No renderer argument can enable this branch. */
export function createFeishuFixtureScripts(exactLoopbackOrigin: string) {
  if (!process.argv.includes('--smoke-test')) throw new Error('飞书样站观察器仅供显式桌面 smoke 使用。');
  let url: URL;
  try { url = new URL(exactLoopbackOrigin); } catch { throw new Error('飞书样站地址无效。'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || url.origin !== exactLoopbackOrigin) throw new Error('飞书样站必须是精确的本机回环 origin。');
  const rebind = (script: string): string => {
    if (!script.includes(FEISHU_PRODUCTION_SCOPE)) throw new Error('飞书样站观察器作用域未核实。');
    return script.replace(FEISHU_PRODUCTION_SCOPE, `const fsScope = () => location.origin === ${JSON.stringify(url.origin)};`);
  };
  return {
    READ_FEISHU_CAREER: rebind(READ_FEISHU_CAREER),
    readFeishuCareerTarget: (fieldId: string, x: number, y: number) => rebind(readFeishuCareerTarget(fieldId, x, y)),
    revealFeishuCareerField: (fieldId: string, expectedSnapshot: string) => rebind(revealFeishuCareerField(fieldId, expectedSnapshot)),
    readFeishuAddTarget: (kind: FeishuCareerKind, x: number, y: number) => rebind(readFeishuAddTarget(kind, x, y)),
    readFeishuSelectPopup: (path: string) => rebind(readFeishuSelectPopup(path)),
    readFeishuSelectOptionTarget: (path: string, optionIndex: number, x: number, y: number) => rebind(readFeishuSelectOptionTarget(path, optionIndex, x, y)),
    readFeishuMonthPopup: (path: string, side: FeishuDateSide) => rebind(readFeishuMonthPopup(path, side)),
    readFeishuMonthOptionTarget: (path: string, side: FeishuDateSide, column: 'year' | 'month', value: string, x: number, y: number) => rebind(readFeishuMonthOptionTarget(path, side, column, value, x, y)),
    readFeishuMonthColumnTarget: (path: string, side: FeishuDateSide, column: 'year' | 'month', x: number, y: number) => rebind(readFeishuMonthColumnTarget(path, side, column, x, y)),
    readFeishuPageWheelTarget: (x: number, y: number) => rebind(readFeishuPageWheelTarget(x, y)),
  };
}
