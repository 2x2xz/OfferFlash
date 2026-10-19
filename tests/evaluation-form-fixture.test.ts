import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { FORM_AUDIT_READ, readFormAudit, renderFormFixture, type FixtureField, type FormAudit, type FormFixtureCase } from '../packages/evaluation/src/form-fixture.js';

const contact: FixtureField = {domId:'name',label:'姓名',section:'申请人资料',type:'text',required:true,initialValue:'',kind:'eligible',expectedValues:['NEVER_RENDER_EXPECTED'],profileKey:'NEVER_RENDER_PROFILE_KEY'};
const keep: FixtureField = {domId:'keep',label:'原有说明',section:'申请人资料',type:'text',required:false,initialValue:'KEEP',kind:'protected',protection:'existing'};
const scenario = (behavior: FormFixtureCase['behavior']='none', fields=[contact,keep]): FormFixtureCase => ({id:'fixture-case',title:'原创表单',description:'NEVER_RENDER_DESCRIPTION_OR_HINTS',fields,behavior});

/** Minimal original DOM simulator: validates fixed audit script logic, not browser layout/execution. */
function auditHarness(item: FormFixtureCase) {
  const nodes=new Map<string,any>(), listeners=new Map<string,Array<(event:any)=>void>>(), timers:Array<{callback:()=>void;ms:number}>=[];
  class Input {tagName='INPUT';type='text';id='';_value='';_checked=false;_files:unknown[]=[];
    get value(){return this._value;} set value(value:string){this._value=value;}
    get checked(){return this._checked;} set checked(value:boolean){this._checked=value;}
    get files(){return this._files;}}
  class Textarea {tagName='TEXTAREA';id='';_value='';get value(){return this._value;}set value(value:string){this._value=value;}}
  class Select {tagName='SELECT';id='';_value='';get value(){return this._value;}set value(value:string){this._value=value;}}
  for(const field of item.fields){const element=field.type==='textarea'?new Textarea():field.type==='select'?new Select():new Input();
    element.id=field.domId;if(element instanceof Input){element.type=field.type;element._checked=field.initialValue===true;}
    element._value=typeof field.initialValue==='string'?field.initialValue:'';nodes.set(field.domId,element);}
  const document={getElementById:(id:string)=>nodes.get(id),activeElement:{id:'',tagName:'BODY'},querySelectorAll:()=>[],
    addEventListener:(name:string,listener:(event:any)=>void)=>{const list=listeners.get(name)??[];list.push(listener);listeners.set(name,list);}};
  const context={window:{},document,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,HTMLSelectElement:Select,
    setTimeout:(callback:()=>void,ms:number)=>{timers.push({callback,ms});return timers.length;}};
  const html=renderFormFixture(item), script=html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  runInNewContext(script,context);
  const emit=(eventName:string,id:string)=>{for(const listener of listeners.get(eventName)??[])listener({target:nodes.get(id),preventDefault(){}});};
  const input=(id:string,value:string)=>{nodes.get(id).value=value;emit('input',id);emit('change',id);};
  const read=(ids?:string[]):FormAudit=>runInNewContext(ids?readFormAudit(ids):FORM_AUDIT_READ,context);
  return {html,context,nodes,timers,emit,input,read};
}

test('fixture renders controls and initial state while withholding answers, profile keys, classifications and prose hints', () => {
  const html=renderFormFixture(scenario());
  for(const forbidden of ['NEVER_RENDER_EXPECTED','NEVER_RENDER_PROFILE_KEY','NEVER_RENDER_DESCRIPTION_OR_HINTS','expectedValues','profileKey','"kind"','"eligible"','"protected"']) assert.equal(html.includes(forbidden),false);
  assert.ok(html.includes('姓名'));assert.ok(html.includes('value="KEEP"'));assert.ok(html.includes('required'));
  assert.ok(html.includes("form-action 'none'"));assert.ok(html.includes("default-src 'none'"));
});

