import type { FormObservation, Profile } from '../../shared/src/contracts.js';
import { buildFillPlan } from './index.js';
import {applicationFacts,factFitsField} from './application-facts.js';

/** Strict projection for a user-requested LOCAL diagnostic; never an execution plan. */
export function formDiagnostic(observation: FormObservation, profile: Profile, structure: unknown, semantic?:unknown) {
  const secrets = new Set<string>();
  const collect = (v: unknown) => {
    if (typeof v === 'string' && v.trim().length >= 2 && v.length <= 500) secrets.add(v.trim());
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  }; collect(profile);
  // Actual website values may differ from the resume. They never belong in the diagnostic.
  for (const field of observation.fields) if (field.value.trim().length >= 2) secrets.add(field.value.trim());
  const needles = [...secrets].sort((a,b)=>b.length-a.length);
  const clean = (v: unknown, max=240) => {
    let text = typeof v === 'string' ? v : '';
    for (const value of needles) text=text.split(value).join('[资料值]');
    return text.replace(/[a-z\d._%+-]+@[a-z\d.-]+\.[a-z]{2,}/gi,'[邮箱]').replace(/\d{7,}/g,'[数字]').replace(/https?:\/\/\S+/gi,'[链接]').slice(0,max);
  };
  const integer=(v:unknown,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max?v:null;
  const classNames=(v:unknown)=>Array.isArray(v)?v.filter(s=>typeof s==='string'&&/^[a-zA-Z][a-zA-Z_-]{1,70}$/.test(s)).slice(0,8):[];
  const tag=(v:unknown)=>typeof v==='string'&&/^[A-Z]{1,20}$/.test(v)?v:'';
  const raw=(structure as {controls?:unknown})?.controls;
  const controls=Array.isArray(raw)?raw.slice(0,300).flatMap((c:any)=>{
    const index=integer(c?.index,299);if(index===null)return [];
    return [{index,tag:tag(c.tag),type:clean(c.type,30),classes:classNames(c.classes),...(c.selectSignals?{selectSignals:{owned:c.selectSignals.owned===true,labelSelect:c.selectSignals.labelSelect===true,range:c.selectSignals.range===true,arrowInLabel:c.selectSignals.arrowInLabel===true,scopeFound:c.selectSignals.scopeFound===true,selectedMarkers:integer(c.selectSignals.selectedMarkers,20)}}:{}),ancestors:Array.isArray(c.ancestors)?c.ancestors.slice(0,10).map((a:any)=>({
      depth:integer(a?.depth,10),tag:tag(a?.tag),classes:classNames(a?.classes),visibleControls:integer(a?.visibleControls,1000),nestedLabelCount:integer(a?.nestedLabelCount,1000),
      labels:Array.isArray(a?.labels)?a.labels.slice(0,8).map((l:any)=>({tag:tag(l?.tag),classes:classNames(l?.classes),text:clean(l?.text,120)})):[],
    })):[]}];
  }):[];
  const plan=buildFillPlan(observation,profile);
  const facts=applicationFacts(profile),semanticFields=(semantic as any)?.fields;
  const universal=Array.isArray(semanticFields)?{readOnly:true,fields:semanticFields.slice(0,300).map((f:any)=>({index:integer(f.index,299),label:clean(f.label),section:clean(f.section),group:/^(?:group-\d+|contact)$/.test(f.group??'')?f.group:'unknown',type:clean(f.type,30),hasValue:typeof f.value==='string'&&!!f.value.trim(),editable:f.editable===true,readOnlyWidget:f.readOnlyWidget===true,ownedSelect:f.ownedSelect===true,queryPending:f.queryPending===true,datePart:['year','month'].includes(f.datePart)?f.datePart:undefined,compatibleFactKinds:[...new Set(facts.filter(fact=>factFitsField(fact,{label:String(f.label??''),section:String(f.section??''),type:String(f.type??'')})).map(fact=>fact.kind))]}))}:undefined;
  return {schemaVersion:1,readOnly:true,origin:new URL(observation.url).origin,profileVersion:profile.version,...(universal?{universal}:{}),
    fields:plan.items.map(item=>({index:observation.fields.find(f=>f.id===item.fieldId)?.index??null,label:clean(item.label),type:item.type,required:item.required,status:item.status,reason:clean(item.reason),hasValue:!!item.currentValue.trim(),profileKey:item.profileKey??null})),
    counts:{observed:observation.fields.length,ready:plan.items.filter(i=>i.status==='ready').length,review:plan.items.filter(i=>i.status==='review').length,preservedOrSkipped:plan.items.filter(i=>i.status==='skip').length},
    structure:controls,valuesIncluded:false,planRegistered:false,modelCalls:0,submissions:0};
}
