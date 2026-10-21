import {createHash} from 'node:crypto';
/** Local, bounded per-document hints. Entries never authorize a write or become facts. */
export class FormAttemptMemory {
 private entries=new Map<string,{fingerprint:string;failure?:string;options?:string[]}>();
 readonly guidanceChoices=new Map<string,{value:string;policy:string}>();
 // Shared by runs of the same actual document, independent of model/profile changes.
 constructor(readonly unknownAddKinds=new Set<string>()){}
 lastDecisionFingerprint?:string;
 hasEntries(){return this.entries.size>0;}
 get(key:string|undefined,fingerprint:string){if(!key)return;const entry=this.entries.get(key);return entry?.fingerprint===fingerprint?entry:undefined;}
 put(key:string|undefined,fingerprint:string,value:{failure?:string;options?:string[]}){if(!key)return;this.entries.delete(key);this.entries.set(key,{fingerprint,...value});while(this.entries.size>800)this.entries.delete(this.entries.keys().next().value!);}
 resetFailures(){for(const [key,entry]of this.entries){delete entry.failure;if(!entry.options)this.entries.delete(key);}this.lastDecisionFingerprint=undefined;}
}
export const formStateDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
