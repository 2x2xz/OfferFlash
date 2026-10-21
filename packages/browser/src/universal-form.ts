import {appendApplicationSetupFacts} from '../../forms/src/application-setup-facts.js';
import {FormAttemptMemory,formStateDigest} from './form-attempt-memory.js';
import type {Page,JSHandle} from 'playwright-core';
import type {FieldCompanionTarget} from './field-companion.js';
import type {Profile} from '../../shared/src/contracts.js';
import {applicationFacts,factFitsField,optionMatchesFact,displayedFactMatches,protectedApplicationField,type ApplicationFact} from '../../forms/src/application-facts.js';
import {inferRecordSection,matchExistingRecord} from '../../forms/src/record-binding.js';
import {recordCoverage} from '../../forms/src/record-coverage.js';
import {READ_UNIVERSAL_FORM_FOR_HOST_VERIFICATION,UNIVERSAL_CONTROL_SELECTOR,UNIVERSAL_BOUND_CONTROL_SELECTOR,UNIVERSAL_ACTION_SELECTOR} from './universal-read.js';
import {fillOwnedSelect,ownedOptionMatches,createOwnedSelectController,type OwnedSelectController,type OwnedSelectCommit} from './owned-select.js';
import {universalErrorCode} from './universal-errors.js';
import {universalQuestion,eligibleUniversalAnswers,universalAnswerMatches,universalQuestionDecision,type UniversalAnswerContext,type UniversalQuestion} from '../../forms/src/universal-answers.js';
import {profileFactView,professionalFact} from '../../forms/src/profile-fact-view.js';
import {expandOwnedSection,type OwnedSectionDescriptor,type OwnedRecordKind} from './owned-sections.js';
import {fillOwnedCalendar} from './owned-calendar.js';

const selector=UNIVERSAL_CONTROL_SELECTOR;
const unsafe=/提交|投递|发送|支付|删除|取消|同意|声明|隐私|协议|submit|apply.now|send|delete|remove|cancel|consent|agree|privacy|password|captcha|验证码/i;
type Field={bounds?:FieldCompanionTarget['bounds'];index:number;label:string;type:string;value:string;section:string;group:string;identity:string;options:Array<{label:string;value:string}>;editable:boolean;checked?:boolean;invalid?:boolean;readOnlyWidget?:boolean;ownedSelect?:boolean;queryPending?:boolean;controlValue?:string;expanded?:boolean;popupVisible?:boolean;datePart?:'year'|'month';datePrecision?:'day'|'month';purpose?:'application'|'site-search'|'site-preference'};
const applicationField=(field:Field)=>!field.purpose||field.purpose==='application';
const supportedWrite=(field:Field)=>!!field.ownedSelect||!field.readOnlyWidget&&['text','email','tel','textarea','select','month','date','checkbox','url'].includes(field.type);
type AddAction={index:number;nodeIndex:number;label:string;section:string;group:string;kind?:string;recordKind?:OwnedRecordKind};
type View={fields:Field[];actions:AddAction[];sections?:OwnedSectionDescriptor[];options:Array<{index:number;label:string}>;url:string;};
// DOM actions do not use coordinates. Preserve field/value identity, not layout noise.
const semanticFields=(fields:Field[])=>fields.map(field=>{const {bounds,...semantic}=field as Field&{bounds?:unknown};return semantic;});
const recordFamily=(record:string)=>/^(education|internship|project|publication|language|software|award)-\d+$/.exec(record)?.[1];
const careerFact=(fact:ApplicationFact)=>!!recordFamily(fact.record);
const familyExpression=(kind:string)=>new RegExp(({education:'教育|学历|education',internship:'实习|internship',project:'项目|project',publication:'论文|出版|publication',language:'语言|外语|language',software:'软件|工具|software|tools',award:'荣誉|获奖|奖项|award|honou?r'} as Record<string,string>)[kind]??'(?!)','i');
function controlFact(field:Field,fact:ApplicationFact):ApplicationFact{
 if(!field.datePart)return field.type==='text'&&['languagesSummary','softwareSummary','awardsSummary'].includes(fact.kind)?{...fact,value:fact.value.replace(/\r?\n+/g,'；')}:fact;
 if(!['startDate','endDate'].includes(fact.kind)||!/^\d{4}-\d{2}(?:-\d{2})?$/.test(fact.value))throw Error('DATE_PRECISION_MISSING');
 return {...fact,kind:field.datePart+'Part',value:field.datePart==='year'?fact.value.slice(0,4):String(Number(fact.value.slice(5,7)))};
}
/** Fixed page program: the model never supplies selectors, scripts, or private values. */
const observeScript=READ_UNIVERSAL_FORM_FOR_HOST_VERIFICATION;
type GroupRegistry={nodes:WeakMap<Element,number>;next:number;anchors?:Map<string,{node:Element;scope:Element;id:number}>};
const readWithRegistry=new Function('registry','return '+observeScript.replace('/* host-group-registry */null','registry')) as (registry:GroupRegistry)=>View;
const actionSelector=UNIVERSAL_ACTION_SELECTOR;
const optionSelector='[role="option"],.phoenix-select__option,.ant-select-item-option,.el-select-dropdown__item';
export interface UniversalDraft {id:string;target:string;label:string;section:string;kind:'selection'|'text';relation?:'equivalent'|'category';sourceRefs:string[];reason:string;needsReview:true;retained:boolean;writtenThisRun?:boolean;value:string;question?:UniversalQuestion;}
export interface UniversalResult {performance?:{totalMs:number;modelWaitMs:number;pageReads:number;pageReadMs:number;controlLookups:number;controlLookupMs:number};status:'completed'|'partial'|'failed'|'cancelled';verified:number;pending:number;message:string;matchedConfirmed?:number;alreadyCorrect?:number;failureCode?:string;missingRecords?:number;modelRequests?:number;modelTokens?:number|null;draftWritten?:number;pendingReview?:number;drafts?:UniversalDraft[];remaining?:Array<{label:string;section:string;reason:string;reasonCode?:string;question?:UniversalQuestion}>;}

