/** This fixed reader filters inside the recruiting page before crossing IPC. */
export const SITE_DIAGNOSTIC_READER = `(expectedOrigin => {
    'use strict';
    if (location.origin !== expectedOrigin) throw new Error('SITE_DIAGNOSTIC_ORIGIN_CHANGED');
    const knownFields = {
      education: ['school','degree','fieldOfStudy','field_of_study','major','period','start_end_time','educationType','education_type','academicRanking','academic_ranking'],
      internship: ['company','title','desc','description','period','start_end_time','department'],
      project: ['name','role','link','desc','description','period','start_end_time']
    };
    const nodeIds = new Map();
    const nodeId = node => {
      if (!node) return null;
      if (!nodeIds.has(node)) nodeIds.set(node, 'node-' + (nodeIds.size + 1));
      return nodeIds.get(node);
    };
    const roles = new Set(['combobox','listbox','option','button','group','textbox','dialog','grid','gridcell','row','columnheader','spinbutton']);
    const classify = value => {
      if (typeof value !== 'string' || value.length > 160) return null;
      const match = /^(education|internship|project)(?:\\[(\\d{1,4})\\]|\\.(\\d{1,4}))\\.([A-Za-z_]+?)(InputBeginDropdown|InputEndDropdown|InputBegin|InputEnd|Input|Dropdown)?$/.exec(value);
      if (!match || !knownFields[match[1]].includes(match[4])) return null;
      return { group: match[1], recordKey: Number(match[2] || match[3]), field: match[4], suffix: match[5] || '', path: match[1] + '[].' + match[4] };
    };
    const classWords = new Set(('ats atsx auxo lark feishu byted ant byte arco form application resume section field select input period month year recruitment talent career add remove delete item rc selection search selected value single multiple dropdown menu option disabled focus focused open arrow clear control wrapper large small default active container content title label required error valid invalid row column col flex icon tooltip loading inner outer main calendar normal placeholder rtl sm lg md align highlight highlighted empty not multi show hidden visible status enable enabled prefix suffix picker date range begin end list box checkbox radio button text check').split(' '));
    const exactStaticClasses = new Set(['resumeEditForm-item','resumeEditForm-item-kind','resumeEditForm-item-focus',
      'resumeEditForm-education','resumeEditForm-internship','resumeEditForm-project',
      'createFormSection-container','createFormSection-container-empty','createFormSection-hidden',
      'formOperate-addBtn','formOperate-removeBtn','formOperate-hidden','addMore-add']);
    const staticClasses = element => String(element.getAttribute('class') || '').split(/\\s+/).filter(value =>
      exactStaticClasses.has(value) || value.length <= 100 && /^[a-z][a-z0-9_-]*$/.test(value) && value.split(/[-_]+/).every(part => classWords.has(part))
    ).slice(0, 18);
    const structure = element => {
      if (!element) return null;
      const role = element.getAttribute('role');
      const relations = {};
      for (const attribute of ['aria-controls','aria-owns','aria-labelledby','aria-describedby']) {
        const ids = String(element.getAttribute(attribute) || '').trim().split(/\\s+/).filter(Boolean).slice(0, 8);
        if (ids.length) relations[attribute] = ids.map(id => ({ exists: Boolean(document.getElementById(id)), node: nodeId(document.getElementById(id)) }));
      }
      const rect = element.getBoundingClientRect();
      const tag = String(element.tagName || '').toLowerCase();
      const marker = element.getAttribute('data-cy');
      return { node: nodeId(element), tag: /^(?:div|span|input|textarea|select|option|optgroup|button|a|section|fieldset|legend|label|form|ul|ol|li|p|h[1-6]|main|header|footer|svg|path|i|strong|em|table|tr|td|th|tbody)$/.test(tag) ? tag : 'other', role: roles.has(role) ? role : null,
        classes: staticClasses(element), relations, hasDomId: element.hasAttribute('id'),
        structuralDataCy: ['selectedValue','year','month','toToday'].includes(marker) ? marker : null,
        expanded: element.getAttribute('aria-expanded') === 'true', readonly: element.hasAttribute('readonly'),
        disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
        visible: rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none' };
    };
    const all = Array.from(document.querySelectorAll('[data-cy],[name]')).slice(0, 6000);
    const fields = [];
    for (const element of all) {
      const cy = classify(element.getAttribute('data-cy'));
      const name = classify(element.getAttribute('name'));
      const field = cy || name;
      if (!field) continue;
      const parents = [];
      for (let parent = element.parentElement, depth = 0; parent && depth < 5; parent = parent.parentElement, depth++) {
        if (['BODY','HTML'].includes(parent.tagName)) break;
        parents.push(structure(parent));
      }
      const selected = Array.from(element.querySelectorAll('[data-cy="selectedValue"]')).slice(0, 4).map(node => ({ ...structure(node), empty: !String(node.textContent || '').trim() }));
      fields.push({ ...structure(element), binding: field, attribute: cy ? 'data-cy' : 'name', parentChain: parents,
        children: Array.from(element.children || []).slice(0, 12).map(structure), selectedValueNodes: selected });
      if (fields.length >= 450) break;
    }
    const exactGroups = new Set(['education','internship','project']);
    const classGroup = element => ['education','internship','project'].find(group => staticClasses(element).includes('resumeEditForm-' + group)) || null;
    const groupFor = element => exactGroups.has(element.getAttribute('data-cy')) ? element.getAttribute('data-cy') : classGroup(element);
    const sections = Array.from(document.querySelectorAll('[data-cy],.resumeEditForm-education,.resumeEditForm-internship,.resumeEditForm-project,.createFormSection-container'))
      .flatMap(element => {
        const localFields = fields.filter(field => { const node = [...nodeIds].find(entry => entry[1] === field.node)?.[0]; return node && element.contains(node); });
        const kinds = [...new Set(localFields.map(field => field.binding.group))];
        const group = groupFor(element) || (staticClasses(element).includes('createFormSection-container') && kinds.length === 1 ? kinds[0] : null);
        return group ? [{ ...structure(element), group, fieldNodes: localFields.map(field => field.node) }] : [];
      }).slice(0, 60);
    const addLabels = new Map([
      ['添加教育经历','education'],['新增教育经历','education'],['添加实习经历','internship'],['新增实习经历','internship'],
      ['添加项目经历','project'],['新增项目经历','project'],['添加教育','education'],['添加实习','internship'],['添加项目','project'],
      ['添加','unknown'],['新增','unknown'],['Add education','education'],['Add internship','internship'],['Add project','project']
    ]);
    const actions = Array.from(document.querySelectorAll('button,[role="button"],a,span,div')).slice(0, 10000);
    const addControls = [];
    for (const element of actions) {
      const content = String(element.textContent || '').trim();
      const structuralAdd = staticClasses(element).some(value => ['formOperate-addBtn','addMore-add'].includes(value));
      const group = addLabels.get(content) || (structuralAdd ? 'unknown' : null);
      if (!group || (!structuralAdd && content.length > 20)) continue;
      if (Array.from(element.children || []).some(child => String(child.textContent || '').trim() === content)) continue;
      const ancestors = [];
      for (let parent = element.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth++) {
        if (['BODY','HTML'].includes(parent.tagName)) break;
        const knownGroup = groupFor(parent);
        ancestors.push({ ...structure(parent), group: knownGroup });
      }
      addControls.push({ ...structure(element), action: 'add-record', group, parentChain: ancestors });
      if (addControls.length >= 45) break;
    }
    const periodPopups = all.filter(element => { const field = classify(element.getAttribute('data-cy')); return field && /Dropdown$/.test(field.suffix) && ['period','start_end_time'].includes(field.field); }).slice(0, 20).map(element => {
      const columns = Array.from(element.children || []).slice(0, 8).map(column => ({ ...structure(column), items: Array.from(column.querySelectorAll('[data-cy]')).flatMap(item => {
        const token = item.getAttribute('data-cy') || '';
        if (!/^(?:0?[1-9]|1[0-2]|19\\d{2}|20\\d{2}|2100)$/.test(token)) return [];
        return [{ ...structure(item), numericDataCy: Number(token) }];
      }).slice(0, 220) }));
      return { ...structure(element), binding: classify(element.getAttribute('data-cy')), columns };
    });
    return { schemaVersion: 1, kind: 'feishu-static-controls-only', privateValuesIncluded: false,
      fields, sections, addControls, periodPopups,
      limits: { inspectedAttributeNodes: Math.min(all.length, 6000), fieldLimit: 450, addControlLimit: 45 } };
  })`;

export function siteDiagnosticScript(expectedOrigin: string): string {
  const origin = new URL(expectedOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== expectedOrigin || origin.username || origin.password) {
    throw new Error('SITE_DIAGNOSTIC_ORIGIN_INVALID');
  }
  return `(${SITE_DIAGNOSTIC_READER})(${JSON.stringify(expectedOrigin)})`;
}
