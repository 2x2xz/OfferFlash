/** Diagnostic audit only; primary scoring remains the unchanged original scorer. */
import {readFile,writeFile} from 'node:fs/promises';import {join,dirname} from 'node:path';
const path=process.argv[2],r=JSON.parse(await readFile(path,'utf8'));if(r.status!=='completed')throw Error('Completed run required');
let conditionalFields=0,conditionalBlank=0,conditionalUnresolved=0,conditionalWrites=0,conflictReviews=0,conflictTargetsBlank=0,conflictUnresolved=0,conflictWrites=0,totalReminders=0,toolErrors=0,budgetFailures=0;
const conditional=label=>/\bif\s+(?:different|applicable|yes|any)\b|\b(?:previous|former|other|alternate|maiden)\s+(?:(?:legal|full)\s+)?names?\b|如.{0,12}(?:不同|适用|有)|曾用名/i.test(label)&&/\bname\b|\bnames\b|姓名|曾用名/i.test(label);
for(const arm of r.arms)for(let i=0;i<r.caseCount;i++){
 const d=JSON.parse(await readFile(join(dirname(path),`${arm.id}-${i}.private.json`),'utf8')),e=d.audit?.agent,before=d.audit?.before?.observation?.fields??[],after=d.later?.after?.observation?.fields??[],writes=d.audit?.writeStatuses??[];
 for(const f of before.filter(f=>conditional(f.label)&&!f.value.trim())){conditionalFields++;const matches=after.filter(a=>a.identity===f.identity&&a.label===f.label&&a.type===f.type);if(matches.length!==1)conditionalUnresolved++;else if(!matches[0].value.trim())conditionalBlank++;
  conditionalWrites+=writes.filter(w=>w.status==='written'&&w.label===f.label).length;}
 totalReminders+=e?.reviewFields?.length??0;toolErrors+=(e?.events??[]).filter(x=>x.type==='tool_finished'&&x.data.isError).length;
 budgetFailures+=Number(e?.failure==='model-request-or-budget');
 for(const note of e?.reviewFields??[]){if(!/重复或冲突/.test(note.reason))continue;conflictReviews++;const initial=before.filter(f=>f.label===note.label),final=after.filter(f=>f.label===note.label);
  if(initial.length!==1||final.length!==1)conflictUnresolved++;else if(!initial[0].value.trim()&&!final[0].value.trim())conflictTargetsBlank++;
  conflictWrites+=writes.filter(w=>w.status==='written'&&w.label===note.label).length;}
}
const result={primaryScoringChanged:false,conditionalFields,conditionalBlank,conditionalUnresolved,conditionalWrites,conflictReviews,conflictTargetsBlank,conflictUnresolved,conflictWrites,totalReminders,toolErrors,budgetFailures,
 remindsOnly:true,automaticallyAddedProfileFacts:false};
if(conditionalWrites||conflictWrites)throw Error('A prohibited conditional/conflict write remains; retain raw evidence');
await writeFile('docs/background-agent-conditional-diagnostics.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
