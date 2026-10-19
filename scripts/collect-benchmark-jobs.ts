/** Anonymous public facts only. Raw responses stay in an ignored local evidence directory. */
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {collectTencentCampusJobs} from '../packages/sources/src/tencent-campus-discovery.js';
import {collectMainlandJobs,MAINLAND_FEISHU_SOURCES} from '../packages/sources/src/mainland-discovery.js';
const root=resolve('.'),output=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??'.backups/benchmark-20261019/public-jobs');
if(!output.startsWith(join(root,'.backups')+'/'))throw new Error('Use an ignored local evidence directory');
try{await stat(output);throw new Error('Evidence directory must be fresh');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
await mkdir(output,{recursive:true,mode:0o700});const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const evidence:Array<{id:string;url:string;method:string;httpStatus:number;responseSha256:string;bytes:number}>=[];
const allowedHosts=new Set(['join.qq.com',...MAINLAND_FEISHU_SOURCES.map(s=>s.hostname)]);
const transport:typeof fetch=async(input,init)=>{const url=new URL(String(input));if(url.protocol!=='https:'||!allowedHosts.has(url.hostname)||url.username||url.password||init?.credentials!=='omit'||init?.redirect!=='error')throw new Error('Unapproved source request');
 const response=await fetch(input,init);const body=await response.clone().text();if(body.length>4_000_000)throw new Error('Evidence body too large');const id='response-'+(evidence.length+1);await writeFile(join(output,id+'.json'),body,{mode:0o600});evidence.push({id,url:url.href,method:init.method??'GET',httpStatus:response.status,responseSha256:digest(body),bytes:Buffer.byteLength(body)});return response;};
const sources:any[]=[],jobs:any[]=[];const startedAt=new Date().toISOString();
for(const source of [{id:'tencent-campus',name:'腾讯校招'},...MAINLAND_FEISHU_SOURCES]){let result:any;
 try{result=source.id==='tencent-campus'?await collectTencentCampusJobs({keyword:'算法',maxPages:1,pageSize:10,detailLimit:6,totalTimeoutMs:15000},transport):await collectMainlandJobs(source as typeof MAINLAND_FEISHU_SOURCES[number],{maxPages:1,pageSize:10,detailLimit:3,totalTimeoutMs:10000},transport);
  sources.push({sourceId:source.id,sourceName:source.name,status:result.report.status,stopReason:result.report.stopReason,listed:result.report.listedCount,completeDetails:result.report.detailSucceeded,officialReportedTotal:result.report.officialTotal,globalRecall:null,coverageKnown:false,requestCount:result.metadata.requestCount??result.metadata.requests});
  for(const job of result.jobs){const url=new URL(job.url);jobs.push({company:job.company,title:job.title,city:job.city,type:job.type,url:url.href,sourceId:source.id,publishedAt:job.publishedAt,deadline:job.deadline,observedAt:job.observedAt??new Date().toISOString(),descriptionNonempty:!!job.description.trim(),requirementsNonempty:!!job.requirements.trim(),contentHash:digest(job.description+'\n'+job.requirements)});}
 }catch(error){sources.push({sourceId:source.id,sourceName:source.name,status:'failed',code:error instanceof TypeError?'LOCAL_BUDGET_OR_SCHEMA_REJECTED':'PUBLIC_SOURCE_REQUEST_FAILED',globalRecall:null,coverageKnown:false});}
}
const unique=[...new Map(jobs.map(j=>[j.url,j])).values()];const summary={schemaVersion:1,startedAt,finishedAt:new Date().toISOString(),scope:'bounded-anonymous-official-sources',sourceCount:sources.length,requests:evidence.length,successfulHTTP:evidence.filter(e=>e.httpStatus===200).length,sources,jobs:unique,duplicates:jobs.length-unique.length,fullWebRecall:null,cvRelevanceEvaluated:false,humanLabels:false,normalUserDataRead:false,paidModelCalls:0,submissions:0,notes:['本轮只核对有限官网响应和有界详情，不宣称国内岗位找全。','发布时间与采集时间分开，缺少官网发布日期保留null。','岗位与个人CV相关性尚需独立标注，不拿采集器自身分数当gold。','raw响应仅本地留证据，不随项目上传。']};
await writeFile(join(output,'evidence-manifest.json'),JSON.stringify(evidence,null,2),{mode:0o600});await writeFile(join(output,'public-summary.json'),JSON.stringify(summary,null,2),{mode:0o600});
await writeFile(join(output,'review-template.json'),JSON.stringify({snapshotHash:digest(JSON.stringify(summary)),labelStatus:'unjudged',labels:unique.map(j=>({url:j.url,title:j.title,company:j.company,relevance:null,eligibility:'unknown',rationale:'',reviewer:'',reviewedAt:null}))},null,2),{mode:0o600});
console.log(JSON.stringify({sources:sources.length,requests:evidence.length,http200:evidence.filter(e=>e.httpStatus===200).length,uniqueJobs:unique.length,allSourcesPartialOrUncovered:sources.some(s=>s.status!=='success'),cvRelevanceEvaluated:false,fullWebRecall:null}));
