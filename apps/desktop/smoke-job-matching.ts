import{emptyCareerInput,newCareerRecord,pickCareerInput}from'../../packages/profile/src/career-input.js';
import type{BrowserWindow}from'electron';import{setTimeout as delay}from'node:timers/promises';import type{AppEvent}from'../../packages/shared/src/contracts.js';
import{READ_FORM}from'../../packages/browser/src/read-scripts.js';
export async function smokeJobMatching(window:BrowserWindow,methods:Record<string,(...args:any[])=>Promise<any>>,send:(event:AppEvent)=>void){
 if(!process.argv.includes('--smoke-test')||!process.argv.includes('--smoke-job-matching-only')||window.isVisible())throw Error('Hidden isolated matching fixture required');
 let assertions=0;const check=(x:unknown,msg:string)=>{if(!x)throw Error(msg);assertions++;};
 const ui=<T=any>(s:string)=>window.webContents.executeJavaScript(s)as Promise<T>;
 const invoke=(method:string,args:any[]=[])=>ui(`window.offer[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
 const until=async(predicate:()=>Promise<boolean>,msg:string)=>{const end=Date.now()+7000;while(Date.now()<end){if(await predicate())return;await delay(25);}throw Error(msg);};
 let state=await invoke('getState');check(state.profile.version===0&&state.jobs.length===0,'isolatedEmptyStore');
 const {version,updatedAt,...profile}=state.profile;
 const career=emptyCareerInput();career.educations=[{...newCareerRecord('educations','fixture-education'),school:'虚构大学',degree:'硕士',major:'人工智能',startDate:'2025-09',endDate:'2027-07',sourceNote:'原创虚构UI验收资料'}];
 state=await invoke('saveProfile',[{...profile,fullName:'虚构匹配样例',degree:'硕士',major:'人工智能',graduationMonth:'2027-07',skills:['Python','RAG'],targetRoles:['大模型'],cities:['北京'],career},version]);
 const education=state.profile.career.educations[0];state=await invoke('confirmCareerRecord',['educations',education.id,state.profile.version,education.revision]);
 const {version:confirmedVersion,updatedAt:confirmedTime,...confirmedProfile}=state.profile;const confirmedCareer=pickCareerInput(state.profile.career);confirmedCareer.primaryEducationId=education.id;
 state=await invoke('saveProfile',[{...confirmedProfile,career:confirmedCareer},confirmedVersion]);
 const originalWorkflow=methods.workflowState!, originalRestoreNavigate=methods.browserNavigate!;let restored='';
 const restoreURL='https://careers.example.invalid/apply?userId=fictional-private-query';
 const fixtureWorkflow={id:'fixture-saved-page',schemaVersion:1,target:{url:restoreURL,profileVersion:1},status:'idle',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sections:[],issues:[],coverage:'observed-targets-only',requiresFreshObservation:true};
 methods.workflowState=async()=>({workflows:[fixtureWorkflow]});methods.browserNavigate=async(url:string)=>{restored=url;return methods.browserState!();};
 try{
   send({type:'navigate',page:'browser'});
   await until(()=>ui(`(()=>{const a=document.querySelector('input[aria-label="网页地址"]');return !!a&&a.getBoundingClientRect().width>0;})()`),'emptyBrowserAddressBarVisible');check(true,'emptyBrowserAddressBarVisible');
   await until(()=>ui(`!!document.querySelector('[data-testid="restore-application-page-0"]')`),'savedPageRestorePresent');check(true,'savedPageRestorePresent');
   check(await ui(`!document.querySelector('[data-testid="recent-application-pages"]').textContent.includes('fictional-private-query')`),'restoreDoesNotExposePrivateQuery');
   await until(()=>ui(`(()=>{const b=document.querySelector('[data-testid="restore-application-page-0"]');return b instanceof HTMLButtonElement&&!b.disabled;})()`),'savedPageRestoreEnabledAfterLayout');
   await ui(`document.querySelector('[data-testid="restore-application-page-0"]').click()`);
   await until(async()=>restored===restoreURL,'restorePassesExactSavedUrl');check(true,'restorePassesExactSavedUrl');
   check((await invoke('getState')).applications.length===0,'restoreDoesNotTrackOrFill');
 }finally{methods.workflowState=originalWorkflow;methods.browserNavigate=originalRestoreNavigate;}
 for(const[id,degree]of [['match-good','硕士'],['match-hard-no','博士']])state=await invoke('saveJob',[{id,company:'虚构匹配公司',title:'知识检索校招',city:'北京',type:'campus',description:'使用Python开发知识检索与工具执行工作流，核对引用与失败案例。',requirements:`2027届，${degree}学历；需要Python与RAG。`,url:'https://careers.example.invalid/'+id,sourceId:'smoke',sourceName:'原创虚构匹配样表',publishedAt:'2026-10-01',deadline:'2027-06-01',demo:false}]);
 for(let i=0;i<24;i++)state=await invoke('saveJob',[{id:'library-extra-'+i,company:'虚构行政公司',title:'行政协调'+i,city:'北京',type:'campus',description:'组织行政活动，维护物资采购和日常接待安排。',requirements:'2027届，本科及以上学历。',url:'https://careers.example.invalid/extra-'+i,sourceId:'smoke',sourceName:'原创虚构全库检索样例',publishedAt:'2026-10-01',deadline:'2027-06-01',demo:false}]);
 send({type:'model',status:{mode:'live',provider:'scripted-ui-fixture',modelId:'fixture-only',configured:true}});send({type:'navigate',page:'apply'});
 await until(()=>ui(`!!document.querySelector('[data-testid="match-profile-jobs"]')`),'matchingButtonPresent');check(true,'matchingButtonPresent');
 const before=await invoke('getState');
 await ui(`(()=>{const b=document.querySelector('[data-testid="match-profile-jobs"]');if(!(b instanceof HTMLButtonElement)||b.disabled)throw Error('matching button disabled');b.scrollIntoView();b.click();})()`);
 await until(async()=> (await invoke('jobMatchingState')).status==='completed','matchingCompletes');const result=await invoke('jobMatchingState');
 check(result.ranking.length===1&&result.ranking[0]==='match-good','modelResultUsesRealSavedID');check(result.requests===1,'oneScriptedSDKCompletion');
 await until(()=>ui(`document.querySelector('.apply-section-heading h3')?.textContent==='按简历匹配的岗位'`),'rendererAcceptsModelResult');check(true,'rendererAcceptsModelResult');
 check(await ui(`!!document.querySelector('[data-testid="recommended-job-match-good"]')`),'selectedCardPresent');check(!await ui(`!!document.querySelector('[data-testid="recommended-job-match-hard-no"]')`),'hardConflictAbsent');
 check(result.hardRejected===1,'preRetrievalHardGateRejectedConflict');
 check(result.retrieval?.scannedCount===26,'wholeLibraryScannedBeyond20');check(result.comparedCount<=20,'boundedRerankerContext');check(result.wholeLibrary===true,'defaultScopeIsWholeLibrary');check(await ui(`!!document.querySelector('input[aria-label="想找的岗位方向"]')`),'roleIntentInputPresent');
 const after=await invoke('getState');check(JSON.stringify(before.jobs)===JSON.stringify(after.jobs),'jobsNotRewritten');check(JSON.stringify(before.profile)===JSON.stringify(after.profile),'profileNotRewritten');check(after.applications.length===0,'noTrackerMutation');
 const{version:v,updatedAt:u,...changed}=after.profile;await invoke('saveProfile',[{...changed,career:pickCareerInput(after.profile.career),skills:['SQL']},v]);
 await until(()=>ui(`document.querySelector('.apply-section-heading h3')?.textContent!=='按简历匹配的岗位'`),'oldModelResultInvalidated');check(true,'oldModelResultInvalidated');
 check((await invoke('jobMatchingState')).status==='stale','hostMarksStale');check((await methods.browserState!()).url==='about:blank'||!(await methods.browserState!()).url,'noEmployerNavigation');
 const discovery = await invoke('discoveryState'), now = new Date().toISOString();
 const webReport = { id:'fixture-public-web-search', startedAt:now, finishedAt:now, status:'partial', plan:{profileVersion:state.profile.version,keywords:['算法'],cities:['北京'],educationSummary:'虚构资料',notes:[]},
   options:{region:'mainland',sourceIds:[],maxSources:8,maxPages:2,pageSize:20,detailLimit:10,includeExperienced:false}, sources:[],unviewedSources:[],uniqueJobs:0,completeDetails:0,duplicateCount:0,scopeNote:'原创虚构搜索界面验收',
   publicSearch:{status:'completed',leads:[{title:'虚构公开招聘线索',url:'https://careers.example.invalid/public-search-fixture',verification:'search-source-only'}],reason:'搜索来源，正文与资格待核实。',totalTokens:123,durationMs:1,observedAt:now}};
 send({type:'discovery',state:{...discovery,runs:[webReport]}} as AppEvent);
 await until(()=>ui(`document.querySelector('[data-testid="public-job-search"]')?.textContent.includes('虚构公开招聘线索')===true`),'webSearchLeadRendered');check(true,'webSearchLeadRendered');
 check(await ui(`document.querySelector('[data-testid="public-job-search"]')?.textContent.includes('待核实')===true`),'webSearchExplicitUnverified');
 check(await ui(`document.querySelectorAll('[data-testid="public-job-search"] button').length===1`),'webLeadOnlyOffersOpenNoTrackerOrSubmit');
 const originalNavigate=methods.browserNavigate!;let opened='';methods.browserNavigate=async(url:string)=>{opened=url;return methods.browserState!();};
 try{await ui(`document.querySelector('[data-testid="public-job-search"] button').click()`);await until(async()=>opened===webReport.publicSearch.leads[0]!.url,'webLeadPassesExactUrlToHost');check(true,'webLeadPassesExactUrlToHost');}finally{methods.browserNavigate=originalNavigate;}
 check((await invoke('getState')).applications.length===0,'webLeadDoesNotCreateApplication');
 const labels=await ui(`(()=>{const fixture=document.createElement('div');fixture.id='owned-label-fixture';fixture.innerHTML='<section><div>个人信息</div><div><div><span>* 姓名</span></div><div><input id="owned-name" placeholder="请输入"></div></div><div><span>邮箱</span><input id="owned-email" placeholder="请输入"></div></section>';document.body.appendChild(fixture);try{return (${READ_FORM}).fields.filter(f=>f.identity.startsWith('owned-')).map(f=>({label:f.label,required:f.required,section:f.section}));}finally{fixture.remove();}})()`);
 check(labels.length===2&&labels[0].label==='* 姓名'&&labels[1].label==='邮箱','actualChromiumReadsNestedDivSpanLabels');
 check(labels[0].required===true&&labels[1].section==='个人信息','actualChromiumRetainsRequiredAndSection');
 return {passed:true,assertions,scope:'hidden production renderer/IPC/store/service and scripted Pi completion; not paid-model or enterprise accuracy evidence',paidRequests:0,employerNavigation:0,submitted:0,modelStatusFixture:true};
}
