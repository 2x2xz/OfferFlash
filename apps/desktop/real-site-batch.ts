/** App-owned batch QA: production import/store/matching/queue, no UI robot and no submission. */
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {readResume} from '../../packages/profile/src/import.js';
import {pickCareerInput} from '../../packages/profile/src/career-input.js';
import type {BackgroundQueueHost} from './background-queue.js';

// Unverified discovery seeds, not a count of working companies. Only actual forms count.
const lever=['portcast','palantir','spotify','atlassian','wealthsimple','stackadapt','sonatype','matchgroup','junglescout','unitedmasters','appen','voodoo','mistral','netflix','zoox','shieldai','skydio','nuro','weride','aurora','waabi','anyscale','nansen','chainalysis','anchorage','kraken','binance','okx','crypto','gohighlevel','fullscript','jobber','clio','tophat','ada','ritual','hometap','ezcater','flywire','ro','sprinterhealth','color','swordhealth','includedhealth','cerebral','calm','headspace','springhealth','modernhealth','lyrahealth','hingehealth','athenas','pendo','outreach','salesloft','gong','qualified','clari','6sense','drift','podium','highspot','seismic','showpad','mindtickle','avetta','tekion','tekmetric','foxtrot','attentive','turing','toptal','automattic','crowdbotics','launchdarkly','postman','browserstack','sentry','snyk','datadog','aircall','dialpad','talkdesk','lever','lattice','cultureamp','15five','leapsome','personio','remote','oyster','papaya','velocityglobal','rippling','neon','prisma','retool','webflow','typeform','airtable'];
const greenhouse=['verantos','anthropic','stripe','figma','cloudflare','airbnb','dropbox','robinhood','reddit','discord','pinterest','duolingo','lyft','doordashusa','coinbase','hubspotjobs','mongodb','elastic','gitlab','snowflake','gusto','checkr','brex','plaid','scaleai','andurilindustries','spacex','databricks','datadog','dataminr','sentinellabs','okta','auth0','twilio','segment','asana','asana2','mondaycom','miro','canva','grammarly','coursera','udemy','quizlet','roblox','unity3d','epicgames','riotgames','duolingo','verkada','samsara','motional','aurora','cruise','affirm','chime','sofi','marqeta','adyen','checkoutcom','ripple','stellar','circle','blockchain','alchemysights','chainlinklabs','opengov','carta','justworks','toast','ezcater','freshworks','sproutsocial','klaviyo','braze','amplitude','mixpanel','heap','harness','circleci','dbtlabs','fivetran','airbyte','confluent','cockroachlabs','redis','singleStore','timescale','planetscale','yugabyte','influxdata','grafanalabs','pulumi','hashicorp','gitbook','sourcegraph','coder','tailscale','temporaltechnologies','launchdarkly','postman'];
const seeds=[...lever.map(board=>({provider:'lever',board})),...greenhouse.map(board=>({provider:'greenhouse',board}))];
const companyKey=(name:string)=>name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/(?:incorporated|inc|limited|ltd|llc)$/,'');
const boardKey=(raw:string)=>{const u=new URL(raw);return u.hostname.toLowerCase()+':'+u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();};
const plain=(s:string)=>s.replace(/<[^>]+>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim();
const profileInput=(p:any)=>{const{version,updatedAt,...input}=p;return {...input,career:pickCareerInput(p.career)};};
async function json(url:string){const r=await fetch(url,{method:'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}});if(!r.ok)throw new Error(`HTTP_${r.status}`);const text=await r.text();if(text.length>4_000_000)throw new Error('SOURCE_TOO_LARGE');return JSON.parse(text);}
async function collect(seed:typeof seeds[number]){
  if(seed.provider==='lever'){
    const rows=await json(`https://api.lever.co/v0/postings/${encodeURIComponent(seed.board)}?mode=json&limit=100`);
    if(!Array.isArray(rows))throw new Error('SOURCE_SCHEMA');
    const job=[...rows].sort((a,b)=>Number(/engineer|developer|scientist|data/i.test(b.text))-Number(/engineer|developer|scientist|data/i.test(a.text))).find(j=>typeof j.applyUrl==='string'&&typeof j.id==='string');
    if(!job)throw new Error('NO_OPEN_JOB');const url=new URL(job.applyUrl);if(url.protocol!=='https:'||url.hostname!=='jobs.lever.co'||!url.pathname.startsWith('/'+seed.board+'/')||!url.pathname.endsWith('/apply'))throw new Error('UNEXPECTED_APPLICATION_URL');
    return {company:seed.board,title:String(job.text),city:String(job.categories?.location??''),description:plain(String(job.descriptionPlain??job.description??''))+' '+(job.lists??[]).map((l:any)=>plain(String(l.content??''))).join(' '),url:url.href};
  }
  const list=await json(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(seed.board)}/jobs`);
  if(!Array.isArray(list.jobs))throw new Error('SOURCE_SCHEMA');
  const job=[...list.jobs].sort((a,b)=>Number(/engineer|developer|scientist|data/i.test(b.title))-Number(/engineer|developer|scientist|data/i.test(a.title))).find(j=>Number.isSafeInteger(j.id));if(!job)throw new Error('NO_OPEN_JOB');
  const detail=await json(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(seed.board)}/jobs/${job.id}?questions=true`);
  if(typeof detail.company_name!=='string'||typeof detail.title!=='string')throw new Error('DETAIL_SCHEMA');
  return {company:detail.company_name,title:detail.title,city:String(detail.location?.name??''),description:plain(String(detail.content??'')),url:`https://job-boards.greenhouse.io/${encodeURIComponent(seed.board)}/jobs/${job.id}`};
}

export async function runRealSiteBatch(o:{directory:string;resumePath:string;replayPath?:string;extendReplay?:boolean;target?:number;priorForms?:number;methods:Record<string,(...args:any[])=>Promise<any>>;queue:BackgroundQueueHost;notify:(text:string)=>void}){
  await mkdir(o.directory,{recursive:true,mode:0o700});const results:any[]=[],sources:any[]=[],seen=new Set<string>(),seenBoards=new Set<string>();let forms=0;
  const report:any={scope:'full-app-production-background-queue',target:100,actualForms:0,completedCompanies:0,foregroundButtonRuns:0,realModelRequests:0,mode:'rules',startedAt:new Date().toISOString(),status:'running',results,sources,
    uiFilePickerTested:false,normalUIRendererLoaded:true,importParserAndSaveAPITest:true,normalQueueAndMatchingAPI:true,semanticAccuracyClaim:false,submissionAcceptanceClaim:false};
  async function save(){report.actualForms=forms;report.completedCompanies=results.length;const p=join(o.directory,'batch-progress.json');await writeFile(p+'.tmp',JSON.stringify(report,null,2),{mode:0o600});await rename(p+'.tmp',p);}
  try{
    const initial=await o.methods.getState!();if(initial.profile.version!==0||initial.jobs.length)throw new Error('EMPTY_QA_INSTANCE_REQUIRED');
    const imported=await readResume(o.resumePath);report.import={educations:imported.career?.educations.length,internships:imported.career?.internships.length,projects:imported.career?.projects.length,publications:imported.career?.publications.length,phoneExtracted:!!imported.suggested?.phone};
    let state=await o.methods.saveProfile!({...profileInput(initial.profile),...imported.suggested,fullNameEn:'OfferFlash QA',school:'',schoolEn:'',degree:'',major:'',majorEn:'',graduationMonth:'',career:imported.career,resumeText:imported.text,targetRoles:['Software Engineer','AI','LLM'],cities:[]},initial.profile.version);
    for(const collection of ['educations','internships','projects','publications'])for(const record of [...state.profile.career[collection]])state=await o.methods.confirmCareerRecord!(collection,record.id,state.profile.version,record.revision);
    const profile=state.profile;const career=pickCareerInput(profile.career);career.primaryEducationId=career.educations.find(e=>e.school==='虚构海港大学')?.id??null;
    state=await o.methods.saveProfile!({...profileInput(profile),career},profile.version);report.profileVersion=state.profile.version;await save();
    const replay=o.replayPath?JSON.parse(await readFile(o.replayPath,'utf8')) as any[]:undefined;
    if(replay&&(!Array.isArray(replay)||replay.length<1||replay.length>300||replay.some(j=>typeof j.company!=='string'||typeof j.title!=='string'||!/^https:\/\/(?:jobs\.lever\.co|job-boards\.greenhouse\.io)\//.test(j.url)||new URL(j.url).search)))throw new Error('INVALID_REPLAY');
    report.target=o.target??(o.extendReplay?100:replay?.length??100);if(!Number.isSafeInteger(report.target)||report.target<1||report.target>100)throw new Error('INVALID_TARGET');
    report.priorForms=o.priorForms??0;if(!Number.isSafeInteger(report.priorForms)||report.priorForms<0||report.priorForms+report.target>100)throw new Error('INVALID_PRIOR_COUNT');report.replay=!!replay;
    report.sourceAttribution=o.extendReplay?[{name:'Himalayas',url:'https://himalayas.app/api',scope:'internal test leads only; employer form independently loaded; no publication'}]:[];await save();
    async function* work(){
      if(replay)for(const job of replay)yield {provider:job.provider,board:job.company,job};
      if(o.extendReplay){
        let cursor:string|undefined;
        for(let page=0;page<50;page++){
          const url=new URL('https://himalayas.app/jobs/api');url.searchParams.set('limit','20');if(cursor)url.searchParams.set('cursor',cursor);
          let data:any;try{data=await json(url.href);sources.push({key:'himalayas-page-'+page,status:'lead-page-read',attribution:'https://himalayas.app/api'});}catch{sources.push({key:'himalayas-page-'+page,status:'lead-source-blocked'});break;}
          if(!Array.isArray(data.jobs))break;
          for(const row of data.jobs){
            let u:URL;try{u=new URL(row.applicationLink);}catch{continue;}
            if(u.protocol!=='https:'||u.username||u.password||u.port||typeof row.companyName!=='string'||typeof row.title!=='string')continue;
            let provider:string;
            if(u.hostname==='jobs.lever.co'&&/^\/[a-zA-Z0-9_.-]+\/[a-f0-9-]{36}(?:\/apply)?\/?$/.test(u.pathname)){provider='lever';u.pathname=u.pathname.replace(/\/$/,'').replace(/(?:\/apply)?$/,'/apply');}
            else if(['job-boards.greenhouse.io','boards.greenhouse.io'].includes(u.hostname)&&/^\/[a-zA-Z0-9_.-]+\/jobs\/\d+\/?$/.test(u.pathname)){provider='greenhouse';u.hostname='job-boards.greenhouse.io';}
            else continue;
            u.search='';u.hash='';
            yield {provider,board:row.companyName,job:{provider,company:row.companyName.trim().slice(0,120),title:row.title.slice(0,300),url:u.href,sourceLead:'Himalayas',description:plain(String(row.description??'')).slice(0,20000),city:''}};
          }
          if(typeof data.nextCursor!=='string'||!data.nextCursor||data.nextCursor===cursor||data.nextCursor.length>2048)break;cursor=data.nextCursor;await delay(1100);
        }
      }
      if(!replay||o.extendReplay)for(const seed of seeds)yield {...seed,job:undefined};
    }
    for await(const seed of work()){
      if(forms>=report.target)break;const key=seed.provider+':'+seed.board;if(sources.some(s=>s.key===key))continue;
      o.notify(`实际表单 ${report.priorForms+forms}/100 · 正在检查 ${seed.board}`);
      let job:any;try{job=seed.job?{company:seed.job.company,title:seed.job.title,url:seed.job.url,city:String(seed.job.city??''),description:String(seed.job.description??'').slice(0,20000)}:await collect(seed);sources.push({key,status:seed.job?'frozen-public-url-replay':'public-job-read'});}catch(e){sources.push({key,status:'source-blocked',code:e instanceof Error?e.message:'UNKNOWN'});await save();continue;}
      const entity=companyKey(job.company),board=boardKey(job.url);if(seen.has(entity)||seenBoards.has(board)){sources.at(-1).status='duplicate-company';await save();continue;}seen.add(entity);seenBoards.add(board);
      const id='qa-'+createHash('sha256').update(entity).digest('hex').slice(0,16);const started=performance.now();let entry:any={company:job.company,provider:seed.provider,url:job.url,title:job.title,status:'starting',realFormObserved:false};
      let itemId:string|undefined;
      try{
        const s=await o.methods.saveJob!({...job,id,type:'unknown',requirements:'',sourceId:'real-site-qa-public-'+seed.provider,sourceName:'公开官网测评采集',publishedAt:null,deadline:null,demo:false});entry.match=s.jobs.find((j:any)=>j.id===id)?.match;
        await o.methods.trackJob!(id);const q=await o.methods.enqueueApplications!({jobIds:[id],profileVersion:state.profile.version,acknowledgeAutosave:true});itemId=q.items.find((i:any)=>i.jobId===id)?.id;
        await o.methods.startApplicationQueue!();const until=Date.now()+45000;
        while(o.queue.hasPendingMutation()&&Date.now()<until)await delay(100);
        if(o.queue.hasPendingMutation()){await o.queue.cancel();entry.deadlineReached=true;}
        const item=o.queue.state().items.find(i=>i.id===itemId);entry.queueResult=item;
        const audit:any=itemId?await o.queue.qaEvidence(itemId):null;
        if(audit){await delay(300);const later=await o.queue.qaEvidence(itemId!);await writeFile(join(o.directory,id+'.private.json'),JSON.stringify({audit,later},null,2),{mode:0o600});
          const before=audit.before?.observation?.fields??[],after=later?.after?.observation?.fields??[];
          const name=before.some((f:any)=>/^(?:full |first |last )?name(?:\s*[*✱])?$/i.test(f.label.trim()));const email=before.some((f:any)=>/email|e-mail/i.test(f.label));
          entry.realFormObserved=name&&email&&(audit.before?.protected?.some((p:any)=>p.type==='file')??false);
          entry.observedFields=before.length;entry.changedFields=after.filter((f:any)=>{const old=before.find((b:any)=>b.index===f.index&&b.identity===f.identity);return old&&old.value!==f.value;}).map((f:any)=>({index:f.index,label:f.label,type:f.type}));
          entry.protectedUnchanged=JSON.stringify(audit.before?.protected)===JSON.stringify(later?.after?.protected);
          entry.contactAudit=after.flatMap((f:any)=>{const label=f.label.replace(/[*✱:：]/g,'').trim().toLowerCase();const expected=['name','full name'].includes(label)?'OfferFlash QA':['email','email address','e-mail'].includes(label)?'offerflash-validation@example.invalid':undefined;return expected===undefined?[]:[{index:f.index,label:f.label,correct:f.value===expected,empty:!f.value,wrong:!!f.value&&f.value!==expected}];});
          entry.independentReadStable=JSON.stringify(audit.after.observation.fields.map((f:any)=>[f.index,f.value]))===JSON.stringify(after.map((f:any)=>[f.index,f.value]));
          if(entry.realFormObserved)forms++;
        }
        entry.status=entry.realFormObserved?'real-form-executed':'page-blocked-or-not-application';
      }catch(e){entry.status='failed';entry.code=e instanceof Error?e.name:'UnknownError';}
      finally{if(itemId&&!o.queue.hasPendingMutation())o.queue.close(itemId);entry.durationMs=performance.now()-started;results.push(entry);await save();}
    }
    report.status=forms>=report.target?'completed':'incomplete-source-catalog-exhausted';report.finishedAt=new Date().toISOString();await save();o.notify(`本轮结束：累计真实表单 ${report.priorForms+forms}/100；结果已保存`);
  }catch(e){report.status='failed';report.errorName=e instanceof Error?e.name:'UnknownError';await save();throw e;}
}