test('HTML attributes, text nodes, textarea bodies and option values cannot escape into scripts or injected controls', () => {
  const attack='</script><script>alert("INJECT")</script><input id="evil">&\u2028\u2029';
  const item=scenario('none',[{...contact,label:attack,section:attack,initialValue:attack},
    {...contact,domId:'bio',type:'textarea',initialValue:attack},
    {...contact,domId:'degree',type:'select',initialValue:attack,options:[{label:attack,value:attack}]}]);item.title=attack;
  const html=renderFormFixture(item);
  assert.equal((html.match(/<script>/g)??[]).length,1);assert.equal((html.match(/<\/script>/g)??[]).length,1);
  assert.equal(html.includes('<input id="evil">'),false);assert.ok(html.includes('&lt;/script&gt;'));
  assert.ok(html.includes('&quot;INJECT&quot;'));assert.doesNotThrow(()=>auditHarness(item));
});

test('native audit preserves string/boolean/file types, reads hidden fields, and does not use production observation', () => {
  const item=scenario('none',[contact,{...keep,domId:'hidden',type:'hidden'},
    {...keep,domId:'yes',type:'checkbox',initialValue:true},{...keep,domId:'no',type:'radio',initialValue:false},
    {...keep,domId:'file',type:'file',initialValue:'',protection:'upload'},
    {...keep,domId:'body',type:'textarea',initialValue:'两行\n文字'},{...keep,domId:'pick',type:'select',initialValue:'one',options:[{label:'选项一',value:'one'}]}]);
  const fixture=auditHarness(item), actual=fixture.read();
  assert.deepEqual(JSON.parse(JSON.stringify(actual.values)),{name:'',hidden:'KEEP',yes:true,no:false,file:'',body:'两行\n文字',pick:'one'});
  assert.equal(actual.activeElement,'BODY');assert.equal(actual.submits,0);assert.equal(actual.clicks,0);assert.equal(actual.filesTouched,0);
  assert.equal(FORM_AUDIT_READ.includes('READ_FORM'),false);assert.equal(FORM_AUDIT_READ.includes('verified'),false);
});

test('ordinary input is independently audited once despite input/change pair and can be read through selected IDs', () => {
  const fixture=auditHarness(scenario());fixture.input('name','虚构名字');
  const actual=fixture.read(['name']);assert.deepEqual(Object.keys(actual.values),['name']);
  assert.equal(actual.values.name,'虚构名字');assert.equal(actual.events.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(actual.events[0])),{fieldId:'name',before:'',after:'虚构名字',cause:'agent-input'});
  actual.events[0]!.after='MUTATED';assert.equal(fixture.read().events[0]!.after,'虚构名字','readback copy cannot mutate audit history');
});

test('immediate reset happens once and records environment cause separately from retry input', () => {
  const fixture=auditHarness(scenario('reset-first-input'));fixture.input('name','虚构名字');
  assert.equal(fixture.read().values.name,'');assert.equal(fixture.read().events[1]!.cause,'environment-injection');
  fixture.input('name','虚构名字');const actual=fixture.read();assert.equal(actual.values.name,'虚构名字');assert.equal(actual.events.length,3);
  assert.deepEqual(Array.from(actual.events,event=>event.cause),['agent-input','environment-injection','agent-input']);
});

test('counterpart mutation is labeled as injected environment change, never attributed to direct agent input', () => {
  const fixture=auditHarness(scenario('mutate-other-on-input'));fixture.input('name','虚构名字');const actual=fixture.read();
  assert.equal(actual.values.keep,'DEMO-ENVIRONMENT-CHANGED');assert.equal(actual.events.length,2);
  assert.equal(actual.events[1]!.fieldId,'keep');assert.equal(actual.events[1]!.before,'KEEP');assert.equal(actual.events[1]!.cause,'environment-injection');
});

test('delayed rollback uses 100ms once and independent settled read can observe first-frame failure', () => {
  const fixture=auditHarness(scenario('delayed-reset'));fixture.input('name','虚构名字');
  assert.equal(fixture.read().values.name,'虚构名字');assert.equal(fixture.timers.length,1);assert.equal(fixture.timers[0]!.ms,100);
  fixture.timers[0]!.callback();assert.equal(fixture.read().values.name,'');assert.equal(fixture.read().events[1]!.cause,'environment-injection');
  fixture.input('name','虚构名字');assert.equal(fixture.timers.length,1);assert.equal(fixture.read().values.name,'虚构名字');
});

