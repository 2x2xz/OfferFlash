import type {Job,RecruitmentType} from './contracts.js';
export interface JobMatchingRequest {expectedVersion:number;jobIds?:string[];region?:'mainland'|'overseas';includeCareerDetails:boolean;intent?:string;}
export interface JobRetrievalSummary {
 version:string;mode:'lexical'|'semantic'|'hybrid';scopeCount:number;scannedCount:number;eligibleCount:number;selectedCount:number;cutoff:number;intent:string;
 embeddingRequests:number;embeddingInputTokens:number;embeddingCacheHits:number;embeddingModel:string;embeddingTruncatedCount:number;durationMs:number;warning?:string;
}
export interface JobMatchingUsage {input:number;output:number;cacheRead:number;cacheWrite:number;totalTokens:number;}
export interface JobMatchingState {
 status:'idle'|'running'|'completed'|'failed'|'cancelled'|'stale';profileVersion:number|null;candidateIds:string[];candidateTokens:Record<string,string>;ranking:string[];
 proofs?:Record<string,{cvQuote:string;jobQuote:string}>;evidenceRejected?:number;retrieval?:JobRetrievalSummary;wholeLibrary?:boolean;
 modelId:string;checkedAt:string;message:string;libraryCount:number;comparedCount:number;hardRejected:number;requests:number;usage:JobMatchingUsage|null;
}
/** Content token is only a UI staleness check; the host owns input hashing and execution. */
export function jobMatchingToken(job:Pick<Job,'id'|'url'|'title'|'city'|'type'|'description'|'requirements'|'publishedAt'|'deadline'>):string{
 return JSON.stringify([job.id,job.url,job.title,job.city,job.type,job.description,job.requirements,job.publishedAt,job.deadline]);
}
export interface MatchingPreferences {region:'mainland'|'overseas';acceptedRecruitmentTypes?:RecruitmentType[];fullTimeExperienceYears?:number;unknownCityRequiresReview?:boolean;}
