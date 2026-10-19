import { createHash, randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { FeishuSiteLabContext } from './feishu-site-lab.js';
import { decideLabRequest, decideLabReloadTransition, type FeishuLabPhase, type FeishuLabRequestReason } from './feishu-lab-policy.js';
import { createCareerFormFixtureProfile, fixtureStrings } from './fixtures/career-form-profile.js';
import { READ_FEISHU_CAREER, readFeishuSelectPopup } from '../../packages/browser/src/feishu-scripts.js';
import { FeishuCareerDriver } from '../../packages/browser/src/feishu-native.js';
import { SmokeStepRunner } from './smoke-deadline.js';
import { runCareerPlan, type CareerRunnerJournalEvent, type CareerRunnerResult } from '../../packages/forms/src/career-runner.js';
import type { CareerFormObservation } from '../../packages/forms/src/career-plan.js';

const TARGET_ORIGIN = 'https://modelbest.jobs.feishu.cn';
const sourcePaths = [
  'packages/browser/src/controller.ts', 'packages/browser/src/feishu-native.ts', 'packages/browser/src/feishu-scripts.ts',
  'packages/forms/src/career-plan.ts', 'packages/forms/src/career-runner.ts', 'apps/desktop/fixtures/career-form-profile.ts',
] as const;
const fixturePaths = ['apps/desktop/fixtures/feishu-career.html', 'apps/desktop/smoke-feishu-career.ts'] as const;
const engineSourcePaths = ['apps/desktop/feishu-site-lab-engine.ts', 'apps/desktop/feishu-lab-policy.ts', 'apps/desktop/feishu-site-lab.ts',
  'scripts/build-feishu-lab-engine.mjs', 'scripts/build-desktop.mjs'] as const;
const keys = new Set(['school', 'degree', 'major', 'organization', 'role', 'name', 'startDate', 'endDate', 'description', 'url']);
const properties = new Set(['school', 'degree', 'fieldOfStudy', 'company', 'title', 'desc', 'name', 'role', 'link', 'period']);
const fieldTypes = new Set(['text', 'textarea', 'url', 'combobox', 'feishu-single-select', 'feishu-month']);

/** Fixed target, structure only. Neither field values nor arbitrary text are read. */
export const safeFeishuStructureProbeScript = String.raw`(() => {
  if(location.origin!=='https://modelbest.jobs.feishu.cn')throw new Error('LAB_ORIGIN_CHANGED');
  const kinds=['education','internship','project'];
  const properties={education:['school','degree','fieldOfStudy','period'],internship:['company','title','desc','period'],project:['name','role','link','desc','period']};
  const ids=new Map();const id=node=>{if(!node)return null;if(!ids.has(node))ids.set(node,'node-'+(ids.size+1));return ids.get(node)};
  const classes=node=>String(node.getAttribute('class')||'').split(/\s+/).filter(value=>
    /^(?:resumeEditForm-(?:item(?:-focus)?|education|internship|project)|createFormSection-(?:container(?:-empty)?|addBtn|hidden)|formOperate-(?:addBtn|removeBtn|hidden)|addMore-add|atsx-select(?:-selection(?:--single|-selected-value|__rendered|__placeholder)?|-search(?:__field)?|-arrow|-open|-focused|-disabled)?|period-month-picker)$/.test(value)
    ||/^(?:createFormSection|resumeEditForm|formOperate|addMore)__[a-fA-F0-9]{6,12}$/.test(value)).slice(0,24);
  const roles=new Set(['combobox','listbox','option','button','group','textbox','dialog']);
  const info=node=>{if(!node)return null;const role=node.getAttribute('role'),tag=String(node.tagName||'').toLowerCase(),rect=node.getBoundingClientRect();
    const relations={};for(const attr of ['aria-controls','aria-owns']){const targets=String(node.getAttribute(attr)||'').trim().split(/\s+/).filter(Boolean).slice(0,4);if(targets.length)relations[attr]=targets.map(target=>({exists:Boolean(document.getElementById(target)),node:id(document.getElementById(target))}));}
    return {node:id(node),tag:/^(?:div|span|input|textarea|select|button|a|section|fieldset|legend|label|form|ul|li|p|h[1-6]|svg|path|i)$/.test(tag)?tag:'other',role:roles.has(role)?role:null,classes:classes(node),relations,
      readonly:node.hasAttribute('readonly'),disabled:node.hasAttribute('disabled')||node.getAttribute('aria-disabled')==='true',visible:rect.width>0&&rect.height>0&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden'};};
  const ancestors=node=>{const result=[];for(let parent=node.parentElement,depth=0;parent&&depth<10;parent=parent.parentElement,depth++){if(['BODY','HTML'].includes(parent.tagName))break;result.push(info(parent));}return result;};
  const parse=raw=>{if(typeof raw!=='string'||raw.length>160)return null;const match=/^(education|internship|project)\[(?:0|[1-9]\d{0,5})\]\.([A-Za-z]+?)(InputBeginDropdown|InputEndDropdown|InputBegin|InputEnd|Input|Dropdown)?$/.exec(raw);
    return match&&properties[match[1]].includes(match[2])?{kind:match[1],path:match[1]+'[].'+match[2],property:match[2],suffix:match[3]||''}:null;};
  const fieldElements=Array.from(document.querySelectorAll('[data-cy],[name]')).slice(0,6000).flatMap(node=>{const binding=parse(node.getAttribute('data-cy'))||parse(node.getAttribute('name'));return binding?[{node,binding}]:[]}).slice(0,450);
  const fields=fieldElements.map(({node,binding})=>({...info(node),binding,parentChain:ancestors(node),children:Array.from(node.children||[]).slice(0,12).map(info),
    singleSelectOwners:Array.from(node.querySelectorAll('[role="combobox"]')).slice(0,4).map(owner=>{const shell=owner.parentElement;const count=shell?shell.querySelectorAll('input').length:0;return{...info(owner),shell:info(shell),inputShape:count===0?'zero':count===1?'one':'multiple',selectedValueNodeCount:owner.querySelectorAll('[data-cy="selectedValue"]').length};})}));
  const kindFor=node=>kinds.find(kind=>classes(node).includes('resumeEditForm-'+kind))||null;
  const sectionNodes=Array.from(document.querySelectorAll('.resumeEditForm-education,.resumeEditForm-internship,.resumeEditForm-project')).filter(node=>!classes(node).includes('resumeEditForm-item')).slice(0,30);
  const sections=sectionNodes.map(node=>{const container=node.closest('.createFormSection-container');return{...info(node),kind:kindFor(node),container:info(container),emptyContainer:Boolean(container&&classes(container).includes('createFormSection-container-empty')),
    fieldNodes:fieldElements.filter(field=>node.contains(field.node)).map(field=>id(field.node)),addNodes:container?Array.from(container.querySelectorAll('.createFormSection-addBtn,.formOperate-addBtn,.addMore-add')).slice(0,12).map(id):[],parentChain:ancestors(node)};});
  const adds=Array.from(document.querySelectorAll('.createFormSection-addBtn,.formOperate-addBtn,.addMore-add')).slice(0,45).map(node=>{const container=node.closest('.createFormSection-container');const related=sectionNodes.filter(section=>container&&container.contains(section));const known=[...new Set(related.map(kindFor).filter(Boolean))];return{...info(node),container:info(container),kind:known.length===1?known[0]:null,parentChain:ancestors(node)};});
  return{schemaVersion:1,privateValuesIncluded:false,fields,sections,adds};
})()`;

type NativeGate = { ok: boolean; reason: 'passed' | 'missing' | 'stale'; reportHashValidated: boolean; backendHashValidated: boolean; buildManifestValidated: boolean; engineManifestValidated: boolean; engineSourceManifestValidated: boolean; sourceCount: number; fixtureCount: number;
  evidence?: { backendSha256: string; engineSha256: string; sourceDigests: Record<string, string>; fixtureDigests: Record<string, string>; engineSourceDigests: Record<string, string>; nativeReportSha256: string }; };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const isObject = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
async function nativeFixtureGate(root: string): Promise<NativeGate> {
  const failed = (reason: 'missing' | 'stale'): NativeGate => ({ ok: false, reason, reportHashValidated: false, backendHashValidated: false, buildManifestValidated: false, engineManifestValidated: false, engineSourceManifestValidated: false, sourceCount: 6, fixtureCount: 2 });
  let marker: Record<string, any>;
  try { const bytes = await readFile(join(root, '.backups/feishu-native-fixture/native-ready.json')); if (bytes.length > 1_000_000) return failed('stale'); marker = JSON.parse(bytes.toString('utf8')); }
  catch { return failed('missing'); }
  try {
    if (!isObject(marker) || marker.ok !== true || marker.verifiedNativeFields !== 32 || marker.nativeAddedGroups !== 5) return failed('stale');
    for (const [paths, recorded] of [[sourcePaths, marker.sourceDigests], [fixturePaths, marker.fixtureDigests]] as const) {
      if (!isObject(recorded) || Object.keys(recorded).length !== paths.length) return failed('stale');
      for (const path of paths) if (typeof recorded[path] !== 'string' || !/^[a-f0-9]{64}$/.test(recorded[path])
        || hash(await readFile(join(root, path))) !== recorded[path]) return failed('stale');
    }
    const backendSha256 = hash(await readFile(join(root, 'dist/desktop/backend.js')));
    const build = JSON.parse(await readFile(join(root, 'dist/desktop/career-build-digests.json'), 'utf8'));
    const combined = { ...marker.sourceDigests, ...marker.fixtureDigests };
    if (!isObject(build) || !isObject(build.sourceDigests) || Object.keys(build.sourceDigests).length !== 8
      || marker.backendSha256 !== backendSha256 || build.backendSha256 !== backendSha256
      || Object.keys(combined).some(path => build.sourceDigests[path] !== combined[path])) return failed('stale');
    const engineSha256 = hash(await readFile(join(root, 'dist/desktop/feishu-site-lab-engine.js')));
    const engineBuild = JSON.parse(await readFile(join(root, 'dist/desktop/feishu-engine-build-digests.json'), 'utf8'));
    const loadedEngineVersion = new URL(import.meta.url).searchParams.get('version');
    if (!isObject(engineBuild) || !isObject(engineBuild.sourceDigests) || Object.keys(engineBuild.sourceDigests).length !== 8
      || engineBuild.engineSha256 !== engineSha256 || (loadedEngineVersion && loadedEngineVersion !== engineSha256)
      || Object.keys(combined).some(path => engineBuild.sourceDigests[path] !== combined[path])) return failed('stale');
    if (!isObject(engineBuild.engineSourceDigests) || Object.keys(engineBuild.engineSourceDigests).length !== engineSourcePaths.length) return failed('stale');
    for (const path of engineSourcePaths) if (typeof engineBuild.engineSourceDigests[path] !== 'string'
      || hash(await readFile(join(root, path))) !== engineBuild.engineSourceDigests[path]) return failed('stale');
    if (typeof marker.reportPath !== 'string' || resolve(marker.reportPath) !== marker.reportPath || basename(marker.reportPath) !== 'feishu-career-report.json'
      || ![join(root, '.backups') + sep, join(root, 'runtime-home/desktop-smoke') + sep].some(prefix => marker.reportPath.startsWith(prefix))) return failed('stale');
    const reportBytes = await readFile(marker.reportPath);
    if (reportBytes.length > 10_000_000 || typeof marker.reportSha256 !== 'string' || hash(reportBytes) !== marker.reportSha256) return failed('stale');
    const report = JSON.parse(reportBytes.toString('utf8'));
    if (!isObject(report) || report.ok !== true || report.fixtureOnly !== true || report.realEnterpriseVerified !== false || report.realModelCalled !== false
      || report.modelCalls !== 0 || report.ordinaryStoreRead !== false || report.verifiedNativeFields !== 32 || report.nativeAddedGroups !== 5
      || report.submitted !== false || report.uploads !== 0 || report.protectedFieldsUnchanged !== true || report.profileUnchanged !== true
      || report.immediateIndependentRead !== true || report.oneSecondIndependentRead !== true
      || JSON.stringify(report.sourceDigests) !== JSON.stringify(marker.sourceDigests) || JSON.stringify(report.fixtureDigests) !== JSON.stringify(marker.fixtureDigests)) return failed('stale');
    return { ok: true, reason: 'passed', reportHashValidated: true, backendHashValidated: true, buildManifestValidated: true, engineManifestValidated: true, engineSourceManifestValidated: true, sourceCount: 6, fixtureCount: 2,
      evidence: { backendSha256, engineSha256, sourceDigests: Object.fromEntries(sourcePaths.map(path => [path, marker.sourceDigests[path]])),
        fixtureDigests: Object.fromEntries(fixturePaths.map(path => [path, marker.fixtureDigests[path]])),
        engineSourceDigests: Object.fromEntries(engineSourcePaths.map(path => [path, engineBuild.engineSourceDigests[path]])), nativeReportSha256: marker.reportSha256 } };
  } catch { return failed('stale'); }
}

function safeAdapterReason(value: unknown): string {
  if (typeof value !== 'string') return 'adapter-read-unavailable';
  if (['', 'too-many-groups', 'ambiguous-group-fields', 'empty-group-structure', 'too-many-form-controls', 'protected-value-too-long',
    'unsupported-origin', 'ambiguous-section', 'unsupported-section', 'legacy-form-not-observed'].includes(value)) return value;
  return /^unsupported-field-dom:(?:education|internship|project)\.(?:school|degree|fieldOfStudy|company|title|desc|name|role|link|period)$/.test(value)
    ? value : 'adapter-read-unavailable';
}

/** Independent fixed-path reader. Returned values remain in host memory only. */
const independentReadScript = String.raw`(() => {
  if(location.origin!=='https://modelbest.jobs.feishu.cn')throw new Error('LAB_ORIGIN_CHANGED');
  const allowed={education:['school','degree','fieldOfStudy','period'],internship:['company','title','desc','period'],project:['name','role','link','desc','period']};
  const parse=value=>{const m=/^(education|internship|project)\[(?:0|[1-9]\d{0,5})\]\.([A-Za-z]+)$/.exec(value||'');return m&&allowed[m[1]].includes(m[2])?{kind:m[1],property:m[2],group:value.slice(0,value.lastIndexOf('.'))}:null;};
  const cy=(root,key)=>Array.from(root.querySelectorAll('[data-cy]')).filter(node=>node.getAttribute('data-cy')===key);
  const values={},groupIds=[],seen=new Set();let ambiguous=false;
  for(const wrapper of Array.from(document.querySelectorAll('[data-cy]')).slice(0,6000)){
    const path=wrapper.getAttribute('data-cy'),p=parse(path);if(!p)continue;
    if(seen.has(path)){ambiguous=true;continue;}seen.add(path);if(!groupIds.includes(p.group))groupIds.push(p.group);
    if(p.property==='period'){
      for(const [suffix,side] of [['Begin','start'],['End','end']]){
        const endpoints=cy(wrapper,path+'Input'+suffix);if(endpoints.length!==1){ambiguous=true;continue;}
        const years=cy(endpoints[0],'year'),months=cy(endpoints[0],'month');if(years.length!==1||months.length!==1){ambiguous=true;continue;}
        const year=String(years[0].textContent||'').trim(),month=String(months[0].textContent||'').trim();
        if(year==='YYYY'&&month==='MM')values[path+':'+side]='';
        else if(/^\d{4}$/.test(year)&&/^(?:0[1-9]|1[0-2])$/.test(month))values[path+':'+side]=year+'-'+month;
        else{values[path+':'+side]='[unsupported-date]';}
      }
    }else if(p.property==='degree'){
      const selected=cy(wrapper,'selectedValue');if(selected.length>1){ambiguous=true;continue;}
      values[path]=selected.length?String(selected[0].textContent||'').trim():'';
    }else{
      const inputs=Array.from(wrapper.querySelectorAll('input,textarea')).filter(node=>node.type!=='hidden'&&node.type!=='password');
      if(inputs.length!==1){ambiguous=true;continue;}values[path]=String(inputs[0].value||'');
    }
  }
  const protectedControls=[];
  const hiddenByCSS=node=>{
    for(let parent=node;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==='none'||['hidden','collapse'].includes(style.visibility))return true;}
    return false;
  };
  const notVisuallyObserved=node=>{
    for(let parent=node;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(parent.hidden||parent.getAttribute('aria-hidden')==='true'||parent.hasAttribute('inert')||style.display==='none'||['hidden','collapse'].includes(style.visibility))return true;}
    const rect=node.getBoundingClientRect();return rect.width<=0||rect.height<=0;
  };
  const counterName='formControlChangeFlag';
  const namedCounter=node=>node.id===counterName||node.getAttribute('name')===counterName;
  const activating=node=>['BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY','LABEL','FORM','IFRAME','OBJECT','EMBED'].includes(node.tagName)
    ||node.tagName==='A'&&node.hasAttribute('href')||node.hasAttribute('contenteditable')
    ||['button','link','checkbox','radio','switch','menuitem','menuitemcheckbox','menuitemradio','tab'].includes(node.getAttribute('role'));
  const strictCounter=node=>{
    if(node.tagName!=='INPUT'||(node.type||'text')!=='text'||!namedCounter(node)||node.id&&node.id!==counterName||node.getAttribute('name')&&node.getAttribute('name')!==counterName)return false;
    const names=Array.from(document.querySelectorAll('[id],[name]')).filter(namedCounter);
    if(names.length!==1||names[0]!==node)return false;
    const containers=Array.from(document.querySelectorAll('.resumeEditForm-hiddenField'));
    if(containers.length!==1||containers[0].tagName!=='DIV'||!containers[0].contains(node)||activating(containers[0])||!hiddenByCSS(node))return false;
    for(let parent=node.parentElement;parent&&parent!==containers[0];parent=parent.parentElement)if(activating(parent))return false;
    const forms=Array.from(document.querySelectorAll('form'));if(forms.length!==1||node.closest('form')!==forms[0]||containers[0].closest('form')!==forms[0])return false;
    const sections=Array.from(document.querySelectorAll('.resumeEditForm-education,.resumeEditForm-internship,.resumeEditForm-project')).filter(section=>
      !String(section.getAttribute('class')||'').split(/\s+/).includes('resumeEditForm-item')&&section.closest('.createFormSection-container')
      &&String(section.getAttribute('class')||'').split(/\s+/).some(value=>/^createFormSection__[a-zA-Z0-9]+$/.test(value)));
    return sections.length>0&&sections.every(section=>section.closest('form')===forms[0]);
  };
  for(const element of Array.from(document.querySelectorAll('input,textarea,select,[role="combobox"]')).slice(0,600)){
    if(element.parentElement?.closest('[role="combobox"]'))continue;
    let career=false;for(let node=element;node;node=node.parentElement){if(parse(node.getAttribute('data-cy'))){career=true;break;}}if(career)continue;
    const type=element.tagName==='TEXTAREA'?'textarea':element.tagName==='SELECT'?'select':element.type||'text';
    const context=[element.name||'',element.id||'',element.getAttribute('aria-label')||'',element.getAttribute('autocomplete')||''].join(' ');
    const counter=strictCounter(element);
    const sensitive=type==='hidden'||type==='password'||notVisuallyObserved(element)
      ||/password|passcode|captcha|verification|otp|sms.?code|passport|national.?id|bank|token|auth|credential|secret|api.?key|csrf|xsrf|session|bearer|jwt|密码|验证码|身份证|证件|护照|银行|密钥|令牌|凭证/i.test(context);
    protectedControls.push({tag:element.tagName,type,name:element.name||'',technicalCounter:counter,value:counter?'[technical-change-marker]':sensitive?(Boolean(element.value)?'[present]':''):type==='file'?(element.files?.length?'[file-present]':''):String(element.value||''),
      checked:Boolean(element.checked),files:type==='file'?(element.files?.length||0):0,disabled:Boolean(element.disabled),readOnly:Boolean(element.readOnly),
      ariaValueText:sensitive?Boolean(element.getAttribute('aria-valuetext')):String(element.getAttribute('aria-valuetext')||''),
      selectedLabels:sensitive?Array.from(element.querySelectorAll('[data-cy="selectedValue"]')).some(node=>Boolean(node.textContent)):
        Array.from(element.querySelectorAll('[data-cy="selectedValue"]')).slice(0,20).map(node=>String(node.textContent||''))});
  }
  return{ambiguous,values,groupIds,protectedControls};
})()`;

interface IndependentSnapshot { ambiguous: boolean; values: Record<string, string>; groupIds: string[]; protectedControls: unknown[]; }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sortedEntries = (value: Record<string, string>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
function semanticGroups(snapshot: IndependentSnapshot) {
  return snapshot.groupIds.map(id => ({ kind: id.split('[')[0], fields: sortedEntries(snapshot.values)
    .filter(([path]) => path.startsWith(id + '.')).map(([path, value]) => [path.slice(id.length + 1), value]) }));
}
function foreignValues(snapshot: IndependentSnapshot, ids: readonly string[]) {
  return sortedEntries(snapshot.values).filter(([path]) => ids.some(id => path.startsWith(id + '.')));
}
/** Compare private snapshots in memory; persist only counts, hashes and change flags. */
function protectedRecoveryDiagnostics(before: readonly unknown[], after: readonly unknown[]) {
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
  const beforeOrdered = before.map(canonical); const afterOrdered = after.map(canonical);
  const metadata = (value: unknown) => {
    const entry = isObject(value) ? value : undefined;
    if (!entry) return { exists: false };
    const tag = typeof entry.tag === 'string' ? entry.tag.toLowerCase() : '';
    const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
    const name = typeof entry.name === 'string' ? entry.name : '';
    return { exists: true,
      tag: ['input', 'textarea', 'select', 'div', 'span', 'button'].includes(tag) ? tag : 'other',
      type: ['text', 'search', 'email', 'tel', 'password', 'hidden', 'url', 'checkbox', 'radio', 'file', 'number', 'date', 'month', 'week', 'datetime-local', 'time', 'range', 'color', 'select', 'select-one', 'select-multiple', 'textarea', 'button', 'submit', 'reset'].includes(type) ? type : 'other',
      hasName: Boolean(name), nameHash: name ? createHash('sha256').update(name).digest('hex') : null,
      valuePresent: typeof entry.value === 'string' && Boolean(entry.value.trim()), checked: entry.checked === true,
      filesPresent: typeof entry.files === 'number' && entry.files > 0, disabled: entry.disabled === true, readOnly: entry.readOnly === true,
      ariaValueTextPresent: Boolean(entry.ariaValueText), selectedLabelsPresent: Array.isArray(entry.selectedLabels)
        ? entry.selectedLabels.some((label: unknown) => typeof label === 'string' && Boolean(label.trim())) : entry.selectedLabels === true };
  };
  const changed = [];
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    if (beforeOrdered[index] === afterOrdered[index]) continue;
    const left = isObject(before[index]) ? before[index] as Record<string, unknown> : {};
    const right = isObject(after[index]) ? after[index] as Record<string, unknown> : {};
    changed.push({ index, baseline: metadata(before[index]), restored: metadata(after[index]),
      valueChanged: !equal(left.value, right.value), checkedChanged: !equal(left.checked, right.checked), filesChanged: !equal(left.files, right.files),
      disabledChanged: !equal(left.disabled, right.disabled), readOnlyChanged: !equal(left.readOnly, right.readOnly),
      ariaValueTextChanged: !equal(left.ariaValueText, right.ariaValueText), selectedLabelsChanged: !equal(left.selectedLabels, right.selectedLabels) });
  }
  return { baselineProtectedCount: before.length, restoredProtectedCount: after.length,
    orderedEqual: equal(beforeOrdered, afterOrdered), multisetEqual: equal([...beforeOrdered].sort(), [...afterOrdered].sort()), changed };
}
/** Derive evidence from already-read host snapshots; never persist those snapshots. */
function safeAddTransition(before: CareerFormObservation, after: CareerFormObservation, collection: 'educations' | 'internships' | 'projects') {
  const groupId = (value: string) => /^(?:education|internship|project)\[(?:0|[1-9]\d{0,5})\]$/.test(value) ? value : null;
  const type = (value: string) => fieldTypes.has(value) ? value : 'other';
  const beforeProtected = before.protectedFields ?? []; const afterProtected = after.protectedFields ?? [];
  return { collection, beforeGroupCount: before.groups.length, afterGroupCount: after.groups.length,
    oldGroups: before.groups.map((group, index) => {
      const current = after.groups.find(candidate => candidate.id === group.id);
      return { ordinal: index + 1, id: groupId(group.id), collection: group.collection, exists: Boolean(current),
        sameOrdinalId: after.groups[index] ? groupId(after.groups[index]!.id) : null,
        identityAtOrdinalChanged: group.id !== after.groups[index]?.id, signatureChanged: group.signature !== current?.signature,
        fieldCountChanged: group.fields.length !== current?.fields.length,
        fields: group.fields.map((field, fieldIndex) => {
          const next = current?.fields.find(candidate => candidate.id === field.id);
          return { ordinal: fieldIndex + 1, key: keys.has(field.key) ? field.key : 'other', type: type(field.type),
            exists: Boolean(next), signatureChanged: field.signature !== next?.signature, valueChanged: field.value !== next?.value,
            editableChanged: field.editable !== next?.editable, typeChanged: field.type !== next?.type };
        }) };
    }),
    newGroups: after.groups.filter(group => !before.groups.some(candidate => candidate.id === group.id)).map(group => ({ id: groupId(group.id), collection: group.collection,
      fields: group.fields.map(field => ({ key: keys.has(field.key) ? field.key : 'other', type: type(field.type), hasValue: Boolean(field.value.trim()), editable: field.editable })) })),
    otherAddChanged: !equal(before.addControls.filter(control => control.collection !== collection), after.addControls.filter(control => control.collection !== collection)),
    currentAddChanged: !equal(before.addControls.filter(control => control.collection === collection), after.addControls.filter(control => control.collection === collection)),
    protectedDiagnostics: protectedRecoveryDiagnostics(beforeProtected, afterProtected),
    protectedSignatureChanges: Array.from({ length: Math.max(beforeProtected.length, afterProtected.length) }, (_entry, index) => ({ index,
      baselineExists: Boolean(beforeProtected[index]), afterExists: Boolean(afterProtected[index]),
      changed: beforeProtected[index]?.signature !== afterProtected[index]?.signature })).filter(item => item.changed) };
}
interface TechnicalMarkerMetadata {
  idCanonical: 'ResumeId' | 'formControlChangeFlag';
  status: 'observed' | 'missing' | 'ambiguous'; type: 'text' | 'hidden' | 'search' | 'other';
  computedHidden: boolean | null; signature: string | null;
}
const technicalMarkerBaselineScript = `(async () => {
  if(location.origin!=='https://modelbest.jobs.feishu.cn')throw new Error('MARKER_ORIGIN_REQUIRED');
  const raw=${READ_FEISHU_CAREER};
  const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(value=>value.toString(16).padStart(2,'0')).join('');
  const nodes=Array.from(document.querySelectorAll('.resumeEditForm-hiddenField input'));
  return Promise.all(['ResumeId','formControlChangeFlag'].map(async idCanonical=>{
    const found=nodes.filter(node=>node.id===idCanonical||node.getAttribute('name')===idCanonical);
    const controls=Array.isArray(raw.protectedControls)?raw.protectedControls.filter(control=>control.id===idCanonical||control.name===idCanonical):[];
    if(found.length!==1||controls.length!==1)return{idCanonical,status:found.length||controls.length?'ambiguous':'missing',type:'other',computedHidden:null,signature:null};
    const node=found[0],control=controls[0];let computedHidden=false;
    for(let parent=node;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(parent.hidden||style.display==='none'||['hidden','collapse'].includes(style.visibility)||Number(style.opacity)===0)computedHidden=true;}
    return{idCanonical,status:'observed',type:['text','hidden','search'].includes(node.type)?node.type:'other',computedHidden,
      signature:await digest(JSON.stringify([control.identity,control.disabled,control.readOnly,control.sensitive]))};
  }));
})()`;
function safeTechnicalMarkerTransition(markers: readonly TechnicalMarkerMetadata[], before: CareerFormObservation, after: CareerFormObservation) {
  return markers.map(marker => {
    const left = marker.signature ? (before.protectedFields ?? []).filter(field => field.signature === marker.signature) : [];
    const right = marker.signature ? (after.protectedFields ?? []).filter(field => field.signature === marker.signature) : [];
    const unique = left.length === 1 && right.length === 1;
    return { idCanonical: marker.idCanonical, metadataObservedAt: 'pre-native-baseline', metadataStatus: marker.status,
      type: marker.type, computedHidden: marker.computedHidden, beforeMatches: left.length, afterMatches: right.length,
      beforeExists: left.length > 0, afterExists: right.length > 0,
      beforeValuePresent: left.length === 1 ? Boolean(left[0]!.value.trim()) : null,
      afterValuePresent: right.length === 1 ? Boolean(right[0]!.value.trim()) : null,
      valueChanged: unique ? left[0]!.value !== right[0]!.value : null };
  });
}
const driverErrors = new Set([
  '飞书网页观察无效。','飞书控件位置无效。','飞书执行截止时间无效。','本次飞书执行已停止，不能继续或自动重试。','本次飞书操作已取消或超时。','飞书网页或页面代次已变化。',
  '飞书浏览器失焦或隐藏，本次填写已停止。','网页缩放已变化，请重新观察。','网页可用区域已变化，请重新观察。','请先把飞书测试窗口保持在前台，再开始填写。','开始期间窗口失去前台，未获取网页焦点。','飞书网页区域不可用。','网页未取得稳定输入焦点。',
  '飞书页面单步读取超时，停止后续动作。','读取期间飞书网页地址已变化。','个人资料或确认修订已变化。','当前飞书表单结构尚未核实，停止原生操作。','飞书经历组身份无效。','飞书经历字段身份无效。','页面、资料或非目标控件已变化。','目标字段原值或中间结果与授权不符。','其他经历或字段已变化，停止填写。','飞书目标字段不唯一。',
  '控件中心尚未进入网页可见区域。','滚动区域被遮挡或变化。','没有可核实的网页滚动区域。','字段位置持续变化，停止点击。','移动鼠标后字段位置变化。','字段仍被遮挡，不点击浮层。','原生滚动无进展或没有稳定。','字段尚未滚到可核实区域。','点击前字段命中或原值发生变化。','网页曾显示结果后又回退，停止核实。','网页没有稳定保留预期结果。',
  '新增入口与本次绑定不符。','新增入口身份变化。','新增入口位置持续变化。','新增入口被遮挡或变化。','新增入口在中部仍被遮挡。','新增入口没有可核实的滚动方向。','滚动期间新增入口身份变化。','新增入口滚动无进展或不稳定。','新增入口未进入可核实区域。','字段不属于当前空白填写授权。','当前字段不可编辑。','字段类型未核实。','字段没有取得真实输入焦点。','发送文字前字段焦点或原值变化。','离开字段前焦点或真实值变化，不发送后续按键。',
  '未观察到严格关联的学历选项。','没有唯一的真实学历选项。','学历选项在点击前变化。','学历弹层没有唯一确认选中项。','年月资料或控件端点未核实。','已打开的年月弹层与当前端点不符。','年月弹层位置或选项未稳定。','未观察到绑定的年月弹层。','年月列没有唯一真实选项。','年月选项被遮挡或变化。','年月选项持续被遮挡。','年月选项在列中部仍被遮挡。','年月列没有可核实的滚动方向。','年月滚动列被遮挡或变化。','年月滚动期间弹层已变化。','年月列滚动无进展或不稳定。','年月选项没有进入可核实区域。','学历弹层位置或选项未稳定。',
]);

/** Failure evidence only: no control values/text/opaque IDs and no native action. */
function failureDateStructureScript(path: string, side: 'start' | 'end', geometry: unknown): string {
  if (!/^(?:education|internship|project)\[(?:0|[1-9]\d{0,5})\]\.period$/.test(path)) throw new Error('DATE_PROBE_PATH_REQUIRED');
  const candidate = isObject(geometry) ? geometry : {};
  const cleanRect = (value: unknown) => isObject(value) && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))
    ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
  const cleanPoint = (value: unknown) => isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null;
  const target = { optionBounds: cleanRect(candidate.optionBounds), point: cleanPoint(candidate.point) };
  return `(() => {
    if(location.origin!=='https://modelbest.jobs.feishu.cn')throw new Error('DATE_PROBE_ORIGIN_REQUIRED');
    const path=${JSON.stringify(path)},side=${JSON.stringify(side)},target=${JSON.stringify(target)};
    const popupCy=path+'Input'+(side==='start'?'Begin':'End')+'Dropdown';
    const knownClasses=new Set(['atsx-date-picker-period-month-panel','atsx-date-picker-period-month-panel-list',
      'atsx-date-picker-period-month-panel-list-item','atsx-date-picker-period-month-panel-list-item-selected','atsx-date-picker-period-month-panel-list-item-focused',
      'atsx-date-picker-period-month-label','atsx-date-picker-period-month-label-year','atsx-date-picker-period-month-label-month',
      'atsx-date-picker-dropdown','atsx-date-picker-dropdown-hidden','atsx-date-picker-dropdown-placement-bottomLeft','atsx-date-picker-dropdown-placement-topLeft',
      'atsx-date-picker-period-month','atsx-date-picker-period-month-picker','atsx-date-picker-period-month-panel-wrapper',
      'atsx-message','atsx-message-notice','atsx-message-notice-content','atsx-message-custom-content',
      'atsx-message-error','atsx-message-warning','atsx-message-info','atsx-message-loading','atsx-message-success',
      'atsx-message-notice-wrapper','atsx-message-notice-close','atsx-message-notice-closable',
      'ps','ps--active-x','ps--active-y','ps--scrolling-x','ps--scrolling-y','ps__rail-y','ps__rail-x','ps__thumb-y','ps__thumb-x']);
    const classes=node=>String(node.getAttribute('class')||'').split(/\\s+/).filter(value=>knownClasses.has(value)).slice(0,20);
    const rect=node=>{const b=node.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
    const allowed=(value,values)=>values.includes(value)?value:'other';
    const metadata=node=>{
      if(!node)return null;
      const style=getComputedStyle(node),rawCy=node.getAttribute('data-cy')||'',tag=String(node.tagName||'').toLowerCase();
      const canonical=/^(education|internship|project)\\[(?:0|[1-9]\\d{0,5})\\]\\.period(Input[A-Za-z]{0,64})?$/.exec(rawCy);
      const opacity=Number(style.opacity),zIndex=style.zIndex==='auto'?'auto':Number(style.zIndex);
      const finite=value=>Number.isFinite(value)?value:null;
      return {tag:/^(?:div|span|input|button|body|html|svg|path|ul|li|section|main|header|p|label)$/.test(tag)?tag:'other',classes:classes(node),rect:rect(node),
        dataCy:canonical?canonical[1]+'[].period'+(canonical[2]||''):/^(?:0?[1-9]|1[0-2]|1[89]\\d{2}|20\\d{2}|21\\d{2}|2200)$/.test(rawCy)?rawCy:null,
        scroll:{scrollTop:finite(node.scrollTop),scrollHeight:finite(node.scrollHeight),clientHeight:finite(node.clientHeight)},
        style:{display:allowed(style.display,['none','block','inline','inline-block','flex','inline-flex','grid','inline-grid','contents','table','table-row','table-cell','list-item']),
          visibility:allowed(style.visibility,['visible','hidden','collapse']),opacity:Number.isFinite(opacity)?opacity:null,
          pointerEvents:allowed(style.pointerEvents,['auto','none','visiblePainted','visibleFill','visibleStroke','visible','painted','fill','stroke','all']),
          overflow:allowed(style.overflow,['visible','hidden','clip','scroll','auto','hidden auto','auto hidden']),overflowX:allowed(style.overflowX,['visible','hidden','clip','scroll','auto']),overflowY:allowed(style.overflowY,['visible','hidden','clip','scroll','auto']),
          position:allowed(style.position,['static','relative','absolute','fixed','sticky']),zIndex:zIndex==='auto'||Number.isFinite(zIndex)?zIndex:null}};
    };
    const parents=node=>{const list=[];for(let parent=node?.parentElement,depth=0;parent&&depth<10;parent=parent.parentElement,depth++)list.push(metadata(parent));return list;};
    const associatedPeriod=node=>{for(let parent=node,depth=0;parent&&depth<=10;parent=parent.parentElement,depth++){const cy=metadata(parent).dataCy;if(cy&&/^(?:education|internship|project)\\[\\]\\.period/.test(cy))return cy;}return null;};
    const panels=Array.from(document.querySelectorAll('[data-cy]')).filter(node=>node.getAttribute('data-cy')===popupCy).slice(0,4);
    const allPeriodPanels=Array.from(document.querySelectorAll('.atsx-date-picker-period-month-panel')).slice(0,12);
    const periodInputNodes=Array.from(document.querySelectorAll('[data-cy]')).filter(node=>/^(education|internship|project)\\[(?:0|[1-9]\\d{0,5})\\]\\.periodInput[A-Za-z]{0,64}$/.test(node.getAttribute('data-cy')||'')).slice(0,60);
    const numeric=value=>/^(?:0?[1-9]|1[0-2]|1[89]\\d{2}|20\\d{2}|21\\d{2}|2200)$/.test(value||'');
    return {kind:'date-failure-structure',side,viewport:{width:innerWidth,height:innerHeight},popupCount:panels.length,
      allPeriodPanels:allPeriodPanels.map(node=>({node:metadata(node),associatedPeriod:associatedPeriod(node),parentChain:parents(node),
        columns:Array.from(node.querySelectorAll('div')).filter(column=>classes(column).includes('atsx-date-picker-period-month-panel-list')).slice(0,6).map(column=>({node:metadata(column),parentChain:parents(column)}))})),
      periodInputNodes:periodInputNodes.map(node=>({node:metadata(node),parentChain:parents(node)})),
      panels:panels.map(panel=>{
        const columns=Array.from(panel.querySelectorAll('div')).filter(node=>classes(node).includes('atsx-date-picker-period-month-panel-list')).slice(0,6);
        const items=columns.flatMap(column=>Array.from(column.querySelectorAll('[data-cy]')).filter(node=>numeric(node.getAttribute('data-cy'))).map(node=>({node,column,rect:rect(node)})));
        const close=(a,b)=>a&&b&&['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<=1);
        const targetItems=target.optionBounds?items.filter(item=>close(item.rect,target.optionBounds)).slice(0,3):[];
        const samples=[];
        if(target.point)samples.push(target.point);
        for(const item of targetItems){const b=item.rect,x=b.x+b.width/2,y=b.y+b.height/2,dx=Math.min(10,b.width/4),dy=Math.min(8,b.height/4);
          samples.push({x,y},{x:x-dx,y},{x:x+dx,y},{x,y:y-dy},{x,y:y+dy});}
        const points=samples.filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=0&&point.y>=0&&point.x<innerWidth&&point.y<innerHeight)
          .filter((point,index,all)=>all.findIndex(other=>Math.abs(other.x-point.x)<.5&&Math.abs(other.y-point.y)<.5)===index).slice(0,8);
        return {popup:metadata(panel),parentChain:parents(panel),columns:columns.map((column,index)=>({ordinal:index+1,node:metadata(column),parentChain:parents(column)})),
          targetOptions:targetItems.map(item=>({node:metadata(item.node),parentChain:parents(item.node)})),
          hits:points.map(point=>{const hit=document.elementFromPoint(point.x,point.y);return {point,hit:metadata(hit),parentChain:parents(hit),
            hitInsidePopup:Boolean(hit&&panel.contains(hit)),hitInsideTargetOption:targetItems.some(item=>hit&&(hit===item.node||item.node.contains(hit))),hitInsideTargetColumn:targetItems.some(item=>hit&&item.column.contains(hit))};})};
      })};
  })()`;
}

