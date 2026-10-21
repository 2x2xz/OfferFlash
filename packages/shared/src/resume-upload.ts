export interface ResumeUploadTarget {id:string;label:string;accept:string;recommended:boolean;hasAttachment?:boolean;}
export interface ResumeUploadInspection {url:string;tabId?:string;documentRevision:number;targets:ResumeUploadTarget[];parsing?:boolean;needsOverwriteChoice?:boolean;formDigest?:string;}
export interface ResumeUploadRequest {resumeVersionId:string;profileVersion:number;page:ResumeUploadInspection;targetId:string;force?:boolean;}
export interface ResumeUploadReceipt {status:'selected'|'already-selected';fileName:string;destination:string;message:string;}