export class UniversalFormSession {
 readonly facts:ApplicationFact[];
 private view?:View;private epoch=0;private used=true;private closed=false;
 private registry?:JSHandle<GroupRegistry>;
 private bindings=new Map<string,string>();private attempted:Array<{field:Field;fact:ApplicationFact;value:string}>=[];
 private unverified=new Map<string,string>();
 private deferred=new Map<string,string>();
 private fieldFailures=new Map<string,number>();
 private lastFailures=new Map<string,string>();
 private pendingAddKinds=new Set<string>();
 private verifiedView?:View;private recordCacheView?:View;private recordCache=new Map<string,string|undefined>();private memoryIdentityCache=new WeakMap<Field,string|undefined>();
 private candidateCache=new WeakMap<Field,ApplicationFact[]>();
 private timings={pageReads:0,pageReadMs:0,controlLookups:0,controlLookupMs:0};
 private confirmedPassSkipped=new Set<string>();
 private pendingControl?:{field:Field;controller:OwnedSelectController;baseline:View};
 private selectedValues=new Map<string,string>();
 private semanticMappings=new Map<string,string>();
 private observedOptions=new Map<string,string[]>();
 private draftAttempts:Array<{field:Field;draft:UniversalDraft}>=[];
 private restoredDraftKeys=new Set<string>();
 private readonly profile:Profile;
 private readonly url:string;private readonly profileVersion:number;
 private generation:number;private preparationRecoveries=0;private addCounts=new Map<string,number>();private actions=0;
 constructor(private page:Page,profile:Profile,private getProfile:()=>Promise<Profile>,private getGeneration:()=>number,private signal:AbortSignal,private overwriteExisting=true,private answerContext:UniversalAnswerContext={answers:[]},private onFieldActivity?:(target:FieldCompanionTarget)=>unknown,private onProgress?:(message:string)=>void,private attemptMemory?:FormAttemptMemory,private setup?:import('../../shared/src/application-setup.js').ApplicationSetupState,pageTitle=''){
   if(attemptMemory)for(const kind of attemptMemory.unknownAddKinds)this.pendingAddKinds.add(kind);
   this.profile=profile;this.facts=applicationFacts(profile);appendApplicationSetupFacts(this.facts,setup,profile,page.url(),pageTitle);this.url=page.url();this.profileVersion=profile.version;this.generation=getGeneration();
   for(const answer of eligibleUniversalAnswers(answerContext,profile.version))this.facts.push({ref:'fact-'+this.facts.length,record:'answer-'+this.facts.length,kind:'answer',label:answer.questionPattern.replace(/^\[OfferFlash:[^\]]+\]\s*/,''),value:answer.answer,sourceRecordId:answer.id,sourceRevision:answer.revision});
 }
 private question(field:Field){const record=this.boundRecord(field);return universalQuestion(field,this.url,record,this.facts);}
 private decisionFor(field:Field){return universalQuestionDecision(this.answerContext,this.question(field),this.url,this.profileVersion);}
 private answerFor(field:Field){let question=this.question(field);if(!question)return;
   if(question.recordUnresolved){
     // Legacy single-row language answers remain usable only with a separately
     // confirmed identity answer and an empty or matching actual language row.
     // Two anonymous rows or a different language can never borrow these levels.
     if(!this.view||!familyExpression('language').test(field.section))return;
     const groups=[...new Set(this.view.fields.filter(item=>familyExpression('language').test(item.section)).map(item=>item.group))];if(groups.length!==1)return;
     const identities=this.view.fields.filter(item=>item.group===field.group&&/^(?:语言类型|语种|语言名称|language(?:\s*name)?)$/i.test(item.label));if(identities.length!==1)return;
     const identity=identities[0]!,identityQuestion=this.question(identity);if(!identityQuestion)return;
     const known=eligibleUniversalAnswers(this.answerContext,this.profileVersion).filter(answer=>answer.questionPattern===identityQuestion.key);if(known.length!==1||identity.value.trim()&&identity.value.trim()!==known[0]!.answer.trim())return;
     question={...question,recordUnresolved:undefined};
   }
   const answers=eligibleUniversalAnswers(this.answerContext,this.profileVersion).filter(a=>universalAnswerMatches(a,question!,field));
   const exactKeys=[question.key,...(question.legacyKeys??[])],exact=answers.filter(a=>exactKeys.includes(a.questionPattern)),applicable=exact.length?exact:answers;return applicable.length===1?applicable[0]:undefined;
 }
 private activity(field:Field,phase:FieldCompanionTarget['phase'],view?:View):void {
   if(!this.onFieldActivity||this.closed||this.signal.aborted||this.page.isClosed()||this.page.url()!==this.url||this.getGeneration()!==this.generation)return;
   const matches=view?.fields.filter(item=>this.key(item)===this.key(field));
   const bounds=matches?(matches.length===1?matches[0]!.bounds:undefined):field.bounds;
   if(!bounds||![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)||bounds.width<=0||bounds.height<=0)return;
   // Host observation supplies coordinates only. Optional visual callbacks are
   // never awaited, and cannot change a write result or receive personal values.
   try{void Promise.resolve(this.onFieldActivity({phase,bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}})).catch(()=>{});}catch{}
 }
 private async guard(){
   if(this.closed||this.signal.aborted||this.page.isClosed())throw Error('APPLICATION_CONTEXT_CHANGED:cancelled');
   if(this.page.url()!==this.url)throw Error('APPLICATION_CONTEXT_CHANGED:url');
   if(this.getGeneration()!==this.generation){
     // One same-URL preparation recovery, strictly before any action or write intent.
     const fresh=this.getGeneration();
     if(this.actions||this.attempted.length||this.unverified.size||this.preparationRecoveries)throw Error('APPLICATION_CONTEXT_CHANGED:document');
     await new Promise(resolve=>setTimeout(resolve,180));
     if(this.signal.aborted||this.page.url()!==this.url||this.getGeneration()!==fresh)throw Error('APPLICATION_CONTEXT_CHANGED:document');
     this.generation=fresh;this.preparationRecoveries++;void this.registry?.dispose().catch(()=>{});this.registry=undefined;
   }
   if((await this.getProfile()).version!==this.profileVersion)throw Error('APPLICATION_CONTEXT_CHANGED:profile');
   if(this.signal.aborted||this.page.url()!==this.url||this.getGeneration()!==this.generation)throw Error('APPLICATION_CONTEXT_CHANGED:document');
 }
 getPerformance(){return {...this.timings};}
 private reportProgress(message:string){try{this.onProgress?.(message);}catch{/* Display cannot change a write. */}}
 private async read():Promise<View>{const start=performance.now();try{return await this.readPage();}finally{this.timings.pageReads++;this.timings.pageReadMs+=performance.now()-start;}}
 private async readPage():Promise<View>{this.registry??=await this.page.evaluateHandle(()=>({nodes:new WeakMap<Element,number>(),next:0}));const view:View=await this.registry.evaluate(readWithRegistry);
   for(const group of new Set(view.fields.map(f=>f.group))){if(group==='contact')continue;const fields=view.fields.filter(f=>f.group===group),inferred=inferRecordSection(fields);
     for(const field of fields)if(!field.section&&inferred)field.section=inferred;}
   for(const field of view.fields){const selected=this.selectedValues.get(this.key(field));if(selected!==undefined&&!field.value&&field.controlValue===selected&&!field.expanded&&!field.popupVisible){field.value=selected;field.queryPending=false;}}
   if(this.attemptMemory&&this.setup){for(const field of view.fields){const proof=this.attemptMemory.guidanceChoices.get('applicationInterview|'+field.label);if(proof&&proof.policy===this.setup.value.interviewPreference&&field.value===proof.value&&view.fields.filter(other=>other.label===field.label).length===1){const fact=this.facts.find(fact=>fact.kind==='applicationInterview'&&factFitsField(fact,field));if(fact)fact.value=proof.value;}}}
   return view;
 }
 private memoryKey(field:Field):string|undefined{
   this.memoryIdentityCache??=new WeakMap();if(this.memoryIdentityCache.has(field))return this.memoryIdentityCache.get(field);
   const identity=field.identity.replace(/\|host-control-\d+$/,'');const record=this.boundRecord(field),source=this.facts.find(fact=>fact.record===record&&fact.sourceRecordId)?.sourceRecordId;
   if(!identity.split('|').slice(0,2).some(Boolean)&&!source)return;
   const key=JSON.stringify([field.label,field.section,field.type,identity,source??'']);
   const matches=this.view?.fields.filter(other=>other.label===field.label&&other.section===field.section&&other.type===field.type&&other.identity.replace(/\|host-control-\d+$/,'')===identity&&(this.boundRecord(other)??'')===(record??''));
   const resolved=matches?.length===1?formStateDigest(key):undefined;this.memoryIdentityCache.set(field,resolved);return resolved;
 }
 private memoryFingerprint(field:Field){return formStateDigest([this.profileVersion,field.value,field.controlValue,field.checked,field.invalid,field.options,this.boundRecord(field)]);}
 private priorFailure(field:Field){if(!this.attemptMemory?.hasEntries())return;return this.attemptMemory.get(this.memoryKey(field),this.memoryFingerprint(field))?.failure;}
 decisionFingerprint(){return formStateDigest([this.profileVersion,this.view?.fields.map(field=>({...field,bounds:undefined,identity:field.identity.replace(/\|host-control-\d+$/,'')})),this.answerContext.decisions]);}
 rememberAttempts(){if(!this.attemptMemory||!this.view)return;
   for(const field of this.view.fields){const failure=this.unverified.has(this.key(field))?'PRIOR_WRITE_UNVERIFIED':this.confirmedPassSkipped.has(this.key(field))?this.deferred.get(this.key(field))??this.lastFailures.get(this.key(field))??'CONTROL_FAILED':this.deferred.get(this.key(field))??this.priorFailure(field);
     const options=this.observedOptions.get(this.key(field));if(failure||options?.length)this.attemptMemory.put(this.memoryKey(field),this.memoryFingerprint(field),{failure,options});}
   for(const kind of this.pendingAddKinds)this.attemptMemory.unknownAddKinds.add(kind);
 }
 private key(field:Field){return field.group+'|'+field.identity+'|'+field.label;}
 private bindRecord(group:string,record:string){this.bindings.set(group,record);this.candidateCache=new WeakMap();this.memoryIdentityCache=new WeakMap();}
 private candidates(field:Field){
   if(!applicationField(field))return [];
   if(!supportedWrite(field))return [];
   if(this.deferred.has(this.key(field)))return [];
   if(this.unverified.has(this.key(field)))return [];
   this.candidateCache??=new WeakMap();const cached=this.candidateCache.get(field);if(cached)return cached;
   const resolved=this.findCandidates(field);this.candidateCache.set(field,resolved);return resolved;
 }
 private findCandidates(field:Field){
   const matches=this.facts.filter(fact=>{try{return !!this.resolve(fact.ref,field);}catch{return false;}});
   // An exact, current, user-confirmed answer is specific to this site's
   // question and record. It takes precedence over a broader profile fact
   // (e.g. this site's "overseas" category vs the profile's full-time mode).
   const answer=this.answerFor(field);if(answer){const explicit=matches.filter(fact=>fact.kind==='answer'&&fact.sourceRecordId===answer.id);if(explicit.length===1)return explicit;}
   return matches.some(fact=>fact.kind==='softwareSummary')?matches.filter(fact=>fact.kind!=='skills'):matches;
 }
 private capabilities(field:Field){if(!applicationField(field))return [];const actions=['scroll','verify'];if(this.decisionFor(field)||this.priorFailure(field))return actions;if(!field.editable||this.unverified.has(this.key(field)))return actions;
   if(this.deferred.has(this.key(field)))return actions;
   if(this.calendarField(field)){if(this.candidates(field).length&&this.needsWrite(field))actions.push('fill');return actions;}
   if(field.ownedSelect)actions.push('open','read-options','close','scroll-options');
   if(this.candidates(field).length&&this.needsWrite(field)){actions.push('fill');if(field.ownedSelect)actions.push('query','choose','create');}
   if((field.ownedSelect||field.type==='select')&&this.needsWrite(field)&&this.facts.some(fact=>this.selectionSourceAllowed(field,fact)))actions.push('select_application_option');
   return actions;
 }
 private calendarField(field:Field){return !!field.ownedSelect&&!field.datePart&&this.facts.some(fact=>['startDate','endDate','birthDate','publicationDate'].includes(fact.kind)&&factFitsField(fact,field));}
 private noteFieldFailure(field:Field,reason:string){this.lastFailures.set(this.key(field),reason);const key=this.key(field)+'|'+reason,count=(this.fieldFailures.get(key)??0)+1;this.fieldFailures.set(key,count);if(count>=2)this.deferred.set(this.key(field),reason);}
 private redundantEmptyRecord(field:Field){
   if(field.group==='contact'||!this.view||this.boundRecord(field))return false;
   const kind=['education','internship','project','publication'].find(kind=>familyExpression(kind).test(field.section));if(!kind)return false;
   if(this.view.fields.some(other=>other.group===field.group&&!['checkbox','radio'].includes(other.type)&&other.value.trim()))return false;
   const records=this.coverage().filter(record=>record.kind===kind);return records.length>0&&records.every(record=>record.state==='matched'&&record.group!==field.group);
 }
 private manualReason(field:Field){
   if(/推荐码|内推码|邀请码|referral.*code|invitation.*code/i.test(field.label))return '未提供推荐码，按要求留空，不填“无”；这不代表个人资料缺失。';
   if(/^(?:上述)?已知悉并确认$/.test(field.label))return '请在提交前自行阅读并确认网站声明；自动填写不勾选，也不要求把声明存入个人资料。';
   if(this.redundantEmptyRecord(field))return '网页多出一段空白经历，已确认经历均已对应；程序不重复填入，也不自动删除，请核对这段空行。';
   if(field.datePrecision==='day'&&this.facts.some(fact=>factFitsField(fact,field)&&/^\d{4}-\d{2}$/.test(fact.value))||['DATE_PRECISION_MISSING','CALENDAR_PRECISION_UNSUPPORTED'].includes(this.lastFailures?.get(this.key(field))??this.priorFailure(field)??''))return '已保存的日期只有月份，而网站要求具体年月日。已保留原月份，不编日期，也不重复操作这个日历；知道具体日期后可在填写设置补充。';
   if(this.priorFailure(field))return '此项与上次失败时相同，已停止自动重试；可修改网页后继续，或明确重试未完成控件。';
   const decision=this.decisionFor(field);if(decision)return decision.disposition==='none'?'你已标记无 / 不适用，不再追问；网站若要求填写请核对其选项。':'此申请已跳过，不再追问；可在已处理问题中恢复。';
   if(['checkbox','radio'].includes(field.type)&&!field.label.trim())return '这个勾选项没有可核实的字段名称，请在网页人工核对；不会自动勾选，也不需要补写个人资料。';
   if(this.deferred.has(this.key(field)))return '这个控件连续两次未能执行，已暂缓并继续其它字段；请核对控件，不需要重复补写已有资料。';
   const record=this.boundRecord(field);
   if(!field.label.trim())return '未能识别这个控件的字段名称，需要检查网页结构；不代表个人资料缺失。';
   const compatible=this.facts.filter(fact=>factFitsField(fact,field)&&(!record||fact.record===record));
   if(!compatible.length&&!this.answerFor(field))return '个人资料里没有这项已确认信息，请补充后再试；不会猜填。';
   if(this.unverified.has(field.group+'|'+field.identity+'|'+field.label))return '已有确认资料，但网页未保留或未真正选中；请核对这个控件，搜索词不算填写成功。';
   if(field.readOnlyWidget&&!field.ownedSelect)return '该自定义选择器暂未具备可核实的操作方式，请手动选择；不会把搜索框当填写值。';
   if(!this.candidates(field).length)return '无法唯一对应到一段履历，可能有重复经历或名称不一致，请先核对这段经历。';
   return '已有确认资料，但本次尚未核实写入；可能需要手动处理该控件。';
 }
 private matches(field:Field,fact:ApplicationFact){if(fact.kind==='applicationSource'&&this.setup?.value.recruitmentSourceFallback&&optionMatchesFact(field.value,this.setup.value.recruitmentSourceFallback))return true;
   if(fact.kind==='description'&&field.type==='textarea'&&field.value.endsWith(fact.value)){
     const prefix=field.value.slice(0,-fact.value.length).trim(),record=this.facts.filter(other=>other.record===fact.record);
     const name=record.find(other=>other.kind==='name')?.value,organization=record.find(other=>other.kind==='organization')?.value,role=record.find(other=>other.kind==='role')?.value;
     if(prefix&&(prefix===name||prefix===[organization,role].filter(Boolean).join('｜')))return true;
   }
if(field.type==='checkbox')return field.checked===(fact.value==='至今');if(field.datePart){try{return ownedOptionMatches(controlFact(field,fact),field.value);}catch{return false;}}return field.type==='select'?field.options.some(o=>o.value===field.value&&optionMatchesFact(o.label,fact.value)):displayedFactMatches(controlFact(field,fact),field.value);}
 private majorFallback(fact:ApplicationFact){return fact.kind==='major'?this.setup?.value.educations.find(policy=>policy.recordId===fact.sourceRecordId&&policy.sourceRevision===fact.sourceRevision&&policy.major===fact.value)?.fallbackMajor:undefined;}
 private noAwards(field:Field){return this.setup?.confirmedAt&&this.setup.value.awards==='none'&&/所获荣誉|获奖|奖项|awards?|honou?r/i.test(field.section)&&!field.value.trim();}
 private retainedDraft(field:Field){return this.draftAttempts.some(attempt=>this.key(attempt.field)===this.key(field)&&field.value===attempt.draft.value&&!field.invalid&&!field.queryPending&&!field.expanded&&!field.popupVisible);}
 private needsWrite(field:Field,includeSuppressed=false){
   if(this.noAwards(field)&&(!includeSuppressed||(field as any).required!==true))return false;
   if(!includeSuppressed&&(this.decisionFor(field)||this.priorFailure(field)))return false;
   if(this.retainedDraft(field))return false;
   if(field.type!=='checkbox'&&/结束|终止|end|until/i.test(field.label)){
     const record=this.boundRecord(field),present=this.facts.find(fact=>fact.record===record&&fact.kind==='endDate'&&fact.value==='至今');
     if(present&&this.view?.fields.some(item=>item.group===field.group&&item.type==='checkbox'&&item.checked===true&&factFitsField(present,item)))return false;
   }
   const candidates=this.candidates(field);if(field.type==='checkbox'&&candidates.length)return !(!this.overwriteExisting&&field.checked===true)&&!candidates.some(fact=>this.matches(field,fact));return !field.value.trim()||this.overwriteExisting&&candidates.length>0&&!candidates.some(fact=>this.matches(field,fact));
 }
 private boundRecord(field:Field){const binding=this.bindings.get(field.group);if(binding)return binding;if(!this.view)return;this.recordCache??=new Map();if(this.recordCacheView!==this.view){this.recordCache.clear();this.recordCacheView=this.view;}if(!this.recordCache.has(field.group))this.recordCache.set(field.group,matchExistingRecord(this.view.fields.filter(other=>other.group===field.group),this.facts));return this.recordCache.get(field.group);}
 private scopedRecord(fact:ApplicationFact,field:Field){return careerFact(fact)&&field.group!=='contact'&&familyExpression(recordFamily(fact.record)!).test(field.section);}
 private ordinaryTarget(field:Field){return !this.priorFailure(field)&&!this.decisionFor(field)&&applicationField(field)&&field.editable&&!this.deferred.has(this.key(field))&&!this.unverified.has(this.key(field))&&supportedWrite(field)&&!protectedApplicationField(field)&&!unsafe.test(field.label+' '+field.section)&&['text','textarea','select','combobox','url'].includes(field.type)&&!/推荐码|内推码|邀请码|员工编号|邮编|referral.*code|invitation.*code|employee.*(?:number|id)|postal.*code|zip.*code|出生|性别|生日|国籍|户籍|婚姻|民族|政治|残疾|身份证|护照|税|薪资|薪酬|签证|\b(?:birth|gender|nationality|ethnicity|marital|disability|tax|salary|visa)\b/i.test(field.label);}
 deferTarget(target:string|undefined,reason:string){const field=this.view?.fields.find(field=>'field-'+field.index===target);if(field)this.deferred.set(this.key(field),reason);}
 private sourceScopeIssue(field:Field,facts:ApplicationFact[]){
   const records=[...new Set(facts.filter(careerFact).map(fact=>fact.record))];
   if(['education','internship','project','publication'].some(kind=>familyExpression(kind).test(field.section))&&facts.some(fact=>!careerFact(fact)))return 'RECORD_BINDING_CONFLICT';
   const bound=this.boundRecord(field);
   if(field.group==='contact'&&records.some(record=>familyExpression(recordFamily(record)!).test(field.section)))return 'RECORD_BINDING_CONFLICT';
   if(records.length>1&&field.group!=='contact'&&familyExpression(recordFamily(records[0]!)!).test(field.section))return 'RECORD_BINDING_CONFLICT';
   for(const fact of facts.filter(careerFact)){
     const kind=recordFamily(fact.record)!;
     if(familyExpression(kind).test(field.section)&&field.group!=='contact'){
       if(bound&&bound!==fact.record||[...this.bindings].some(([group,record])=>group!==field.group&&record===fact.record))return 'RECORD_BINDING_CONFLICT';
       const current=this.view!.fields.filter(f=>f.group===field.group);
       if(!bound&&current.some(f=>f.value.trim()&&!['checkbox','radio'].includes(f.type))&&matchExistingRecord(current,this.facts)!==fact.record)return 'EXISTING_RECORD_AMBIGUOUS';
     }else if(['education','internship','project','publication','language','software','award'].some(other=>other!==kind&&familyExpression(other).test(field.section)))return 'RECORD_BINDING_CONFLICT';
   }
 }
 private semanticMappingIssue(field:Field,fact:ApplicationFact|undefined):string|undefined{
   // Mapping can interpret a novel professional caption, but cannot turn a
   // school/major/description into a missing score, language ability or answer.
   if(/城市|地点|意向|居住|city|location|preference/i.test(field.label)&&(!fact||fact.kind!=='answer'||this.answerFor(field)?.id!==fact.sourceRecordId))return 'EXPLICIT_PREFERENCE_REQUIRED';
   const scalar=/\b(?:c?gpa|grades?|scores?|rank(?:ing)?|listening|speaking|reading|writing|certificat(?:e|ion))\b|成绩|分数|绩点|学分|排名|听说|读写|证书|考试/i;
   if(fact?.kind==='answer'&&this.answerFor(field)?.id!==fact.sourceRecordId)return 'SCOPED_ANSWER_REQUIRED';
   if(fact&&(field.ownedSelect||field.type==='select')&&!careerFact(fact)&&fact.kind!=='answer'&&!factFitsField(fact,field))return 'EXPLICIT_CAPABILITY_FACT_REQUIRED';
   if(/爱好|兴趣|hobb(?:y|ies)|interests?/i.test(field.label)&&!this.answerFor(field))return 'SEMANTIC_MAPPING_NOT_ALLOWED';
   if(!this.ordinaryTarget(field)||!fact||!professionalFact(fact)||field.type==='url'&&fact.kind!=='url'||scalar.test(field.label)&&!factFitsField(fact,field)||/类别|大类|门类|category|family/i.test(field.label)&&!['majorCategory','schoolCategory'].includes(fact.kind)||/所获荣誉|荣誉名称|奖项|奖学金|awards?|honou?r/i.test(field.label)&&!['awardName','awardsSummary'].includes(fact.kind))return 'SEMANTIC_MAPPING_NOT_ALLOWED';
   if(this.facts.some(other=>factFitsField(other,field))&&!factFitsField(fact,field))return 'FACT_FIELD_MISMATCH';
   const explicitCapability=/语言类型|语种|掌握程度|熟练程度|语言水平|听说|读写|\b(?:language|proficiency|fluency|listening|speaking|reading|writing)\b/i.test(field.label);
   if(explicitCapability&&!factFitsField(fact,field))return 'EXPLICIT_CAPABILITY_FACT_REQUIRED';
   if(!careerFact(fact)&&['education','internship','project','publication','language','software','award'].some(kind=>familyExpression(kind).test(field.section))&&!factFitsField(fact,field))return 'RECORD_BINDING_CONFLICT';
   if(/国家级|national/i.test(field.label)&&/荣誉|奖|award|honou?r/i.test(field.label)&&!(fact.kind==='awardName'&&/国家级|national/i.test(fact.value)&&!/不是|非国家|非国|not\s+(?:a\s+)?national/i.test(fact.value)))return 'AWARD_SCOPE_MISMATCH';
   const flatAdditional=['softwareName','awardName'].includes(fact.kind)&&!/教育|实习|项目|语言|education|internship|project|language/i.test(field.section)&&(/软件|工具|software|tools/i.test(field.label)&&fact.kind==='softwareName'||/荣誉|获奖|奖项|recognition|award|honou?r/i.test(field.label)&&fact.kind==='awardName');
   if(careerFact(fact)&&!flatAdditional&&(!familyExpression(recordFamily(fact.record)!).test(field.section)||field.group==='contact'))return 'RECORD_BINDING_CONFLICT';
   return this.sourceScopeIssue(field,[fact]);
 }
 async inspect(){await this.guard();this.view=await this.read();await this.guard();return this.projectObservation();}
 private async projectObservation(){if(!this.view)throw Error('OBSERVE_FIRST');
   for(const field of this.attemptMemory?.hasEntries()?this.view.fields:[]){const options=this.attemptMemory?.get(this.memoryKey(field),this.memoryFingerprint(field))?.options;if(options&&!this.observedOptions.has(this.key(field)))this.observedOptions.set(this.key(field),options);}
   this.epoch++;this.used=false;
   const fields=this.view!.fields.filter(f=>!unsafe.test(f.label+' '+f.section)).map(f=>({ref:'field-'+f.index,label:f.label,type:f.type,section:f.section,group:f.group,hasValue:!!f.value,required:(f as any).required,editable:f.editable,purpose:f.purpose??'application',
     replaceExisting:!!f.value.trim()&&this.overwriteExisting,controlMode:f.ownedSelect?'confirmed-option':undefined,candidates:this.needsWrite(f)?this.candidates(f).map(fact=>fact.ref):[],options:f.options?.map(o=>o.label),observedOptions:f.type==='select'?f.options.map((option,index)=>({ref:'native-option-'+index,label:option.label})):this.observedOptions.get(this.key(f))?.map(label=>({label})),boundRecord:this.boundRecord(f),
     canMap:this.needsWrite(f)&&!this.candidates(f).length&&this.facts.some(fact=>!this.semanticMappingIssue(f,fact)),state:this.unverified.has(this.key(f))?'unverified':f.queryPending?'query-only':f.value||f.checked?'committed':'empty',canDraft:this.canDraftField(f),allowedActions:this.capabilities(f)}));
   const actionable=fields.filter(f=>f.editable&&f.candidates.length>0);
   const actions=this.view!.actions.filter(a=>!unsafe.test(a.label)&&this.additionAllowed(a)).map(a=>({label:a.label,section:a.section,group:a.group,recordKind:this.actionFamily(a),ref:'add-'+a.index,availableRecords:this.unboundRecords(this.actionFamily(a))}));
   const control=this.pendingControl?await this.pendingControl.controller.read():undefined;
   if(control&&this.pendingControl)this.observedOptions.set(this.key(this.pendingControl.field),control.options.map(o=>o.label));
   const canMap=this.view!.fields.some(f=>this.needsWrite(f)&&!this.candidates(f).length&&this.facts.some(fact=>!this.semanticMappingIssue(f,fact)));
   const sections=(this.view.sections??[]).filter(section=>!unsafe.test(section.label));
   const canExpand=sections.some(section=>section.state==='collapsed');
   const canSelect=this.view.fields.some(field=>(field.type==='select'?field.options.length:(this.observedOptions.get(this.key(field))?.length??0))>0&&this.needsWrite(field)&&this.ordinaryTarget(field)&&(field.ownedSelect||field.type==='select')&&this.facts.some(fact=>this.selectionSourceAllowed(field,fact)));
   const canDraft=this.view.fields.some(field=>this.canDraftField(field));
   return {observation:'observation-'+this.epoch,fields:actionable,page:{fields,scope:'all-observed-ordinary-fields',privateValuesOmitted:true},canContinue:actionable.length>0||actions.length>0,canMap,canExpand,canSelect,canDraft,sections,
     overwriteExisting:this.overwriteExisting,preservedCount:fields.filter(f=>f.hasValue&&!f.candidates.length).length,
     manualFields:this.view!.fields.filter(f=>applicationField(f)&&!unsafe.test(f.label+' '+f.section)&&this.needsWrite(f)&&!f.value.trim()&&!this.candidates(f).length).map(f=>({label:f.label,section:f.section,reason:this.manualReason(f)})),
     actions,options:control?.options??[],activeControl:this.pendingControl?{target:'field-'+this.pendingControl.field.index,open:control?.open,truncated:control?.truncated,canCreate:control?.canCreate}:undefined,
     coverage:this.coverage(),
     records:[...new Set(this.relevantFacts().map(f=>f.record))].map(record=>({record,facts:this.facts.filter(f=>f.record===record).map(f=>({ref:f.ref,label:f.label}))})),
     verified:this.attempted.length,draftWritten:this.draftAttempts.length,requiresFreshObservationAfterAction:true};
 }
 private actionFamily(action:AddAction){const label=action.label;return action.recordKind??(/教育|education/i.test(label)?'education':/实习|internship/i.test(label)?'internship':/工作经历|work.experience|employment/i.test(label)?'employment':/项目|project/i.test(label)?'project':/语言|language/i.test(label)?'language':/软件|工具|software|tools/i.test(label)?'software':/荣誉|奖项|awards?|honou?r/i.test(label)?'award':'');}
 private unboundRecords(type:string){if(!this.view)return [];const assigned=new Set([...this.bindings.values(),...[...new Set(this.view.fields.map(field=>field.group))].map(group=>matchExistingRecord(this.view!.fields.filter(field=>field.group===group),this.facts)).filter((record):record is string=>!!record)]);return [...new Set(this.facts.filter(fact=>recordFamily(fact.record)===type).map(fact=>fact.record))].filter(record=>!assigned.has(record));}
 private additionAllowed(action:AddAction){
   const type=this.actionFamily(action);
   if(!type||!this.view||this.pendingAddKinds.has(type))return false;
   const records=new Set(this.facts.filter(f=>f.record.startsWith(type+'-')).map(f=>f.record));
   const expression=familyExpression(type);
   const relevant=this.view.fields.filter(f=>expression.test(f.section)),groups=new Set(relevant.map(f=>f.group));
   // An unrecognised or unassigned existing row must be reconciled first.
   // Losing its group must never be interpreted as permission to add another.
   if(relevant.some(field=>field.group==='contact'||!this.boundRecord(field)))return false;
   return !!records.size&&groups.size<records.size&&this.unboundRecords(type).length>0&&(this.addCounts.get(type)??0)<records.size;
 }
 private coverage(){
   if(!this.view)return [];
   const exposed=new Set(this.view.actions.map(action=>this.actionFamily(action)));
   for(const section of this.view.sections??[])if(section.recordKind)exposed.add(section.recordKind);
   return recordCoverage(this.facts,this.view.fields,exposed,this.bindings,this.pendingAddKinds);
 }
 /** Deterministic source-record traversal. The model interprets unknown captions
  * and choices afterwards; it never decides which confirmed experiences to omit. */
 async completeConfirmedRecords(){
   const events:Array<{operation:string;record?:string;reason?:string;verified?:number;failures?:unknown[]}>=[];
   const expanded=new Set<string>(),visited=new Set<string>();
   // Bounded by the existing 60-action session budget, not a new retry budget.
   for(let step=0;step<60&&!this.signal.aborted;step++){
     let observation=await this.inspect();
     const coverage=this.coverage();
     const collapsed=observation.sections.find(section=>section.state==='collapsed'&&!expanded.has(section.identity)&&(!section.recordKind||coverage.some(item=>item.kind===section.recordKind&&item.state!=='matched')));
     if(collapsed){expanded.add(collapsed.identity);try{await this.expandSection({observation:observation.observation,section:collapsed.ref});events.push({operation:'expand'});}catch(error){const reason=universalErrorCode(error);if(reason.startsWith('APPLICATION_CONTEXT_CHANGED')||reason==='ACTION_BUDGET')throw error;events.push({operation:'expand',reason});}continue;}
     // Match existing or entirely empty rows. A nonempty anonymous row is
     // never assigned by its position, even if only one source remains.
     for(const item of coverage)if(item.state==='matched'&&item.group)this.bindRecord(item.group,item.record);
     for(const item of coverage){
       if(item.state==='empty'&&![...this.bindings.values()].includes(item.record)){
         const group=item.groups.find(group=>!this.bindings.has(group));
         if(group&&!this.pendingAddKinds.has(item.kind))this.bindRecord(group,item.record);
       }
     }
     observation=await this.projectObservation();
     const result=await this.fillConfirmed(observation.observation);
     events.push({operation:'fill-confirmed',verified:result.verified,failures:result.failures});
     if(result.verified)continue;
     observation=await this.inspect();
     const missing=this.coverage().find(item=>item.state==='missing'&&!visited.has(item.record));
     if(!missing)break;
     visited.add(missing.record);
     const actions=observation.actions.filter(action=>action.recordKind===missing.kind);
     if(actions.length!==1){events.push({operation:'ensure-record',record:missing.record,reason:actions.length?'AMBIGUOUS_ADD':'NO_ADDITIONAL_CONFIRMED_RECORD'});continue;}
     try{await this.ensureRecord({observation:observation.observation,target:actions[0]!.ref,record:missing.record});events.push({operation:'ensure-record',record:missing.record});}
     catch(error){const reason=universalErrorCode(error);if(reason.startsWith('APPLICATION_CONTEXT_CHANGED')||reason==='ACTION_BUDGET')throw error;events.push({operation:'ensure-record',record:missing.record,reason});}
   }
   return {events,coverage:(await this.inspect()).coverage,needsObservation:true};
 }
 async closePreexistingControls(){
   await this.inspect();const open=this.view!.fields.filter(field=>field.ownedSelect&&(field.expanded||field.popupVisible));
   if(!open.length)return {closed:0};
   if(open.length!==1)throw Error('PREEXISTING_POPUP_REQUIRES_REVIEW');
   const field=open[0]!,baseline=this.view!,controller=await createOwnedSelectController(await this.control(field),()=>this.guard(),{label:field.label});
   try{await controller.open();if(!(await controller.close()).closed)throw Error('PREEXISTING_POPUP_REQUIRES_REVIEW');}finally{await controller.dispose();}
   const after=await this.read();await this.guard();
   for(const original of baseline.fields){const actual=after.fields.filter(candidate=>this.key(candidate)===this.key(original));if(actual.length!==1||actual[0]!.value!==original.value||actual[0]!.checked!==original.checked)throw Error('PAGE_CHANGED_REOBSERVE');}
   if(after.fields.some(field=>field.expanded||field.popupVisible))throw Error('PREEXISTING_POPUP_REQUIRES_REVIEW');
   this.view=after;return {closed:1};
 }
 async fillGroup(observation:string,mappings:Array<{target:string;fact:string}>){
   if(!mappings.length||mappings.length>12||new Set(mappings.map(m=>m.target)).size!==mappings.length)throw Error('INVALID_GROUP_MAPPING');
   if(observation!=='observation-'+this.epoch||this.used)throw Error('FRESH_OBSERVATION_REQUIRED');
   const failures:Array<{label:string;reason:string;controlDiagnostic?:unknown}>=[],items:Array<{mapping:{target:string;fact:string};field:Field;record:string}>=[];
   for(const mapping of mappings){try{const field=this.field(mapping.target),fact=this.resolve(mapping.fact,field);
     if(field.value.trim()&&!this.overwriteExisting||!field.ownedSelect&&!['text','email','tel','textarea','select','month','date','checkbox'].includes(field.type))throw Error('USE_INDIVIDUAL_CONTROL_ACTION');
     items.push({mapping,field,record:this.scopedRecord(fact,field)?fact.record:'contact'});
   }catch(error){failures.push({label:this.view?.fields.find(f=>'field-'+f.index===mapping.target)?.label??'未知字段',reason:universalErrorCode(error)});}}
   const structured=(record:string)=>!!recordFamily(record);
   const conflicts=new Set(items.filter(i=>structured(i.record)&&new Set(items.filter(other=>other.field.group===i.field.group&&structured(other.record)).map(other=>other.record)).size>1).map(i=>i.field.group));
   // Establish the record from its identity field before dates can make an
   // otherwise blank group look like an ambiguous pre-existing experience.
   const identityFirst=(item:typeof items[number])=>['school','organization','name','language','softwareName','awardName'].includes(this.facts.find(f=>f.ref===item.mapping.fact)?.kind??'')?0:1;
   items.sort((a,b)=>(a.field.type==='checkbox'?0:1)-(b.field.type==='checkbox'?0:1)||identityFirst(a)-identityFirst(b));
   let done=0;
   for(const item of items){
     if(conflicts.has(item.field.group)){failures.push({label:item.field.label,reason:'RECORD_MAPPING_CONFLICT'});continue;}
     const current=this.view!.fields.filter(f=>f.identity===item.field.identity&&f.label===item.field.label&&f.group===item.field.group);
     if(current.length!==1){failures.push({label:item.field.label,reason:'FIELD_IDENTITY_CHANGED'});continue;}
     this.reportProgress('正在处理 '+item.field.label+' · 本轮已处理 '+this.attempted.length+' 项');
     try{const result=await this.act({observation:'observation-'+this.epoch,action:'fill',target:'field-'+current[0]!.index,fact:item.mapping.fact});if(result.verified===true)done++;}
     catch(error){const reason=universalErrorCode(error);this.confirmedPassSkipped.add(this.key(item.field));const controlDiagnostic=error instanceof Error?(error as Error&{controlDiagnostic?:unknown}).controlDiagnostic:undefined;failures.push({label:item.field.label,reason,...(controlDiagnostic?{controlDiagnostic}:{})});}
     if(this.verifiedView){this.view=this.verifiedView;this.verifiedView=undefined;await this.projectObservation();}else await this.inspect();
   }
   return{verified:done,failures,needsObservation:true};
 }
 async fillConfirmed(observation:string){
   if(!this.view||observation!=='observation-'+this.epoch||this.used)throw Error('FRESH_OBSERVATION_REQUIRED');
   const mappings=this.view.fields.flatMap(field=>{
     if(!field.editable||this.confirmedPassSkipped.has(this.key(field))||!this.needsWrite(field))return [];
     const facts=this.candidates(field);if(facts.length!==1)return [];
     if(field.type==='select'&&field.options.filter(option=>optionMatchesFact(option.label,facts[0]!.value)).length!==1&&!this.majorFallback(facts[0]!))return [];
     return[{target:'field-'+field.index,fact:facts[0]!.ref}];
   }).slice(0,12);
   if(!mappings.length)return{verified:0,failures:[],needsObservation:true};
   return this.fillGroup(observation,mappings);
 }
 private async fresh(observation:string,action:string){await this.guard();if(!this.view||this.used||observation!=='observation-'+this.epoch)throw Error('FRESH_OBSERVATION_REQUIRED');
   const fresh:View=await this.read();await this.guard();
   if(fresh.url!==this.view.url||JSON.stringify(semanticFields(fresh.fields))!==JSON.stringify(semanticFields(this.view.fields))||action==='add'&&JSON.stringify(fresh.actions)!==JSON.stringify(this.view.actions)||action==='expand'&&JSON.stringify(fresh.sections)!==JSON.stringify(this.view.sections)||action==='choose'&&JSON.stringify(fresh.options)!==JSON.stringify(this.view.options))throw Error('PAGE_CHANGED_REOBSERVE');this.used=true;
   if(++this.actions>60)throw Error('ACTION_BUDGET');return fresh;
 }
 private field(ref:string){const f=this.view?.fields.find(f=>'field-'+f.index===ref);if(!f)throw Error('UNKNOWN_FIELD');if(!applicationField(f)||unsafe.test(f.label+' '+f.section))throw Error('PROTECTED_FIELD');return f;}
 private async control(field:Field){
   // DOM index is host-generated. One Chromium query preserves exactly the
   // reader's ordered composite filtering, including hidden index positions.
   const start=performance.now();this.timings.controlLookups++;try{const node=this.page.locator('css:light='+UNIVERSAL_BOUND_CONTROL_SELECTOR).nth(field.index);
   if(await node.count()!==1)throw Error('FIELD_DISAPPEARED');return node;}finally{this.timings.controlLookupMs+=performance.now()-start;}
 }
 /** Model interpretation can map a novel ordinary caption to an existing
  * confirmed professional fact. It cannot create values or override a known
  * contradictory field kind, dates, contact identity, sensitive questions or
  * the record boundary. The mapping itself never writes the page. */
 async mapField(input:{observation:string;target:string;fact:string}){
   await this.fresh(input.observation,'map');const field=this.field(input.target),fact=this.facts.find(f=>f.ref===input.fact);
   const issue=this.semanticMappingIssue(field,fact);if(issue)throw Error(issue);
   this.semanticMappings.set(this.key(field),fact!.ref);this.candidateCache=new WeakMap();return{mapped:true,needsObservation:true};
 }
 private relevantFacts(){if(!this.view)return this.facts;const extra=this.view.fields.some(field=>/自我评价|自我介绍|个人简介|熟用软件|熟悉软件|专业技能|technical.skills|self.assessment|self.evaluation|personal.statement|about.me/i.test(field.label))||(this.view.sections??[]).some(section=>section.state==='collapsed'&&/附加|补充|其它|其他|additional|supplementary|other/i.test(section.label));return this.facts.filter(fact=>!careerFact(fact)||extra||this.view!.fields.some(field=>familyExpression(recordFamily(fact.record)!).test(field.section))||this.view!.actions.some(action=>this.actionFamily(action)===recordFamily(fact.record))||(this.view!.sections??[]).some(section=>section.recordKind===recordFamily(fact.record)));}
 async getProfileFacts(refs?:string[]){await this.guard();if(refs&&(refs.length>100||refs.some(ref=>!this.facts.some(fact=>fact.ref===ref))))throw Error('UNKNOWN_FACT');this.view=await this.read();await this.guard();return profileFactView(this.profile,refs?this.facts:this.relevantFacts(),refs);}
 private sourceFacts(refs:string[]){if(!refs.length||refs.length>16||new Set(refs).size!==refs.length)throw Error('CONFIRMED_FACT_REQUIRED');return refs.map(ref=>{const fact=this.facts.find(item=>item.ref===ref);if(!fact||!professionalFact(fact))throw Error('PROFESSIONAL_FACT_REQUIRED');return fact;});}
 private selectionSourceAllowed(field:Field,fact:ApplicationFact){if(this.calendarField(field)||field.datePart||/学校名称|院校|公司名称|单位名称|项目名称|university|institution|school|company.name|project.name/i.test(field.label))return false;return professionalFact(fact)&&!this.sourceScopeIssue(field,[fact])&&(factFitsField(fact,field)||!this.semanticMappingIssue(field,fact)||/专业.*类|主修类别|学科|major.*categor|subject.*(?:categor|family)|academic.*categor|discipline/i.test(field.label)&&fact.kind==='major'&&recordFamily(fact.record)==='education'&&familyExpression('education').test(field.section));}
 private draftTargetAllowed(field:Field){return this.ordinaryTarget(field)&&['text','textarea'].includes(field.type)&&!field.ownedSelect&&!field.readOnlyWidget&&!/\b(?:c?gpa|grades?|scores?|rank(?:ing)?|level|proficiency|fluency|certificate|certification|birth|date|name|awards?|honou?rs?|hobb(?:y|ies)|interests?)\b|成绩|分数|绩点|学分|排名|听说|读写|语种|语言类型|程度|水平|级别|证书|证件|日期|时间|年月|开始|结束|姓名|学校名称|专业名称|公司名称|职位名称|项目职责|项目角色|实习职位|角色|职务|语种|语言类型|荣誉|奖项|奖励|奖学金|爱好|兴趣/i.test(field.label);}
 private canDraftField(field:Field){return this.needsWrite(field)&&this.draftTargetAllowed(field)&&this.facts.some(fact=>professionalFact(fact)&&!this.sourceScopeIssue(field,[fact]));}
 async restoreDrafts(drafts:UniversalDraft[]){
   await this.inspect();
   for(const draft of drafts){
     if(!draft.question?.key||!draft.retained)continue;
     const facts=this.facts.filter(fact=>draft.sourceRefs.includes(fact.ref));if(facts.length!==draft.sourceRefs.length||facts.some(fact=>!professionalFact(fact)))continue;
     const matches=this.view!.fields.filter(field=>this.question(field)?.key===draft.question!.key&&field.value===draft.value&&!field.invalid&&!field.queryPending&&!field.expanded&&!field.popupVisible);
     if(matches.length!==1||this.sourceScopeIssue(matches[0]!,facts))continue;
     this.recordDraft(matches[0]!,matches[0]!,{kind:draft.kind,relation:draft.relation,facts:draft.sourceRefs,reason:draft.reason});
     this.restoredDraftKeys.add(this.key(matches[0]!));
   }
 }
 private async unchangedExcept(baseline:View,target:Field){const current=await this.read();await this.guard();for(const original of baseline.fields){if(this.key(original)===this.key(target))continue;const actual=current.fields.filter(field=>this.key(field)===this.key(original));if(actual.length!==1||actual[0]!.value!==original.value||actual[0]!.checked!==original.checked)throw Error('PAGE_CHANGED_REOBSERVE');}}
 private recordDraft(original:Field,actual:Field,input:{kind:'selection'|'text';relation?:'equivalent'|'category';facts:string[];reason:string}){
   this.restoredDraftKeys.delete(this.key(original));
   const relation=input.kind==='selection'&&/专业.*(?:类|类型)|major.*(?:type|categor)/i.test(actual.label)&&this.facts.some(fact=>input.facts.includes(fact.ref)&&fact.kind==='major')?'category':input.relation;
   const draft:UniversalDraft={id:'draft-'+(this.draftAttempts.length+1),target:'field-'+actual.index,label:actual.label,section:actual.section,kind:input.kind,...(relation?{relation}:{}),sourceRefs:input.facts,reason:input.reason.slice(0,400),needsReview:true,retained:true,value:actual.value,question:this.question(actual)};
   this.activity(actual,'attention');
   this.draftAttempts=this.draftAttempts.filter(attempt=>this.key(attempt.field)!==this.key(original));this.draftAttempts.push({field:actual,draft});this.unverified.delete(this.key(original));
   return{draftWritten:true,draft,verified:false,needsObservation:true};
 }
 async draftAnswer(input:{observation:string;target:string;facts:string[];text:string;reason:string}){
   const actionView=await this.fresh(input.observation,'draft');const field=this.field(input.target),facts=this.sourceFacts(input.facts);
   if(!this.draftTargetAllowed(field)||!input.text.trim()||input.text.length>3000||!input.reason.trim())throw Error('DRAFT_TARGET_NOT_ALLOWED');
   const issue=this.sourceScopeIssue(field,facts);if(issue)throw Error(issue);
   if(/所获荣誉|获奖|awards?|honou?r/i.test(field.label)&&!facts.every(fact=>fact.kind==='awardsSummary'||recordFamily(fact.record)==='award'))throw Error('AWARD_FACT_REQUIRED');
   if((field.value.trim()||field.type==='checkbox'&&field.checked===true)&&!this.overwriteExisting)throw Error('EXISTING_VALUE_PRESERVED');
   if(this.unverified.has(this.key(field)))throw Error('PRIOR_WRITE_UNVERIFIED');
   // The host owns private contact/identity values. Model prose cannot inject them.
   const privateValues=[this.profile.fullName,this.profile.fullNameEn,this.profile.email,this.profile.phone,this.profile.birthDate].filter((value):value is string=>!!value&&value.length>2);
   if(privateValues.some(value=>input.text.includes(value))||/\bsk-[A-Za-z0-9._-]+|\b\d{17}[\dXx]\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(input.text))throw Error('PRIVATE_VALUE_IN_DRAFT');
   await this.releaseControl();const node=await this.control(field),baseline=this.view!;
   const max=await node.getAttribute('maxlength');if(max&&Number(max)>0&&input.text.length>Number(max))throw Error('DRAFT_EXCEEDS_FIELD_LIMIT');
   await this.guard();this.activity(field,'approach',actionView);this.unverified.set(this.key(field),field.label);await node.fill(input.text,{timeout:2500});await node.evaluate(element=>(element as HTMLElement).blur());
   await this.unchangedExcept(baseline,field);await new Promise(resolve=>setTimeout(resolve,100));await this.guard();const after=await this.read(),actual=after.fields.filter(item=>this.key(item)===this.key(field));
   if(actual.length!==1||actual[0]!.value!==input.text||actual[0]!.invalid)throw Error('DRAFT_NOT_RETAINED');
   const records=[...new Set(facts.filter(careerFact).map(fact=>fact.record))];if(records.length===1&&field.group!=='contact'&&familyExpression(recordFamily(records[0]!)!).test(field.section))this.bindRecord(field.group,records[0]!);
   return this.recordDraft(field,actual[0]!,{...input,kind:'text'});
 }
 private async fieldOperation<T>(target:string,operation:()=>Promise<T>):Promise<T>{
   const field=this.view?.fields.find(field=>'field-'+field.index===target)??this.pendingControl?.field;
   this.verifiedView=undefined;try{return await operation();}catch(error){const code=universalErrorCode(error);
     if(error instanceof Error&&code==='BROWSER_OPERATION_TIMEOUT'&&!(error as any).controlDiagnostic)Object.assign(error,{controlDiagnostic:{stage:'native-action-timeout',classes:[...new Set([...error.message.matchAll(/class="([a-zA-Z0-9_ -]{1,160})"/g)].map(match=>match[1]))].slice(0,12)}});
     if(field&&!/^(?:APPLICATION_CONTEXT_CHANGED|FRESH_OBSERVATION_REQUIRED|PAGE_CHANGED_REOBSERVE|CONTROL_DEFERRED)/.test(code))this.noteFieldFailure(field,code);
     throw error;
   }
 }
 async selectOption(input:Parameters<UniversalFormSession['selectOptionUnchecked']>[0]){return this.fieldOperation(input.target,()=>this.selectOptionUnchecked(input));}
 async act(input:Parameters<UniversalFormSession['actUnchecked']>[0]){return this.fieldOperation(input.target,()=>this.actUnchecked(input));}
 private async selectOptionUnchecked(input:{observation:string;target:string;option:string;facts:string[];relation:'equivalent'|'category';reason:string}){
   const actionView=await this.fresh(input.observation,'choose');const field=this.field(input.target),facts=this.sourceFacts(input.facts);
   if(this.deferred.has(this.key(field)))throw Error('CONTROL_DEFERRED');
   if(!this.ordinaryTarget(field)||!field.ownedSelect&&field.type!=='select'||!input.reason.trim()||!['equivalent','category'].includes(input.relation))throw Error('SEMANTIC_SELECTION_NOT_ALLOWED');
   const scopeIssue=this.sourceScopeIssue(field,facts);if(scopeIssue)throw Error(scopeIssue);
   const compatible=facts.some(fact=>this.selectionSourceAllowed(field,fact));
   if(!compatible||/\b(?:c?gpa|grades?|scores?|rank(?:ing)?)\b|绩点|成绩|学分|排名/i.test(field.label)&&!facts.some(fact=>factFitsField(fact,field)))throw Error('FACT_FIELD_MISMATCH');
   if((field.value.trim()||field.type==='checkbox'&&field.checked===true)&&!this.overwriteExisting)throw Error('EXISTING_VALUE_PRESERVED');if(this.unverified.has(this.key(field)))throw Error('PRIOR_WRITE_UNVERIFIED');
   const baseline=field.ownedSelect&&this.pendingControl?this.pendingControl.baseline:this.view!;let expected:string,selected:OwnedSelectCommit|undefined;
   if(field.type==='select'){
     const match=/^native-option-(\d+)$/.exec(input.option),byLabel=field.options.filter(option=>option.label===input.option),option=match?field.options[Number(match[1])]:byLabel.length===1?byLabel[0]:undefined;if(!option||!option.label.trim()||!option.value)throw Error('OBSERVED_OPTION_REQUIRED');
     await this.releaseControl();const node=await this.control(field);await this.guard();this.activity(field,'approach',actionView);this.unverified.set(this.key(field),field.label);await node.selectOption(option.value);expected=option.value;
   }else{
     if(!this.pendingControl||this.key(this.pendingControl.field)!==this.key(field)){
       await this.releaseControl();const controller=await createOwnedSelectController(await this.control(field),()=>this.guard(),{label:field.label});this.pendingControl={field,controller,baseline:this.view!};await controller.open();
     }
     const pending=this.pendingControl;
     let options=await pending.controller.read(),byLabel=options.options.filter(item=>item.label===input.option),option=options.options.find(item=>item.ref===input.option)??(byLabel.length===1?byLabel[0]:undefined);
     if(!option&&this.observedOptions.get(this.key(field))?.includes(input.option)){
       options=await pending.controller.query(input.option);const until=Date.now()+700;
       do{byLabel=options.options.filter(item=>item.label===input.option);if(byLabel.length===1){option=byLabel[0];break;}if(Date.now()>=until)break;await new Promise(resolve=>setTimeout(resolve,60));options=await pending.controller.read();}while(true);
     }
     if(!option)throw Error('OBSERVED_OPTION_REQUIRED');
     this.activity(field,'approach',actionView);this.unverified.set(this.key(field),field.label);try{selected=await pending.controller.chooseObserved(option.ref,()=>this.unchangedExcept(baseline,field));}finally{await this.releaseControl();}expected=selected!.value;
   }
   if(selected?.source==='selected-native-value')this.selectedValues.set(this.key(field),selected.value);
   await this.unchangedExcept(baseline,field);await new Promise(resolve=>setTimeout(resolve,100));await this.guard();const after=await this.read(),found=after.fields.filter(item=>this.key(item)===this.key(field));
   if(found.length!==1||found[0]!.invalid||found[0]!.expanded||found[0]!.popupVisible||found[0]!.queryPending||found[0]!.value!==expected)throw Error('DRAFT_SELECTION_NOT_RETAINED');
   const records=[...new Set(facts.filter(careerFact).map(fact=>fact.record))];if(records.length===1&&field.group!=='contact'&&familyExpression(recordFamily(records[0]!)!).test(field.section))this.bindRecord(field.group,records[0]!);
   return this.recordDraft(field,found[0]!,{...input,kind:'selection'});
 }
 async selectOptions(input:{observation:string;mappings:Array<{target:string;option:string;facts:string[];relation:'equivalent'|'category';reason:string}>}){
   if(!this.view||this.used||input.observation!=='observation-'+this.epoch)throw Error('FRESH_OBSERVATION_REQUIRED');
   if(!input.mappings.length||input.mappings.length>6||new Set(input.mappings.map(item=>item.target)).size!==input.mappings.length)throw Error('INVALID_GROUP_MAPPING');
   const items=input.mappings.map(mapping=>({mapping,key:this.key(this.field(mapping.target))})),results=[];
   for(const {mapping,key} of items){
     const next=await this.inspect(),matches=this.view!.fields.filter(field=>this.key(field)===key);
     if(matches.length!==1){results.push({target:mapping.target,reason:'FIELD_IDENTITY_CHANGED'});continue;}
     try{results.push(await this.selectOption({...mapping,observation:next.observation,target:'field-'+matches[0]!.index}));}
     catch(error){const code=universalErrorCode(error);if(code.startsWith('APPLICATION_CONTEXT_CHANGED'))throw error;await this.releaseControl();results.push({target:mapping.target,reason:code,...(error instanceof Error&&(error as any).controlDiagnostic?{controlDiagnostic:(error as any).controlDiagnostic}:{})});}
   }
   return{results,needsObservation:true};
 }
 async applyDecisionPlan(input:{observation:string;mappings?:Array<{target:string;fact:string}>;selections:Array<{target:string;option:string;facts:string[];relation:'equivalent'|'category';reason:string}>;drafts:Array<{target:string;facts:string[];text:string;reason:string}>}){
   if(!this.view||this.used||input.observation!=='observation-'+this.epoch)throw Error('FRESH_OBSERVATION_REQUIRED');
   const targets=[...(input.mappings??[]),...input.selections,...input.drafts].map(item=>item.target);if(targets.length>12||new Set(targets).size!==targets.length)throw Error('INVALID_GROUP_MAPPING');
   const mappingsWithKeys=(input.mappings??[]).map(mapping=>({mapping,key:this.key(this.field(mapping.target))}));
   const drafts=input.drafts.map(mapping=>({mapping,key:this.key(this.field(mapping.target))})),selectionsWithKeys=input.selections.map(mapping=>({mapping,key:this.key(this.field(mapping.target))})),results=[];
   for(const {mapping,key} of mappingsWithKeys){try{const next=await this.inspect();const mapped=this.view!.fields.find(item=>this.key(item)===key);if(!mapped)throw Error('FIELD_IDENTITY_CHANGED');await this.mapField({...mapping,target:'field-'+mapped.index,observation:next.observation});const after=await this.inspect();results.push(await this.fillGroup(after.observation,[{target:'field-'+this.view!.fields.find(item=>this.key(item)===key)!.index,fact:mapping.fact}]));}catch(error){results.push({target:mapping.target,reason:universalErrorCode(error)});}}
   if(input.selections.length){
     // A site may classify study mode by school type (e.g. overseas), while
     // the field also has one explicit confirmed study-mode candidate. Retain
     // that host-known source alongside the model's school reference; the
     // choice and cross-record checks still run in selectOption.
     const selectionObservation=await this.inspect();const selections=selectionsWithKeys.flatMap(({mapping,key})=>{const field=this.view!.fields.find(item=>this.key(item)===key);if(!field)return [];mapping={...mapping,target:'field-'+field.index};const facts=this.candidates(field);return facts.length===1&&!mapping.facts.includes(facts[0]!.ref)&&mapping.facts.length<12?{...mapping,facts:[...mapping.facts,facts[0]!.ref]}:mapping;});
     if(selections.length)results.push(await this.selectOptions({observation:selectionObservation.observation,mappings:selections}));
   }
   for(const {mapping,key} of drafts){const next=await this.inspect(),matches=this.view!.fields.filter(field=>this.key(field)===key);
     if(matches.length!==1){results.push({target:mapping.target,reason:'FIELD_IDENTITY_CHANGED'});continue;}
     try{results.push(await this.draftAnswer({...mapping,observation:next.observation,target:'field-'+matches[0]!.index}));}
     catch(error){const code=universalErrorCode(error);if(code.startsWith('APPLICATION_CONTEXT_CHANGED'))throw error;await this.releaseControl();results.push({target:mapping.target,reason:code});}
   }
   return{results,needsObservation:true};
 }
 async expandSection(input:{observation:string;section:string}){await this.fresh(input.observation,'expand');const section=this.view?.sections?.find(item=>item.ref===input.section);if(!section)throw Error('UNKNOWN_SECTION');await this.releaseControl();return{...await expandOwnedSection(this.page,section,()=>this.guard()),needsObservation:true};}
 async ensureRecord(input:{observation:string;target:string;record:string}){await this.fresh(input.observation,'add');return this.addRecord(input.target,input.record);}
 private async addRecord(target:string,record?:string){
   const action=this.view!.actions.find(item=>'add-'+item.index===target);if(!action||unsafe.test(action.label)||!this.additionAllowed(action))throw Error('NO_ADDITIONAL_CONFIRMED_RECORD');
   const type=this.actionFamily(action),available=this.unboundRecords(type);if(!record){if(available.length!==1)throw Error('EXPLICIT_RECORD_REQUIRED');record=available[0];}
   if(!record||!available.includes(record))throw Error('RECORD_ALREADY_BOUND');
   await this.releaseControl();const baseline=this.view!,oldGroups=new Set(baseline.fields.map(field=>field.group));const node=this.page.locator(actionSelector).nth(action.nodeIndex);
   if(!await node.isVisible()||await node.evaluate(element=>!!element.closest('a[href],button:not([type="button"]),input[type="submit"]')))throw Error('UNSAFE_ADD_TARGET');
   // Reserve before clicking: a timeout may mean the click took effect. Unknown
   // creation locks this family, never blindly repeats or deletes a website row.
   await this.guard();this.pendingAddKinds.add(type);this.attemptMemory?.unknownAddKinds.add(type);this.addCounts.set(type,(this.addCounts.get(type)??0)+1);await node.click({timeout:2500});
   const deadline=Date.now()+1000;let after:View;
   do{await this.guard();after=await this.read();if(after.fields.some(field=>!oldGroups.has(field.group)&&familyExpression(type).test(field.section)))break;if(Date.now()>=deadline)throw Error('RECORD_NOT_CREATED');await new Promise(resolve=>setTimeout(resolve,60));}while(true);
   for(const original of baseline.fields){const matches=after.fields.filter(field=>this.key(field)===this.key(original));if(matches.length!==1||matches[0]!.value!==original.value||matches[0]!.checked!==original.checked)throw Error('ADD_CHANGED_EXISTING_RECORD:'+original.index+':'+matches.length);}
   const added=[...new Set(after.fields.filter(field=>!oldGroups.has(field.group)&&familyExpression(type).test(field.section)).map(field=>field.group))];if(added.length!==1)throw Error('ADD_RECORD_AMBIGUOUS');
   this.bindRecord(added[0]!,record);this.pendingAddKinds.delete(type);this.attemptMemory?.unknownAddKinds.delete(type);return{changed:true,record,group:added[0],verified:false,needsObservation:true};
 }
 async readOptionsGroup(observation:string,targets:string[]){
   if(!targets.length||targets.length>6||new Set(targets).size!==targets.length)throw Error('INVALID_GROUP_MAPPING');
   await this.fresh(observation,'read-options');const fields=targets.map(ref=>this.field(ref)),results=[];
   for(const original of fields){
     await this.inspect();const matches=this.view!.fields.filter(f=>this.key(f)===this.key(original));if(matches.length!==1){results.push({target:'field-'+original.index,reason:'FIELD_IDENTITY_CHANGED'});continue;}
     const field=matches[0]!;try{
       if(field.type==='select'){this.observedOptions.set(this.key(field),field.options.map(o=>o.label));results.push({target:'field-'+field.index,options:field.options.map(o=>o.label),truncated:false});}
       else if(field.ownedSelect){const result=await this.act({observation:'observation-'+this.epoch,action:'read-options',target:'field-'+field.index});
         const labels=new Set((result as any).options?.map((option:any)=>option.label)??[]);
         if((result as any).truncated&&this.pendingControl){for(let turn=0;turn<14&&labels.size<200;turn++){
           const next=await this.pendingControl.controller.scroll('down'),oldSize=labels.size;for(const option of next.options)labels.add(option.label);if(labels.size===oldSize)break;
         }}
         this.observedOptions.set(this.key(field),[...labels] as string[]);results.push({target:'field-'+field.index,...result,options:[...labels].map(label=>({label}))});}
       else results.push({target:'field-'+field.index,reason:'OPEN_NOT_ALLOWED'});
     }catch(error){results.push({target:'field-'+field.index,reason:universalErrorCode(error)});}
     finally{await this.releaseControl();}
   }
   return{results,needsObservation:true};
 }
 recovery(target:string|undefined){const field=target&&this.view?.fields.find(f=>'field-'+f.index===target)||this.pendingControl?.field;
   return field?{target:'field-'+field.index,allowedActions:this.capabilities(field),expectedAction:field.type==='checkbox'?'fill':field.ownedSelect?'fill':undefined,candidates:this.candidates(field).map(f=>f.ref)}:undefined;
 }
 progressKey(target?:string){const field=target&&this.view?.fields.find(f=>'field-'+f.index===target)||this.pendingControl?.field;return field?this.key(field):target??'none';}
 private resolve(ref:string,field:Field){const fact=this.facts.find(f=>f.ref===ref);if(fact?.kind==='answer'){const answers=eligibleUniversalAnswers(this.answerContext,this.profileVersion),index=this.facts.filter(f=>f.kind==='answer').findIndex(f=>f===fact);if(this.answerFor(field)!==answers[index]&&this.semanticMappings.get(this.key(field))!==fact.ref)throw Error('FACT_FIELD_MISMATCH');return fact;}if(!fact||!factFitsField(fact,field)&&this.semanticMappings.get(this.key(field))!==fact.ref)throw Error('FACT_FIELD_MISMATCH');if(field.datePart)controlFact(field,fact);
   if(careerFact(fact)&&familyExpression(recordFamily(fact.record)!).test(field.section)&&field.group==='contact')throw Error('RECORD_BINDING_CONFLICT');
   const binding=this.bindings.get(field.group);if(this.scopedRecord(fact,field)&&binding&&binding!==fact.record)throw Error('RECORD_BINDING_CONFLICT');
   if(this.scopedRecord(fact,field)&&[...this.bindings].some(([group,record])=>group!==field.group&&record===fact.record))throw Error('RECORD_ALREADY_BOUND');
   if(this.scopedRecord(fact,field)&&!binding){const fields=this.view!.fields.filter(f=>f.group===field.group);
     if(fields.some(f=>!['checkbox','radio'].includes(f.type)&&f.value.trim())){
       const matching=matchExistingRecord(fields,this.facts);
       if(matching!==fact.record)throw Error('EXISTING_RECORD_AMBIGUOUS');
       const duplicates=[...new Set(this.view!.fields.map(f=>f.group))].filter(group=>group!==field.group&&group!=='contact'&&matchExistingRecord(this.view!.fields.filter(f=>f.group===group),this.facts)===matching);
       if(duplicates.length)throw Error('DUPLICATE_RECORD_NEEDS_REVIEW');
     }
   }return fact;
 }
 private async actUnchecked(input:{observation:string;action:'fill'|'open'|'choose'|'add'|'query'|'read-options'|'close'|'scroll'|'scroll-options'|'create';target:string;fact?:string}){
   const actionView=await this.fresh(input.observation,input.action);const field=input.action==='add'?undefined:this.pendingControl&&['choose','create','close','read-options','scroll-options'].includes(input.action)?this.currentControlField():this.field(input.target);
   if(input.action==='add'){
     return this.addRecord(input.target);
   }
   if(!field)throw Error('FIELD_NOT_EDITABLE');
   if(this.unverified.has(this.key(field))&&!['scroll','close'].includes(input.action))throw Error('PRIOR_WRITE_UNVERIFIED');
   if(this.deferred.has(this.key(field))&&!['scroll','close'].includes(input.action))throw Error('CONTROL_DEFERRED');
   if(this.calendarField(field)&&['open','read-options','scroll-options','query','choose','create'].includes(input.action))throw Error('DATE_USE_FILL');
   if(input.action==='scroll'){const node=await this.control(field);await this.guard();await node.scrollIntoViewIfNeeded({timeout:2500});return{scrolled:true,needsObservation:true};}
   if(!field.editable)throw Error('FIELD_NOT_EDITABLE');
   if(input.action==='close'){const result=await this.releaseControl();return{closed:result.closed,needsObservation:true};}
   if(['open','read-options','scroll-options'].includes(input.action)){
     if(!field.ownedSelect)throw Error(field.type==='checkbox'?'CHECKBOX_USE_FILL':'OPEN_NOT_ALLOWED');
     if(!this.pendingControl||this.key(this.pendingControl.field)!==this.key(field)){
       await this.releaseControl();const controller=await createOwnedSelectController(await this.control(field),()=>this.guard(),{label:field.label});
       this.pendingControl={field,controller,baseline:this.view!};await controller.open();
     }
     const result=input.action==='scroll-options'?await this.pendingControl.controller.scroll('down'):await this.pendingControl.controller.read();
     this.observedOptions.set(this.key(field),result.options.map(o=>o.label));
     return{opened:result.open,options:result.options,truncated:result.truncated,canCreate:result.canCreate,needsObservation:true};
   }
   if(!input.fact)throw Error('CONFIRMED_FACT_REQUIRED');const fact=this.resolve(input.fact,field);
   if((field.value.trim()||field.type==='checkbox'&&field.checked===true)&&!this.overwriteExisting)throw Error('EXISTING_VALUE_PRESERVED');
   if(!this.needsWrite(field))return{verified:false,alreadyCorrect:true,label:field.label,needsObservation:true};
   if(field.datePrecision==='day'&&/^\d{4}-\d{2}$/.test(fact.value))throw Error('DATE_PRECISION_MISSING');
   const writeKey=this.key(field);
   if(this.unverified.has(writeKey))throw Error('PRIOR_WRITE_UNVERIFIED');
   if(input.action==='query'){
     if(!field.ownedSelect)throw Error('QUERY_NOT_ALLOWED');
     if(!this.pendingControl||this.key(this.pendingControl.field)!==writeKey){await this.releaseControl();this.pendingControl={field,baseline:this.view!,controller:await createOwnedSelectController(await this.control(field),()=>this.guard(),{label:field.label})};await this.pendingControl.controller.open();}
     const result=await this.pendingControl.controller.query(controlFact(field,fact).value);this.observedOptions.set(writeKey,result.options.map(o=>o.label));return{queried:true,options:result.options,truncated:result.truncated,canCreate:result.canCreate,needsObservation:true};
   }
   let selected:OwnedSelectCommit|undefined,majorFallbackWritten=false;
   if(input.action==='choose'||input.action==='create'){
     const pending=this.pendingControl;if(!pending||this.key(pending.field)!==writeKey)throw Error('OPEN_FIRST');
     const controls=await pending.controller.read(),value=controlFact(field,fact);
     let option=controls.options.find(o=>o.ref===input.target);
     if(input.target==='field-'+field.index){const matches=controls.options.filter(o=>o.aliases.some(label=>ownedOptionMatches(value,label)));if(matches.length===1)option=matches[0];}
     if(input.action==='choose'&&!option)throw Error('OPTION_FACT_MISMATCH');
     this.activity(field,'approach',actionView);this.unverified.set(writeKey,field.label);
     try{selected=input.action==='create'?await pending.controller.create(value):await pending.controller.choose(option!.ref,value);}
     finally{await this.releaseControl();}
   }else{
     await this.releaseControl();const node=await this.control(field);
     if(field.ownedSelect){
       const baseline=this.view!;
       const unchanged=async()=>{const current=await this.read();await this.guard();
         for(const original of baseline.fields){if(this.key(original)===writeKey)continue;const actual=current.fields.filter(f=>this.key(f)===this.key(original));if(actual.length!==1||JSON.stringify(semanticFields(actual))!==JSON.stringify(semanticFields([original])))throw Object.assign(Error('PAGE_CHANGED_REOBSERVE'),{controlDiagnostic:{stage:'unchanged',field:original.label,found:actual.length,changed:actual.length===1?Object.keys(original).filter(key=>key!=='bounds'&&JSON.stringify((original as any)[key])!==JSON.stringify((actual[0] as any)[key])):[]}});}
       };
       if(!field.datePart&&['startDate','endDate','birthDate','publicationDate'].includes(fact.kind)&&(fact.value==='至今'||/^\d{4}-\d{2}(?:-\d{2})?$/.test(fact.value))){
         this.activity(field,'approach',actionView);this.unverified.set(writeKey,field.label);try{selected=await fillOwnedCalendar(node,fact.value,()=>this.guard(),unchanged);}
         catch(error){
           if(error instanceof Error&&(error as Error&{calendarSelectionAttempted?:boolean}).calendarSelectionAttempted===false){
             await this.guard();const actual=(await this.read()).fields.filter(candidate=>this.key(candidate)===writeKey);
             if(actual.length===1&&actual[0]!.value===field.value&&actual[0]!.checked===field.checked)this.unverified.delete(writeKey);
           }
           if(!(error instanceof Error)||error.message!=='CALENDAR_NOT_FOUND')throw error;
         }
       }
       if(!selected){const controller=await createOwnedSelectController(node,()=>this.guard(),{label:field.label});try{
         const value=controlFact(field,fact);let options=await controller.open(fact.kind==='applicationInterview'?undefined:value.value);const until=Date.now()+2500;
         if(fact.kind==='applicationInterview'){
           const direct=options.options.filter(option=>option.aliases.some(label=>/^(?:线上(?:面试)?|远程面试|online|remote|video interview)$/i.test(label)));this.unverified.set(writeKey,field.label);
           if(direct.length===1&&/线上|online|remote/i.test(fact.value))selected=await controller.chooseObserved(direct[0]!.ref,unchanged);
           else{const paths=/线上|online|remote/i.test(fact.value)?[['线上站点','其他'],...(/广东|深圳/.test(fact.value)?[['广东','深圳'],['广东','深圳市']]:[])]:/深圳/i.test(fact.value)?[['广东','深圳'],['广东','深圳市']]:[];
             for(const path of paths){try{selected=await controller.choosePath(path,unchanged);break;}catch(error){if((error as any)?.pathInteracted||this.signal.aborted||this.getGeneration()!==this.generation)throw error;}}
             if(!selected)throw Error('INTERVIEW_PATH_REQUIRES_REVIEW');}
           this.attemptMemory?.guidanceChoices.set('applicationInterview|'+field.label,{value:selected.value,policy:this.setup?.value.interviewPreference??fact.value});fact.value=selected.value;
         }
         if(fact.kind==='applicationSource'&&!options.options.some(option=>option.aliases.some(label=>ownedOptionMatches(value,label)))&&this.setup?.value.recruitmentSourceFallback){
           const alternative=this.setup.value.recruitmentSourceFallback;try{options=await controller.query(alternative);}catch{/* Non-searchable static lists retain their observed choices. */}
           const choices=options.options.filter(option=>option.aliases.some(label=>optionMatchesFact(label,alternative)));if(choices.length===1){this.unverified.set(writeKey,field.label);selected=await controller.chooseObserved(choices[0]!.ref,unchanged);}
         }

         let matches=options.options.filter(o=>o.aliases.some(label=>ownedOptionMatches(value,label)));
         while(!selected&&!matches.length&&!options.canCreate&&Date.now()<until&&!(/专业.*(?:类|类型)|major.*(?:type|categor)/i.test(field.label)&&options.options.length>0&&!options.truncated)){await new Promise(resolve=>setTimeout(resolve,100));await this.guard();options=await controller.read();matches=options.options.filter(o=>o.aliases.some(label=>ownedOptionMatches(value,label)));}
         this.observedOptions.set(writeKey,options.options.map(o=>o.label));
         if(selected){}else if(matches.length>1)throw Error('OWNED_OPTION_AMBIGUOUS');
         else if(matches.length===1){this.activity(field,'approach',actionView);this.unverified.set(writeKey,field.label);selected=await controller.choose(matches[0]!.ref,value,unchanged);}
         else if(options.canCreate){this.activity(field,'approach',actionView);this.unverified.set(writeKey,field.label);selected=await controller.create(value,unchanged);}
         else if(this.majorFallback(fact)){const fallback=this.majorFallback(fact)!;options=await controller.query(fallback);const alternatives=options.options.filter(option=>option.aliases.some(label=>optionMatchesFact(label,fallback)));if(alternatives.length!==1)throw Error('AUTHORIZED_MAJOR_FALLBACK_NOT_UNIQUE');this.unverified.set(writeKey,field.label);selected=await controller.chooseObserved(alternatives[0]!.ref,unchanged);majorFallbackWritten=true;}
         else throw Error('OWNED_OPTION_NOT_FOUND');
       }finally{await controller.dispose();}}
     }else if(field.type==='checkbox'&&fact.kind==='endDate'){
       await this.guard();this.activity(field,'approach',actionView);this.unverified.set(writeKey,field.label);
       // SD paints its checkbox with an SVG over the actual input. Click the
       // owning HTML label, then verify the actual checkbox in the fresh reader.
       const wrapper=await node.evaluateHandle(e=>{const label=e.closest('label');return label&&label.querySelectorAll('input').length===1&&label.querySelector('input')===e&&(!label.htmlFor||label.htmlFor===e.id)?label:null;});
       try{const label=wrapper.asElement();if(label){await label.evaluate(e=>e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));await this.guard();await label.click({timeout:2500});}else await node.setChecked(fact.value==='至今',{timeout:2500});}finally{await wrapper.dispose();}
     }else if(field.type==='select'){
       let options=field.options.filter(o=>optionMatchesFact(o.label,fact.value));if(!options.length&&this.majorFallback(fact)){options=field.options.filter(option=>optionMatchesFact(option.label,this.majorFallback(fact)!));majorFallbackWritten=true;}if(options.length!==1)throw Error('UNIQUE_OPTION_REQUIRED');await this.guard();this.activity(field,'approach',actionView);this.unverified.set(writeKey,field.label);await node.selectOption(options[0]!.value);if(majorFallbackWritten)selected={value:options[0]!.value,source:'native-select-fallback',committed:true};
     }else if(['text','email','tel','textarea','month','date'].includes(field.type)){
       if(field.type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(fact.value)||field.type==='month'&&!/^\d{4}-\d{2}$/.test(fact.value))throw Error('DATE_PRECISION_MISSING');
       if(await node.evaluate(e=>!!e.closest('.phoenix-select,[role="combobox"]')))throw Error('USE_SELECT_ACTION');await this.guard();this.activity(field,'approach',actionView);this.unverified.set(writeKey,field.label);await node.fill(controlFact(field,fact).value,{timeout:2500});await node.evaluate(e=>(e as HTMLElement).blur());
     }else throw Error('UNSUPPORTED_CONTROL');
   }
   if(selected?.source==='selected-native-value')this.selectedValues.set(writeKey,selected.value);
   await this.guard();const after:View=await this.read();
   const candidates=after.fields.filter(f=>f.identity===field.identity&&f.label===field.label&&f.section===field.section&&f.group===field.group);
   if(candidates.length!==1)throw Object.assign(Error('WRITE_IDENTITY_CHANGED_VERIFY_REQUIRED'),{controlDiagnostic:{stage:'write-identity-readback',before:{identity:field.identity,group:field.group,label:field.label,section:field.section},after:after.fields.filter(item=>item.label===field.label).map(item=>({identity:item.identity,group:item.group,label:item.label,section:item.section}))}});
   const actual=candidates[0]!;const expected=field.type==='select'?field.options.find(o=>optionMatchesFact(o.label,fact.value))?.value:controlFact(field,fact).value;
   if(actual.invalid)throw Error('PAGE_VALIDATION_FAILED');
   if(majorFallbackWritten){if(!selected||actual.value!==selected.value||actual.expanded||actual.popupVisible||actual.queryPending)throw Error('DRAFT_SELECTION_NOT_RETAINED');if(this.scopedRecord(fact,field))this.bindRecord(field.group,fact.record);this.view=after;this.verifiedView=after;return this.recordDraft(field,actual,{kind:'selection',relation:'category',facts:[fact.ref],reason:'网站无法保留专业全称，使用本人预先允许的最接近专业；真实专业原文保留在个人资料中。'});}
   const dateEquivalent=/^\d{4}-\d{2}(?:-\d{2})?$/.test(fact.value)&&actual.value.replace(/年|\//g,'-').replace(/月$/,'').replace(/月/,'-').replace(/日$/,'')===fact.value;
   if(actual.value.trim()!==expected&&!this.matches(actual,fact)&&!dateEquivalent)throw Error('VALUE_NOT_RETAINED');
   if(this.scopedRecord(fact,field))this.bindRecord(field.group,fact.record);
   this.unverified.delete(writeKey);this.activity(actual,'verified');this.view=after;this.verifiedView=after;
   const previous=this.attempted.findIndex(a=>a.field.group===actual.group&&a.field.identity===actual.identity&&a.field.label===actual.label);
   const proof={field:actual,fact,value:actual.value};if(previous>=0)this.attempted[previous]=proof;else this.attempted.push(proof);
   return{verified:true,label:field.label,verifiedCount:this.attempted.length,needsObservation:true};
 }
 async verify(userFacing=false){await this.guard();const view:View=await this.read();await this.guard();this.view=view;
   const checks=this.attempted.map(a=>{const found=view.fields.filter(f=>f.identity===a.field.identity&&f.label===a.field.label&&f.group===a.field.group);return{label:a.field.label,retained:found.length===1&&found[0]!.value===a.value&&found[0]!.checked===a.field.checked&&!found[0]!.invalid};});
   const remaining=view.fields.filter(f=>applicationField(f)&&f.editable&&!unsafe.test(f.label+' '+f.section)&&this.needsWrite(f,true));
   const key=(f:Field)=>f.group+'|'+f.identity+'|'+f.label;
   // Existing content is counted only when it independently matches an exact
   // confirmed fact. A nonempty value (e.g. a phone country code) is not proof.
   const matched=view.fields.filter(f=>applicationField(f)&&!unsafe.test(f.label+' '+f.section)&&!f.invalid&&!f.queryPending&&!f.expanded&&!f.popupVisible&&this.candidates(f).some(fact=>this.matches(f,fact)));
   const attemptedKeys=new Set(this.attempted.map(a=>key(a.field)));
   const pending=new Set([...remaining.map(key),...this.unverified.keys(),...this.attempted.filter((_a,i)=>!checks[i]!.retained).map(a=>key(a.field))]);
   const summaryCovered=(record:string)=>{const kind=({language:'languagesSummary',software:'softwareSummary',award:'awardsSummary'} as Record<string,string>)[recordFamily(record)!];return !!kind&&this.facts.some(fact=>fact.kind===kind&&view.fields.some(field=>factFitsField(fact,field)&&this.matches(field,fact)));};
   const missingRecords=this.coverage().filter(item=>item.state!=='matched'&&!summaryCovered(item.record)&&(item.state!=='not-exposed'||['education','internship','project'].includes(item.kind))).map(item=>item.record);
   const drafts=this.draftAttempts.map(attempt=>{const actual=view.fields.filter(field=>this.key(field)===this.key(attempt.field));return{...attempt.draft,writtenThisRun:!this.restoredDraftKeys.has(this.key(attempt.field)),retained:actual.length===1&&this.retainedDraft(actual[0]!)&&actual[0]!.value===attempt.draft.value};});
   const pendingReview=drafts.filter(draft=>draft.retained).length;
   const collapsedSections=(view.sections??[]).filter(section=>section.state==='collapsed').map(section=>({label:section.label,ref:section.ref}));
   return{verified:checks.filter(c=>c.retained).length,checks,pending:pending.size+pendingReview+collapsedSections.length,matchedConfirmed:matched.length,alreadyCorrect:matched.filter(f=>!attemptedKeys.has(key(f))).length,drafts,draftWritten:drafts.filter(draft=>draft.retained&&draft.writtenThisRun).length,pendingReview,collapsedSections,
     actionableRemaining:remaining.filter(f=>this.candidates(f).length>0).map(f=>({label:f.label,section:f.section})),
     missingRecords,recordCoverage:this.coverage(),
     unverified:[...this.unverified.values()],remaining:remaining.map(f=>{const none=this.noAwards(f),reason=none?'本人已确认无获奖经历；此必填获奖行需要在网站处理，未编造奖项或日期。':this.manualReason(f),missing=!none&&reason.startsWith('个人资料里没有'),question=!none&&userFacing&&(missing||!!this.decisionFor(f))?this.question(f):undefined,options=this.observedOptions.get(this.key(f));return{label:f.label,section:f.section,reason,reasonCode:none?'user-none':reason.startsWith('未提供推荐码')?'leave-empty':reason.startsWith('请在提交前自行')?'user-action':reason.startsWith('网页多出一段')?'extra-empty-record':reason.startsWith('已保存的日期只有')?'date-precision':this.priorFailure(f)?'previous-failure':this.decisionFor(f)?(this.decisionFor(f)!.disposition==='none'?'user-none':'user-skipped'):missing?'missing-data':'fill-failed',...(question?{question:{...question,...(options?.length?{options:options.slice(0,80)}:{})}}:{})};}),submitted:false};
 }
 async releaseControl(){const pending=this.pendingControl;this.pendingControl=undefined;if(!pending)return{closed:true};try{return await pending.controller.close();}finally{await pending.controller.dispose();}}
 private currentControlField(){const pending=this.pendingControl;if(!pending)throw Error('OPEN_FIRST');const matches=this.view!.fields.filter(f=>this.key(f)===this.key(pending.field));if(matches.length!==1)throw Error('FIELD_IDENTITY_CHANGED');return matches[0]!;}
 close(){this.closed=true;void this.releaseControl().catch(()=>{});void this.registry?.dispose().catch(()=>{});this.registry=undefined;}
}