/** Explicit lab only. Network is locked before synthetic values and stays locked afterwards. */
export async function runFeishuSiteLabEngine(ctx: FeishuSiteLabContext): Promise<{ ok: boolean; status: string; reportPath: string }> {
  if (!process.argv.includes('--site-diagnostic') || !process.argv.includes('--site-adapter-lab')
    || process.argv.includes('--smoke-test') || process.argv.includes('--live-product-check')
    || ctx.window.isDestroyed() || ctx.view.webContents.isDestroyed()) throw new Error('SITE_ADAPTER_LAB_REQUIRED');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const directory = resolve(ctx.directory);
  if (directory !== ctx.directory || !directory.startsWith(join(root, '.backups/feishu-site-diagnostic') + sep)) throw new Error('SITE_ADAPTER_LAB_DIRECTORY_REQUIRED');
  const contents = ctx.view.webContents;
  const assertOrigin = () => {
    if (contents.isDestroyed() || ctx.window.isDestroyed()) throw new Error('SITE_ADAPTER_LAB_VIEW_CLOSED');
    let url: URL; try { url = new URL(contents.getURL()); } catch { throw new Error('SITE_ADAPTER_LAB_ORIGIN_REQUIRED'); }
    if (url.origin !== TARGET_ORIGIN || url.username || url.password) throw new Error('SITE_ADAPTER_LAB_ORIGIN_REQUIRED');
  };
  assertOrigin();
  const profile = createCareerFormFixtureProfile(); const fakeStrings = fixtureStrings(profile);
  const uniqueFakeStrings = fakeStrings.filter(value => /虚构|Fictional|career-form-validation|offeragent-fictional/i.test(value));
  const selectedRecordIds = { educations: profile.career!.educations.map(record => record.id), internships: profile.career!.internships.map(record => record.id), projects: profile.career!.projects.map(record => record.id) };
  let phase: FeishuLabPhase | 'transition' = 'actions';
  let transitionURL = '';
  const networkReasons: Partial<Record<FeishuLabRequestReason, number>> = {};
  const networkPhaseCounts = { actions: 0, transition: 0, reload: 0 };
  contents.session.webRequest.onBeforeRequest((request, callback) => {
    const requestPhase = phase;
    const decision = requestPhase === 'actions' ? decideLabRequest({ method: '', url: '' }, fakeStrings, 'actions')
      : requestPhase === 'transition' ? decideLabReloadTransition({ method: request.method, url: request.url, resourceType: request.resourceType }, transitionURL, fakeStrings)
      : decideLabRequest({ method: request.method, url: request.url }, fakeStrings, 'reload');
    networkReasons[decision.reason] = (networkReasons[decision.reason] ?? 0) + 1;
    networkPhaseCounts[requestPhase]++;
    callback({ cancel: !decision.allow });
  });
  const report: Record<string, any> = { schemaVersion: 2, kind: 'feishu-lab-native-career-validation',
    realEnterprisePage: true, realModelCalled: false, modelCalls: 0, submitted: false, attachmentsUploaded: false,
    ordinaryStoreRead: false, privateValuesPersisted: false, fullURLPersisted: false, expectedRecords: 6, expectedFieldCount: 32,
    network: { phase: 'actions', rejectsEveryNewActionRequest: true, reasonCounts: networkReasons, phaseCounts: networkPhaseCounts,
      websocketRequestsAlwaysDenied: true, existingConnectionPayloadsInspected: false }, reloadTransitions: [],
    journal: [], nativeActions: 0, cleanup: { attempted: false, complete: false } };
  const engineVersion = new URL(import.meta.url).searchParams.get('version');
  report.engineSha256 = engineVersion && /^[a-f0-9]{64}$/.test(engineVersion) ? engineVersion : hash(await readFile(fileURLToPath(import.meta.url)));
  const steps = new SmokeStepRunner('feishu-lab-native');
  const cleanupSteps = new SmokeStepRunner('feishu-lab-cleanup');
  const controller = new AbortController(); let abortTimer: ReturnType<typeof setTimeout> | undefined;
  const abortOnBlur = () => controller.abort();
  let driver: FeishuCareerDriver | undefined, baseline: IndependentSnapshot | undefined, initial: CareerFormObservation | undefined;
  let result: CareerRunnerResult | undefined; let serverURL = ''; let nativeStarted = false; let stage = 'preflight'; let status = 'validation-incomplete';
  const foreignGroupIds: string[] = [];
  const actionIds = new Map<string, number>();
  let lastDateField: { path: string; side: 'start' | 'end' } | undefined;
  let pendingAddEvidence: { before: CareerFormObservation; collection: 'educations' | 'internships' | 'projects'; captured: boolean; actionOrdinal: number } | undefined;
  let technicalMarkers: TechnicalMarkerMetadata[] = [];
  const journalPath = join(directory, `lab-journal-${randomUUID()}.jsonl`);
  await writeFile(journalPath, '', { mode: 0o600, flag: 'wx' });
  report.journalFile = basename(journalPath);
  const journal = async (event: CareerRunnerJournalEvent) => {
    if (!actionIds.has(event.action.id)) actionIds.set(event.action.id, actionIds.size + 1);
    const safe = { action: actionIds.get(event.action.id), phase: event.phase, kind: event.action.kind, collection: event.action.collection,
      ...(event.action.key && keys.has(event.action.key) ? { key: event.action.key } : {}),
      ...(event.phase === 'result' ? { status: event.status, ...(event.reason ? { reason: event.reason } : {}) } : {}) };
    report.lastAction = { kind: safe.kind, collection: safe.collection, ...(safe.key ? { key: safe.key } : {}) };
    if (event.phase === 'intent') {
      const date = /^(education|internship|project)\[(?:0|[1-9]\d{0,5})\]\.period:(start|end)$/.exec(event.action.fieldId ?? '');
      lastDateField = (safe.key === 'startDate' || safe.key === 'endDate') && date
        ? { path: event.action.fieldId!.slice(0, event.action.fieldId!.lastIndexOf(':')), side: date[2] as 'start' | 'end' } : undefined;
    }
    report.journal.push(safe); await appendFile(journalPath, JSON.stringify(safe) + '\n', { encoding: 'utf8' });
  };
  const callDriver = async <T>(operation: string, work: () => T | Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) {
      if (!report.driverFailure) {
        const message = error instanceof Error && driverErrors.has(error.message) ? error.message : undefined;
        report.driverFailure = { operation, code: message ? `driver-${[...driverErrors].indexOf(message) + 1}` : 'driver-unclassified', ...(message ? { message } : {}) };
        if (lastDateField && ['startDate', 'endDate'].includes(report.lastAction?.key)) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            assertOrigin(); const generation = ctx.getGeneration();
            const probe = failureDateStructureScript(lastDateField.path, lastDateField.side, driver?.getSummary().lastMonthGeometry);
            const capture = await Promise.race([contents.executeJavaScript(probe), new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error('DATE_FAILURE_PROBE_DEADLINE')), 2000);
            })]);
            assertOrigin();
            report.failureDateStructure = ctx.getGeneration() === generation ? { status: 'captured', ...capture } : { status: 'page-changed' };
          } catch { report.failureDateStructure = { status: 'unavailable' }; }
          finally { if (timer) clearTimeout(timer); }
        }
      }
      throw error;
    }
  };
  const readIndependent = async (runner: SmokeStepRunner): Promise<IndependentSnapshot> => {
    assertOrigin();
    const data = await runner.run('independent-fixed-data-cy-read', () => contents.executeJavaScript(independentReadScript), 3000);
    if (!isObject(data) || data.ambiguous !== false || !isObject(data.values) || !Array.isArray(data.groupIds) || !Array.isArray(data.protectedControls)) throw new Error('INDEPENDENT_READ_UNAVAILABLE');
    return data as IndependentSnapshot;
  };
  const hasUniqueFixture = (snapshot: IndependentSnapshot) => Object.values(snapshot.values).some(value => uniqueFakeStrings.some(fake => value.includes(fake)))
    || snapshot.protectedControls.some(value => uniqueFakeStrings.some(fake => JSON.stringify(value).includes(fake)));
  const safeReload = async (runner: SmokeStepRunner, discardFixtureDraft = false) => {
    assertOrigin();
    const oldTimeOrigin = await runner.run('read-old-document-time-origin', () => contents.executeJavaScript('performance.timeOrigin'), 3000);
    if (typeof oldTimeOrigin !== 'number' || !Number.isFinite(oldTimeOrigin) || oldTimeOrigin <= 0) throw new Error('OLD_DOCUMENT_TIME_ORIGIN_UNAVAILABLE');
    const before = ctx.getGeneration(); const exactURL = contents.getURL(); transitionURL = exactURL;
    phase = 'transition'; report.network.phase = 'transition';
    const transition = { commitCount: 0, newDocumentConfirmed: false, oldConnectionsCloseCompleted: false };
    report.reloadTransitions.push(transition);
    let reloadIssued = false;
    const documentCommitted = (_event: Electron.Event, url: string) => {
      if (!reloadIssued || phase !== 'transition' || url !== exactURL) return;
      try {
        assertOrigin(); transition.commitCount++;
        // did-navigate is the main-frame commit. Start-navigation/generation
        // alone must never unlock the old document's resource requests.
        phase = 'reload'; report.network.phase = 'reload';
      } catch { /* Keep the transition lock on a different document. */ }
    };
    const allowFixtureUnload = (event: Electron.Event) => {
      // Only this explicit lab's own controlled reload may discard its local
      // fictional draft. No listener is installed on the ordinary application.
      if (!discardFixtureDraft) return;
      try {
        assertOrigin(); event.preventDefault();
        report.fixtureDraftUnloadDiscards = (report.fixtureDraftUnloadDiscards ?? 0) + 1;
      } catch { /* A changed origin is never overridden. */ }
    };
    contents.on('will-prevent-unload', allowFixtureUnload);
    contents.on('did-navigate', documentCommitted);
    try {
      await runner.run('close-old-document-network-connections', () => contents.session.closeAllConnections(), 3000);
      transition.oldConnectionsCloseCompleted = true;
      reloadIssued = true;
      contents.reload();
      const until = performance.now() + 45_000; let stableAt: number | undefined; let previous = '';
      while (performance.now() < until) {
        await delay(160); assertOrigin();
        const generation = ctx.getGeneration();
        if (transition.commitCount < 1 || (phase as FeishuLabPhase | 'transition') !== 'reload' || generation <= before || contents.isLoadingMainFrame()) continue;
        const nextTimeOrigin = await runner.run('read-replacement-document-time-origin', () => contents.executeJavaScript('performance.timeOrigin'), 3000);
        if (typeof nextTimeOrigin !== 'number' || !Number.isFinite(nextTimeOrigin) || nextTimeOrigin <= 0 || nextTimeOrigin === oldTimeOrigin) continue;
        transition.newDocumentConfirmed = true;
        const raw = await runner.run('reload-production-read-memory-only', () => contents.executeJavaScript(READ_FEISHU_CAREER), 3000);
        assertOrigin();
        if (generation !== ctx.getGeneration() || !isObject(raw) || raw.supported !== true || !Array.isArray(raw.groups)) { stableAt = undefined; continue; }
        const state = JSON.stringify(raw.groups.map((group: any) => [group.kind, group.key, group.fields?.map((field: any) => [field.property, field.side, field.value])]));
        if (state !== previous) { previous = state; stableAt = performance.now(); }
        if (stableAt !== undefined && performance.now() - stableAt >= 480) return;
      }
      throw new Error('SAFE_RELOAD_FORM_UNAVAILABLE');
    } finally {
      contents.removeListener('will-prevent-unload', allowFixtureUnload);
      contents.removeListener('did-navigate', documentCommitted);
      transitionURL = '';
      phase = 'actions'; report.network.phase = 'actions';
    }
  };
  const safeDegreePopup = (path: string): string => {
    if (!/^education\[(?:0|[1-9]\d{0,5})\]\.degree$/.test(path)) throw new Error('DEGREE_PATH_REQUIRED');
    return `(async () => {
      if(location.origin!=='https://modelbest.jobs.feishu.cn')throw new Error('LAB_ORIGIN_CHANGED');
      const raw=${readFeishuSelectPopup(path)};
      const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value||''))))).map(value=>value.toString(16).padStart(2,'0')).join('');
      const visibleDegree=label=>/^(?:MBA|EMBA|博士后|博士(?:研究生)?|硕士(?:研究生)?|研究生|本科|学士|大专|专科|高中|中专|初中|小学|其他|其它|PhD|Doctorate|Master(?:'s)?(?: degree)?|Bachelor(?:'s)?(?: degree)?|Associate(?:'s)?(?: degree)?|High school|Other)$/i.test(String(label||'').trim());
      const bounds=value=>value&&['x','y','width','height'].every(key=>Number.isFinite(value[key]))?{x:value.x,y:value.y,width:value.width,height:value.height}:null;
      return {owner:raw.owner?{focused:raw.owner.focused===true,valueStillEmpty:raw.owner.value==='',identityHash:await digest(raw.owner.identity)}:null,
        popup:raw.popup?{identityHash:await digest(raw.popup.identity),options:await Promise.all(raw.popup.options.slice(0,100).map(async option=>({label:visibleDegree(option.label)?String(option.label).trim():'[non-public-degree-label]',selected:option.selected===true,bounds:bounds(option.bounds),identityHash:await digest(option.identity)})))}:null};
    })()`;
  };

  try {
    const gate = await nativeFixtureGate(root); report.nativeFixtureGate = gate;
    report.structure = await steps.run('fixed-safe-structure-probe', () => contents.executeJavaScript(safeFeishuStructureProbeScript), 3000);
    const raw = await steps.run('production-read-memory-only', () => contents.executeJavaScript(READ_FEISHU_CAREER), 3000);
    const supported = isObject(raw) && raw.supported === true;
    report.adapter = { supported, reason: safeAdapterReason(isObject(raw) ? raw.reason : undefined), addCount: isObject(raw) && Array.isArray(raw.addControls) ? raw.addControls.length : 0 };
    const existing = supported ? await readIndependent(steps) : undefined;
    if (existing && hasUniqueFixture(existing)) {
      stage = 'recover-previous-fictional-draft';
      report.recovery = { previousUniqueFixtureDetected: true, nativeInputsIssued: false, snapshots: [] };
      const degreePaths = isObject(raw) && Array.isArray(raw.groups) ? raw.groups.flatMap((group: any) => Array.isArray(group?.fields)
        ? group.fields.filter((field: any) => field?.property === 'degree' && typeof field.path === 'string' && /^education\[(?:0|[1-9]\d{0,5})\]\.degree$/.test(field.path)).map((field: any) => field.path) : []).slice(0, 6) : [];
      for (let sample = 0; sample < 2; sample++) {
        const degrees = [];
        for (const path of degreePaths) degrees.push(await steps.run('safe-public-degree-popup-snapshot', () => contents.executeJavaScript(safeDegreePopup(path)), 3000));
        report.recovery.snapshots.push({ sample: sample + 1, degrees });
        if (sample === 0) await delay(200);
      }
      await safeReload(steps, true);
      const restored = await readIndependent(steps);
      report.recovery.protectedDiagnostics = protectedRecoveryDiagnostics(existing.protectedControls, restored.protectedControls);
      report.recovery.noUniqueFixtureValuesRemaining = !hasUniqueFixture(restored);
      report.recovery.serverGroupCount = restored.groupIds.length;
      report.recovery.newCaseDeferredUntilNextClick = true;
      report.cleanup = { attempted: true, complete: report.recovery.noUniqueFixtureValuesRemaining, recoveryOnly: true };
      status = report.recovery.noUniqueFixtureValuesRemaining ? 'recovered' : 'recovery-incomplete';
    }
    else if (!gate.ok) { status = 'native-fixture-required'; }
    else if (!supported) { status = 'site-structure-unsupported'; }
    else {
      stage = 'initial-safe-reload'; await safeReload(steps); serverURL = contents.getURL();
      report.oldDocumentDiscardedBeforeSyntheticInput = true;
      const deadline = performance.now() + 600_000;
      abortTimer = setTimeout(() => controller.abort(), 600_000);
      driver = new FeishuCareerDriver({ window: ctx.window, view: ctx.view, getProfile: () => structuredClone(profile),
        getGeneration: ctx.getGeneration, isVisible: () => ctx.view.getVisible(), deadline, signal: controller.signal });
      stage = 'baseline'; initial = await callDriver('read-baseline', () => driver!.read()); baseline = await readIndependent(steps);
      let markerTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const generation = ctx.getGeneration();
        const data = await Promise.race([contents.executeJavaScript(technicalMarkerBaselineScript), new Promise<never>((_resolve, reject) => {
          markerTimer = setTimeout(() => reject(new Error('MARKER_METADATA_DEADLINE')), 2000);
        })]);
        assertOrigin();
        if (generation === ctx.getGeneration() && Array.isArray(data)) technicalMarkers = data.filter((entry: any) => ['ResumeId', 'formControlChangeFlag'].includes(entry?.idCanonical)
          && ['observed', 'missing', 'ambiguous'].includes(entry.status) && ['text', 'hidden', 'search', 'other'].includes(entry.type)
          && (entry.signature === null || typeof entry.signature === 'string' && /^[a-f0-9]{64}$/.test(entry.signature))).slice(0, 2);
      } catch { report.technicalMarkerMetadataUnavailable = true; }
      finally { if (markerTimer) clearTimeout(markerTimer); }
      if (hasUniqueFixture(baseline)) throw new Error('BASELINE_ALREADY_CONTAINS_FIXTURE');
      foreignGroupIds.push(...initial.groups.filter(group => group.fields.some(field => field.value.trim())).map(group => group.id));
      report.baseline = { groups: initial.groups.map((group, index) => ({ ordinal: index + 1, collection: group.collection,
        preserved: foreignGroupIds.includes(group.id), fields: group.fields.map(field => ({ key: field.key, type: field.type, hasValue: Boolean(field.value.trim()) })) })),
      protectedCount: initial.protectedFields?.length ?? 0, preservedGroups: foreignGroupIds.length };
      report.approvedRecordCounts = { educations: 2, internships: 2, projects: 2 };
      stage = 'driver-start'; ctx.window.on('blur', abortOnBlur);
      await callDriver('start', () => driver!.start()); nativeStarted = true;
      stage = 'native-runner';
      result = await runCareerPlan({ read: async () => {
        const page = await callDriver('read', () => driver!.read());
        if (pendingAddEvidence && !pendingAddEvidence.captured) {
          pendingAddEvidence.captured = true;
          const evidence = { actionOrdinal: pendingAddEvidence.actionOrdinal, ...safeAddTransition(pendingAddEvidence.before, page, pendingAddEvidence.collection),
            technicalMarkers: safeTechnicalMarkerTransition(technicalMarkers, pendingAddEvidence.before, page) };
          report.addTransitions ??= []; report.addTransitions.push(evidence); report.addTransition = evidence;
        }
        return page;
      }, getProfile: () => callDriver('profile', () => driver!.getProfile()),
        assertActive: () => callDriver('assert-active', () => driver!.assertActive()), signal: controller.signal,
        add: (step, plan) => {
          pendingAddEvidence = { before: structuredClone(plan.original), collection: step.collection, captured: false, actionOrdinal: actionIds.size };
          return callDriver('add', () => driver!.add(step, plan));
        }, fill: (step, item, plan) => callDriver('fill', () => driver!.fill(step, item, plan)), journal },
      { selectedRecordIds, preserveGroupIds: foreignGroupIds, maxActions: 100, timeoutMs: Math.max(1, Math.min(600_000, deadline - performance.now())) });
      report.runner = { status: result.status, stopReason: result.stopReason, addedCount: result.added.length, verifiedCount: result.verified.length,
        pending: result.pending.map(item => ({ collection: item.collection, ...(item.key && keys.has(item.key) ? { key: item.key } : {}), required: item.required })),
        bindingCount: result.bindings.length, actionsAttempted: result.actionsAttempted };
      if (result.status === 'stopped' && report.lastAction?.kind === 'add') {
        if (pendingAddEvidence) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            report.independentReadDelayedByAddDiagnosticMs = 400;
            await delay(400);
            const late = await Promise.race([driver.read(), new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error('LATE_ADD_DIAGNOSTIC_DEADLINE')), 2000);
            })]);
            report.lateAddTransition = { status: 'captured', diagnosticOnly: true, delayMs: 400, resultRevived: false,
              actionOrdinal: pendingAddEvidence.actionOrdinal, ...safeAddTransition(pendingAddEvidence.before, late, pendingAddEvidence.collection),
              technicalMarkers: safeTechnicalMarkerTransition(technicalMarkers, pendingAddEvidence.before, late) };
          } catch { report.lateAddTransition = { status: 'unavailable', diagnosticOnly: true, resultRevived: false }; }
          finally { if (timer) clearTimeout(timer); }
        } else report.lateAddTransition = { status: 'no-add-context', diagnosticOnly: true, resultRevived: false };
      }

      const expected: Record<string, string> = {};
      for (const collection of ['educations', 'internships', 'projects'] as const) for (const record of profile.career![collection]) {
        const binding = result.bindings.find(item => item.collection === collection && item.recordId === record.id);
        const kind = collection === 'educations' ? 'education' : collection === 'internships' ? 'internship' : 'project';
        if (!binding || !new RegExp('^' + kind + '\\[(?:0|[1-9]\\d{0,5})\\]$').test(binding.groupId)) continue;
        const group = binding.groupId;
        const fields: Record<string, string> = collection === 'educations'
          ? { school: (record as any).school, degree: (record as any).degree, fieldOfStudy: (record as any).major }
          : collection === 'internships' ? { company: (record as any).organization, title: (record as any).role, desc: record.description }
          : { name: (record as any).name, role: (record as any).role, desc: record.description, link: (record as any).url };
        fields['period:start'] = record.startDate; fields['period:end'] = record.endDate;
        for (const [field, value] of Object.entries(fields)) expected[`${group}.${field}`] = value;
      }
      const inspect = (snapshot: IndependentSnapshot) => ({ expectedCount: Object.keys(expected).length,
        matchingCount: Object.entries(expected).filter(([path, value]) => snapshot.values[path] === value).length,
        all32Correct: Object.keys(expected).length === 32 && Object.entries(expected).every(([path, value]) => snapshot.values[path] === value),
        protectedUnchanged: equal(snapshot.protectedControls, baseline!.protectedControls),
        foreignGroupsUnchanged: equal(foreignValues(snapshot, foreignGroupIds), foreignValues(baseline!, foreignGroupIds)),
        addedGroupCount: snapshot.groupIds.length - baseline!.groupIds.length });
      stage = 'independent-immediate'; const immediate = await readIndependent(steps); report.immediate = inspect(immediate);
      stage = 'independent-one-second'; await delay(1000); const settled = await readIndependent(steps); report.oneSecond = inspect(settled);
      report.sourceGateAfterActions = await nativeFixtureGate(root);
      report.frozenEvidenceUnchangedAfterActions = report.sourceGateAfterActions.ok === true && equal(report.sourceGateAfterActions.evidence, gate.evidence);
      status = result.status === 'completed' && result.pending.length === 0 && result.bindings.length === 6
        && report.immediate.all32Correct && report.oneSecond.all32Correct && report.immediate.protectedUnchanged && report.oneSecond.protectedUnchanged
        && report.immediate.foreignGroupsUnchanged && report.oneSecond.foreignGroupsUnchanged && report.frozenEvidenceUnchangedAfterActions
        && report.immediate.addedGroupCount === result.added.length && report.oneSecond.addedGroupCount === result.added.length ? 'native-validation-passed' : 'native-validation-incomplete';
    }
  } catch {
    report.failure = { stage, code: 'lab-validation-stopped' };
    status = report.nativeFixtureGate?.ok === false ? 'native-fixture-required' : 'validation-incomplete';
  } finally {
    controller.abort(); if (abortTimer) clearTimeout(abortTimer); ctx.window.removeListener('blur', abortOnBlur);
    if (driver) report.nativeSummary = driver.getSummary();
    driver?.dispose();
    // A raced insertText is not cancelled by abort/dispose. No document reload
    // is permitted until its actual promise settles or its destination dies.
    let mutationSettled = !driver?.hasPendingMutation();
    if (!mutationSettled) mutationSettled = await Promise.race([driver!.waitForPendingMutation().then(() => true), delay(5000).then(() => false)]);
    report.pendingMutationSettledBeforeCleanup = mutationSettled;
    if (!mutationSettled && !contents.isDestroyed()) {
      contents.close({ waitForBeforeUnload: false });
      const until = performance.now() + 3000; while (!contents.isDestroyed() && performance.now() < until) await delay(25);
      report.cleanup = { attempted: true, complete: contents.isDestroyed(), viewDestroyed: contents.isDestroyed(), reason: 'pending-native-mutation' };
      status = 'native-view-closed-for-safety';
    } else if (nativeStarted && baseline && serverURL && !contents.isDestroyed()) {
      report.cleanup = { attempted: true, complete: false };
      try {
        if (contents.getURL() !== serverURL) throw new Error('CLEANUP_PAGE_CHANGED');
        await safeReload(cleanupSteps, true);
        const restored = await readIndependent(cleanupSteps);
        const restoredServerGroups = equal(semanticGroups(restored), semanticGroups(baseline));
        const protectedRestored = equal(restored.protectedControls, baseline.protectedControls);
        const noUniqueFixtureValuesRemaining = !hasUniqueFixture(restored);
        report.cleanup = { attempted: true, complete: restoredServerGroups && protectedRestored && noUniqueFixtureValuesRemaining,
          serverGroupsRestored: restoredServerGroups, protectedRestored, noUniqueFixtureValuesRemaining,
          protectedDiagnostics: protectedRecoveryDiagnostics(baseline.protectedControls, restored.protectedControls) };
        if (!report.cleanup.complete) status = 'cleanup-verification-incomplete';
      } catch {
        report.cleanup = { attempted: true, complete: false, reason: 'safe-reload-or-independent-recovery-incomplete' };
        status = 'cleanup-verification-incomplete';
      }
    }
    phase = 'actions'; report.network.phase = 'actions';
  }
  report.nativeActions = actionIds.size; report.status = status; report.harness = steps.snapshot(); report.cleanupHarness = cleanupSteps.snapshot();
  report.fakeProfileUnchanged = equal(profile, createCareerFormFixtureProfile());
  const reportPath = join(directory, `lab-native-${randomUUID()}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  return { ok: (status === 'native-validation-passed' || status === 'recovered') && report.cleanup.complete === true, status, reportPath };
}
