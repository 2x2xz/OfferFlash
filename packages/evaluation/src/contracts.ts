import type {RankingEvaluation} from './ranking-scoring.js';
import type {FormScore} from './form-scoring.js';
import type {RetrievalMetrics} from './retrieval.js';
import type {AcquisitionCaseResult} from './acquisition.js';
export interface RankingRun {personaId:string;split:'dev'|'test';engine:string;ranking:string[];durationMs:number;metrics:Record<string,RankingEvaluation>;errorCode?:string;requestId?:string;}
export interface FormRun {caseId:string;split:'dev'|'test';engine:string;repeat:number;durationMs:number;status:'succeeded'|'partial'|'failed'|'blocked';score:FormScore;errorCode?:string;requestId?:string;traceId?:string;independentFinalRead:boolean;mutationAuditAvailable:boolean;environmentMutations:number;submissions:number|null;filesTouched?:number|null;clicks?:number|null;cleanStartConfirmed?:boolean;backgroundFocusPreserved?:boolean|null;geometry?:{scrollHeight:number;initialOffscreenFields:string[];finalScrollY:number};fieldValidityPassed?:boolean;}
export interface RetrievalRun {queryId:string;split:'dev'|'test';engine:'lexical-bm25';ranking:string[];durationMs:number;metrics:Record<string,RetrievalMetrics>;expectedNoAnswer:boolean;correctNoAnswer:boolean|null;}
export interface BenchmarkReport {
 schemaVersion:1;id:string;createdAt:string;labelProvenance:'authored-synthetic-diagnostic';independentHumanGold:false;
 protocol:{id:string;asOf:string;hash:string;sourceHashes:Record<string,string>;codeHash:string;codeFrozen:boolean};
 matching:RankingRun[];forms:FormRun[];retrieval:RetrievalRun[];acquisition:AcquisitionCaseResult[];
 efficiency:unknown;live:{requested:boolean;provider:string;model:string;requestAttempts:number;completedResponses:number;status:string;usageFromProvider:boolean};
 traces:unknown[];limitations:string[];browserEvidence:{run:boolean;engines:string[];externalRequests:number|null;normalUserDataRead:false;submissions:number|null;errorCode?:string};
}
