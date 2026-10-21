export interface EducationFillSetup {recordId:string;sourceRevision:number;major:string;category:string;fallbackMajor:string;awardDate:string;}
export interface ApplicationSetupInput {
 resumeVersionId:string|null;autoUploadResume:boolean;educations:EducationFillSetup[];
 hometown:string;politicalStatus:string;interviewPreference:string;acceptTransfer:'ask'|'yes'|'no';
 recruitmentSource:string;recruitmentSourceFallback:string;awards:'unknown'|'none'|'provided';
 companyAnswers:Array<{origin:string;company:string;hasRelatives:'ask'|'yes'|'no'}>;
}
export interface ApplicationSetupState {version:number;confirmedAt:string|null;profileVersion:number|null;value:ApplicationSetupInput;encryptionAvailable:boolean;}
export function emptyApplicationSetup():ApplicationSetupInput{return{resumeVersionId:null,autoUploadResume:false,educations:[],hometown:'',politicalStatus:'',interviewPreference:'',acceptTransfer:'ask',recruitmentSource:'',recruitmentSourceFallback:'',awards:'unknown',companyAnswers:[]};}
