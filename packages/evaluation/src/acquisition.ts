import {collectTencentCampusJobs} from '../../sources/src/tencent-campus-discovery.js';
export interface AcquisitionCaseResult {id:string;scope:'controlled-official-api-schema-fixture';networkRequests:number;externalRequests:0;status:string;stopReason:string;expectedIds:string[];observedIds:string[];idRecall:number;idPrecision:number|null;duplicateReturnCount:number;detailCoverage:number;correctDetailFields:number;expectedDetailFields:number;officialReportedTotal:number|null;claimedComplete:boolean;shouldBeComplete:boolean;falseCompletenessClaim:boolean;requestsAudited:boolean;}
/** Known finite API universe and independent detail facts, never labels from matchJob. */
export async function benchmarkAcquisition():Promise<AcquisitionCaseResult[]> {
 const outputs:AcquisitionCaseResult[]=[];
 const universe=['90101','90102','90103','90104'];
 const envelope=(data:unknown)=>new Response(JSON.stringify({status:0,message:'',data}),{status:200});
 for(const scenario of ['exhaustive','page-budget','bad-detail','repeat-page']){
  let requests=0,requestsAudited=true;
  const transport:typeof fetch=async(input,init)=>{
   requests++;const url=new URL(String(input));if((url.pathname.endsWith('/searchPosition')?init?.method!=='POST':init?.method!=='GET'))requestsAudited=false;if(url.origin!=='https://join.qq.com'||init?.credentials!=='omit'||init.redirect!=='error')throw new Error('Unapproved acquisition request');
   if(url.pathname.endsWith('/getProjectMapping'))return envelope([{recruitType:1,status:1,subProjectList:[{mappingId:1,recruitType:1,projectId:'1',projectName:'2027校园招聘',recruitYear:'2027',status:1,recruitRangDesc:'毕业时间：2026年1月1日-2027年12月31日'}]}]);
   if(url.pathname.endsWith('/searchPosition')){const body=JSON.parse(String(init?.body));if(body.workCountryType!==1||body.keyword!=='算法'||body.pageSize!==2||JSON.stringify(body.projectMappingIdList)!=='[1]')requestsAudited=false;const page=body.pageIndex;const ids=scenario==='repeat-page'?universe.slice(0,2):universe.slice((page-1)*2,page*2);return envelope({count:4,positionList:ids.map(postId=>({postId,positionTitle:'原创评测算法岗'+postId,projectId:1,projectName:'应届毕业生',recruitLabelName:'应届毕业生',workCities:'北京'}))});}
   if(!url.pathname.endsWith('/getJobDetailsByPostId'))throw new Error('Unknown fixture endpoint');
   const postId=url.searchParams.get('postId');if(!universe.includes(postId??''))throw new Error('Unknown fixture job');
   return envelope({postId:scenario==='bad-detail'&&postId==='90103'?'99999':postId,title:'原创评测算法岗'+postId,projectId:1,projectName:'应届毕业生',recruitLabelName:'应届毕业生',recruitType:1,desc:'原创职责：实现离线检索模型及评测。',request:'任职要求：Python，硕士学历，2027届。',workCityList:['北京']});
  };
  const result=await collectTencentCampusJobs({keyword:'算法',maxPages:scenario==='page-budget'?1:3,pageSize:2,detailLimit:4},transport);
  const allIds=result.jobs.map(job=>new URL(job.url).searchParams.get('postid')!);const observedIds=[...new Set(allIds)].sort();
  const expectedIds=universe;let correct=0;const scoredIds=new Set<string>();
  for(const job of result.jobs){const id=new URL(job.url).searchParams.get('postid');if(!id||scoredIds.has(id))continue;scoredIds.add(id);correct+=Number(job.title==='原创评测算法岗'+id)+Number(job.city.includes('北京'))+Number(job.description.includes('原创职责：实现离线检索模型及评测。'))+Number(job.requirements.includes('任职要求：Python，硕士学历，2027届。'));}
  const shouldBeComplete=scenario==='exhaustive';
  outputs.push({id:scenario,scope:'controlled-official-api-schema-fixture',networkRequests:requests,externalRequests:0,status:result.report.status,stopReason:result.report.stopReason,expectedIds,observedIds,idRecall:observedIds.filter(id=>expectedIds.includes(id)).length/expectedIds.length,idPrecision:observedIds.length?observedIds.filter(id=>expectedIds.includes(id)).length/observedIds.length:null,correctDetailFields:correct,expectedDetailFields:observedIds.length*4,duplicateReturnCount:allIds.length-observedIds.length,detailCoverage:correct/(universe.length*4),officialReportedTotal:result.report.officialTotal,claimedComplete:result.report.status==='success',shouldBeComplete,falseCompletenessClaim:result.report.status==='success'&&!shouldBeComplete,requestsAudited:requestsAudited&&result.metadata.requestCount===requests});
 }
 return outputs;
}
