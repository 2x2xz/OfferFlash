/** Replays saved public responses offline; creates a private blind-review page. Never treats model/rule scores as gold. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {collectTencentCampusJobs} from '../packages/sources/src/tencent-campus-discovery.js';
import {collectMainlandJobs,MAINLAND_FEISHU_SOURCES} from '../packages/sources/src/mainland-discovery.js';
import {renderJobReviewHtml} from '../packages/evaluation/src/job-review.js';
import {readResume} from '../packages/profile/src/import.js';
import {matchJob} from '../packages/domain/src/matching.js';
import type {Profile} from '../packages/shared/src/contracts.js';
const flag=(name:string,fallback='')=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const root=resolve('.'),directory=resolve(flag('evidence','.backups/benchmark-20261019/public-jobs-r2'));
if(!directory.startsWith(join(root,'.backups')+'/'))throw new Error('Use private ignored evidence directory');
const digest=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');const metadata=JSON.parse(await readFile(join(directory,'public-summary.json'),'utf8'));const manifest=JSON.parse(await readFile(join(directory,'evidence-manifest.json'),'utf8'));const responses=new Map<string,{status:number;body:string}>();
for(const entry of manifest){const body=await readFile(join(directory,entry.id+'.json'),'utf8');if(digest(body)!==entry.responseSha256)throw new Error('Public evidence digest mismatch');responses.set(entry.method+' '+entry.url,{status:entry.httpStatus,body});}
let replayed=0;const transport:typeof fetch=async(input,init)=>{const entry=responses.get((init?.method??'GET')+' '+String(input));if(!entry)throw new Error('Replay response missing; network fallback forbidden');replayed++;return new Response(entry.body,{status:entry.status,headers:{'content-type':'application/json'}});};
const jobs=[];
const tencent=await collectTencentCampusJobs({keyword:'算法',maxPages:1,pageSize:10,detailLimit:6,totalTimeoutMs:15000},transport);jobs.push(...tencent.jobs);
for(const source of MAINLAND_FEISHU_SOURCES)jobs.push(...(await collectMainlandJobs(source,{maxPages:1,pageSize:10,detailLimit:3,totalTimeoutMs:10000},transport)).jobs);
const items=[...new Map(jobs.map(j=>[j.url,j])).values()].map(j=>({id:'public-'+digest(j.url).slice(0,20),url:j.url,company:j.company,title:j.title,city:j.city,description:j.description,requirements:j.requirements,contentHash:digest(j.description+'\n'+j.requirements)}));
if(items.length!==metadata.jobs.length||items.some(item=>metadata.jobs.find((j:any)=>j.url===item.url)?.contentHash!==item.contentHash))throw new Error('Derived job text differs from captured snapshot');
const snapshotHash=digest(JSON.stringify(items.map(({id,url,contentHash})=>({id,url,contentHash}))));
let profileSnapshotHash:string|null=null;
const resume=flag('resume');
if(resume){profileSnapshotHash=digest(await readFile(resolve(resume)));const imported=await readResume(resolve(resume));if(digest(await readFile(resolve(resume)))!==profileSnapshotHash)throw new Error('Resume changed during extraction');const candidates=imported.career?.educations??[];const masters=candidates.filter(e=>/硕士|master/i.test(e.degree));const selected=masters.length===1?masters[0]:undefined;
 const profile:Profile={version:1,updatedAt:metadata.finishedAt,fullName:'私有简历候选人',fullNameEn:'',email:'',phone:'',school:'',schoolEn:'',degree:selected?.degree??imported.suggested?.degree??'',major:selected?.major??imported.suggested?.major??'',majorEn:'',graduationMonth:/^\d{4}-(?:0[1-9]|1[0-2])/.test(selected?.endDate??'')?selected!.endDate.slice(0,7):imported.suggested?.graduationMonth??'',skills:imported.suggested?.skills??[],cities:[],targetRoles:['AI','大模型','算法'],resumeText:''};
 const ranked=jobs.map(job=>({url:job.url,title:job.title,company:job.company,match:matchJob(profile,job,new Date(metadata.finishedAt))})).sort((a,b)=>b.match.score-a.match.score||a.url.localeCompare(b.url));
 await writeFile(join(directory,'personal-cv-candidates.private.json'),JSON.stringify({source:'user-explicit-resume-file',sourceHash:profileSnapshotHash,factsStatus:'extracted-candidates-not-current-app-confirmation',contactDetailsRemoved:true,schoolNameRemoved:true,normalAppDatabaseRead:false,modelReceivedFacts:false,fullResumeStored:false,profile,ranked,humanGold:false,cvMatchAccuracy:null,notes:['规则分数只是待评阅排序，不是正确率或录用概率。','城市未从简历推断为求职偏好。','真实简历候选事实未写入正常应用或公开仓库。','人工标注页初始标签为空，并且不显示这里的排序分数以减少锚定偏差。']},null,2),{mode:0o600});
}
await writeFile(join(directory,'review-source.private.json'),JSON.stringify({snapshotHash,profileSnapshotHash,items},null,2),{mode:0o600});await writeFile(join(directory,'job-review.private.html'),renderJobReviewHtml({snapshotHash,profileSnapshotHash,items}),{mode:0o600});
console.log(JSON.stringify({offlineReplayRequests:replayed,jobs:items.length,blindReviewPrepared:true,resumeCandidatesPrepared:!!resume,actualHumanLabels:0,externalNetworkRequests:0,publicRedistribution:false}));
