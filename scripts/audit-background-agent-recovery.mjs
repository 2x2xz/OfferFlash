/** Independent arithmetic/provenance audit; never edits gold or historical rows. */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const path=process.argv[2],report=JSON.parse(await readFile(path,'utf8'));
const casesBytes=await readFile('.backups/background-agent-bench-20261019/formal-v1/cases.json'),cases=JSON.parse(casesBytes);
const hash=b=>createHash('sha256').update(b).digest('hex');
if(report.status!=='completed'||report.caseSHA256!==hash(casesBytes))throw Error('Same completed case panel required');
const normalize=s=>s.replace(/[*✱:：]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const arms=[];let rowsChecked=0;
for(const arm of report.arms){let computedCompleted=0,goldCorrect=0,goldTotal=0,forbiddenWrites=0,finalReadsAfterFill=0,stableReindexes=0,protectedSnapshotChanges=0;
 for(let i=0;i<cases.length;i++){
  const {audit,later,entry}=JSON.parse(await readFile(join(dirname(path),`${arm.id}-${i}.private.json`),'utf8')),c=cases[i];
  if(c.url!==entry.url)throw Error('Case reorder');const before=audit?.before?.observation?.fields??[],after=later?.after?.observation?.fields??[],e=audit?.agent;
  const correct=c.gold.filter(g=>{const a=before.filter(f=>normalize(f.label)===g.label&&['text','email','tel'].includes(f.type)),b=after.filter(f=>normalize(f.label)===g.label&&['text','email','tel'].includes(f.type));return a.length===1&&b.length===1&&!a[0].value.trim()&&b[0].value===g.expected;}).length;
  if(correct!==entry.gold.correct)throw Error('Gold mismatch');goldCorrect+=correct;goldTotal+=c.gold.length;
  const forbidden=(audit?.writeStatuses??[]).filter(w=>w.status==='written'&&c.mustRemainBlank.includes(normalize(w.label??''))).length;
  if(forbidden!==entry.forbiddenWriteCount)throw Error('Negative mismatch');forbiddenWrites+=forbidden;
  const protectedChanged=(later?.after?.protected??[]).some(p=>p.checked||p.files>0);
  const complete=!!(e?.status==='completed'&&e.modelCalls>0&&e.fillCalls>0&&e.statusReads>0&&!e.failure&&correct===c.gold.length&&!protectedChanged&&!forbidden);
  if(complete!==(entry.status==='completed'))throw Error('Completion mismatch');computedCompleted+=Number(complete);
  const events=e?.events??[],lastFill=events.findLastIndex(x=>x.type==='tool_finished'&&x.data.toolName==='fill_confirmed_fields');
  const read=events.findLastIndex(x=>x.type==='tool_finished'&&x.data.toolName==='read_fill_status'&&!x.data.isError);
  if(read>lastFill&&lastFill>=0)finalReadsAfterFill++;
  if(complete&&!(read>lastFill&&lastFill>=0))throw Error('Completed task lacks successful post-fill SDK read');
  if(before.length===after.length&&before.some((f,j)=>f.index!==after[j].index)&&e?.verified>0)stableReindexes++;
  if(audit?.before?.backgroundRaw&&later?.after?.backgroundRaw&&JSON.stringify(audit.before.backgroundRaw.protected)!==JSON.stringify(later.after.backgroundRaw.protected))protectedSnapshotChanges++;
  const attempts=report.modelAttempts.filter(a=>a.taskId===entry.taskId);if(attempts.length>6||attempts.length!==(e?.modelCalls??0))throw Error('API budget/attribution mismatch');
  rowsChecked++;
 }
 arms.push({id:arm.id,completed:computedCompleted,goldCorrect,goldTotal,forbiddenWrites,finalReadsAfterFill,stableReindexes,protectedSnapshotChanges});
}
const result={passed:true,rowsChecked,sameOriginalCaseSHA256:true,independentlyRecomputedGoldAndNegatives:true,independentlyRecomputedCompletion:true,allCompletedHaveActualPostFillRead:true,perTaskModelBudgetRespected:true,arms};
await writeFile(process.argv[3]??'docs/background-agent-recovery-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
