export type IdentityDocumentKind = 'national-id' | 'passport';
export interface SensitiveIdentityInput { kind:IdentityDocumentKind; number:string; confirmed:true; }
export interface SensitiveIdentityState {
  version:number; configured:boolean; kind:IdentityDocumentKind|null; maskedNumber:string; confirmedAt:string|null;
  encryptionAvailable:boolean;
}
export interface SensitiveIdentityFillPreview {
  id:string; origin:string; destination:string; maskedNumber:string; kind:IdentityDocumentKind;
  fields:Array<{fieldId:string;label:string}>; expiresAt:string;
}
export interface SensitiveIdentityFillResult { status:'verified'|'needs-user'; verifiedCount:number; message:string; }
export interface SensitiveIdentityAPI {
  sensitiveIdentityState():Promise<SensitiveIdentityState>;
  saveSensitiveIdentity(input:SensitiveIdentityInput,expectedVersion:number):Promise<SensitiveIdentityState>;
  clearSensitiveIdentity(expectedVersion:number):Promise<SensitiveIdentityState>;
  prepareSensitiveIdentityFill():Promise<SensitiveIdentityFillPreview>;
  fillSensitiveIdentity(previewId:string):Promise<SensitiveIdentityFillResult>;
  cancelSensitiveIdentityFill(previewId:string):Promise<void>;
}
