import {isJobDeadlineExpired}from'../../domain/src/matching.js';
import type{AppState}from'../../shared/src/contracts.js';import type{JobMatchingState}from'../../shared/src/job-matching.js';import{jobMatchingToken}from'../../shared/src/job-matching.js';
const cache=new WeakMap<object,JobMatchingState>();
export function rememberJobMatching(api:object,state:JobMatchingState){cache.set(api,structuredClone(state));}
export function cachedJobMatching(api:object){return cache.get(api);}
export function currentJobMatching(state:Pick<AppState,'profile'|'jobs'>,matching:JobMatchingState|undefined){
 return matching?.profileVersion===state.profile.version&&(!matching.wholeLibrary||state.jobs.filter(j=>!j.demo).length===matching.candidateIds.length)&&matching.candidateIds.every(id=>{const job=state.jobs.find(j=>j.id===id);return !!job&&jobMatchingToken(job)===matching.candidateTokens[id];})&&matching.ranking.every(id=>{const job=state.jobs.find(j=>j.id===id);return !!job&&!isJobDeadlineExpired(job.deadline,new Date());})?matching:undefined;
}
export function modelMatchedJobs(state:Pick<AppState,'profile'|'jobs'>,matching:JobMatchingState|undefined){const current=currentJobMatching(state,matching);return current?.status==='completed'?current.ranking.map(id=>state.jobs.find(j=>j.id===id)).filter((j):j is AppState['jobs'][number]=>!!j):undefined;}