test('click, file interaction and attempted submission are separate actual event counters', () => {
  const fixture=auditHarness(scenario('none',[contact,{...keep,domId:'file',type:'file',initialValue:'',protection:'upload'}]));
  fixture.emit('click','name');fixture.emit('submit','name');fixture.nodes.get('file')._files=[{}];fixture.emit('change','file');
  const actual=fixture.read();assert.equal(actual.clicks,1);assert.equal(actual.submits,1);assert.equal(actual.filesTouched,1);
  assert.equal(actual.values.file,'[file-selected]');assert.equal(JSON.stringify(actual).includes('filename'),false);
});

test('custom combobox is manually interactive but has no reviewed native-select shortcut or oracle payload', () => {
  const html=renderFormFixture(scenario('none',[{...contact,type:'combobox',kind:'unsupported'}]));
  assert.ok(html.includes('role="combobox"'));assert.ok(html.includes('role="option"'));assert.ok(html.includes('ArrowDown'));
  assert.ok(html.includes('input.dispatchEvent'));assert.equal(html.includes('aria-controls='),false);assert.equal(html.includes('NEVER_RENDER_EXPECTED'),false);
});

test('all authored dataset cases render and audit initialization works without expected-values exposure', async () => {
  const dataset=JSON.parse(await readFile(new URL('../benchmarks/offerflash-v1/forms.json',import.meta.url),'utf8')) as {cases:FormFixtureCase[]};
  for(const item of dataset.cases){const fixture=auditHarness(item);assert.equal(Object.keys(fixture.read().values).length,item.fields.length);
    assert.equal(fixture.html.includes('expectedValues'),false);assert.equal(fixture.html.includes('profileKey'),false);}
});

test('declared long form contains enough minimum-height sections to require a real 900px viewport scroll', async () => {
  const dataset=JSON.parse(await readFile(new URL('../benchmarks/offerflash-v1/forms.json',import.meta.url),'utf8')) as {cases:FormFixtureCase[]};
  const long=dataset.cases.find(item=>item.title.includes('长表'))!;assert.ok(long);
  const html=renderFormFixture(long),sections=(html.match(/<section class="fixture-section"/g)??[]).length;
  assert.ok(html.includes('<body class="fixture-long-form">'));assert.ok(html.includes('.fixture-long-form .fixture-section{min-height:164px}'));
  assert.ok(sections>=20);assert.ok(sections*164>3000,'layout lower bound exceeds three 900px viewports before margins/header');
  assert.ok(html.indexOf('id="bottom-phone"')>html.indexOf('id="middle-email"'));
  assert.ok(html.indexOf('id="middle-email"')>html.indexOf('id="saved-note-8"'));
  const normal=scenario();assert.equal(renderFormFixture(normal).includes('<body class="fixture-long-form">'),false);
  const unknown=scenario('none',[{...contact,kind:'unsupported'}]);unknown.title='Long-form visual layout';assert.ok(renderFormFixture(unknown).includes('<body class="fixture-long-form">'),'public title alone selects layout');
});

test('invalid IDs, file preselection, typed checkbox mismatch and malformed controls fail closed', () => {
  for(const fields of [[contact,contact],[{...contact,domId:'bad\" onclick=\"x'}],[{...contact,type:'script'}],
    [{...contact,type:'file',initialValue:'a.pdf'}],[{...contact,type:'checkbox',initialValue:'false'}],
    [{...contact,type:'select',initialValue:'missing',options:[{label:'一',value:'one'}]}]]) assert.throws(()=>renderFormFixture(scenario('none',fields)));
  assert.throws(()=>readFormAudit(['a','a']));assert.throws(()=>readFormAudit(['</script>']));
  assert.throws(()=>renderFormFixture(scenario('mutate-other-on-input',[contact])));
});
