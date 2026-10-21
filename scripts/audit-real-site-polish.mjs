/** Independent final-value audit against the previous run's fixed field identities. */
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.backups/real-site-qa-20261019');
const runPath=process.argv[2];if(!runPath)throw new Error('Provide batch-progress.json');
const baseline=JSON.parse(await readFile(join(root,'final-100-summary.json'),'utf8'));
const runBytes=await readFile(runPath),run=JSON.parse(runBytes);
const previous={repair54:join(root,'full-app-JjGkJv/instances/real-site-qa-fjM8aA/batch-evidence'),extra46:join(root,'full-app-B2syco/instances/real-site-qa-JW8eMG/batch-evidence')};
const companyKey=name=>name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/(?:incorporated|inc|limited|ltd|llc)$/,'');
const filename=name=>'qa-'+createHash('sha256').update(companyKey(name)).digest('hex').slice(0,16)+'.private.json';
const fact=field=>{const label=field.label.replace(/[*✱:：]/g,'').trim().toLowerCase();return ['name','full name'].includes(label)?'OfferFlash QA':['email','email address','e-mail'].includes(label)?'offerflash-validation@example.invalid':undefined;};
const identity=(a,b)=>a.identity===b.identity&&a.label===b.label&&a.type===b.type;
const totals={eligible:0,correct:0,empty:0,wrong:0,unresolved:0,initialNonempty:0},phones={eligible:0,correct:0,empty:0,wrong:0,unresolved:0};const rows=[];
for(const old of baseline.rows){
  const current=run.results.find(r=>r.url===old.url&&r.company===old.company&&r.realFormObserved);if(!current)continue;
  const prev=JSON.parse(await readFile(join(previous[old.run],filename(old.company)),'utf8'));
  const next=JSON.parse(await readFile(join(dirname(runPath),filename(old.company)),'utf8'));
  const before=next.audit.before.observation.fields,after=next.later.after.observation.fields;
  const counts={eligible:0,correct:0,empty:0,wrong:0,unresolved:0,initialNonempty:0};
  for(const field of prev.audit.before.observation.fields){const expected=fact(field);if(expected===undefined||field.value.trim())continue;
    totals.eligible++;counts.eligible++;
    const start=before.filter(f=>identity(f,field)),end=after.filter(f=>identity(f,field));
    const result=start.length!==1||end.length!==1?'unresolved':start[0].value.trim()?'initialNonempty':end[0].value===expected?'correct':!end[0].value?'empty':'wrong';
    totals[result]++;counts[result]++;
  }
  for(const field of before){if(!/^phone(?: number)?\s*[*✱]?$/i.test(field.label.trim())||field.value.trim())continue;
    phones.eligible++;const matched=after.filter(f=>identity(f,field));if(matched.length!==1){phones.unresolved++;continue;}
    phones[matched[0].value==='+1 202-555-0100'?'correct':!matched[0].value?'empty':'wrong']++;
  }
  rows.push({company:old.company,url:old.url,provider:old.provider,baselineCorrect:old.correctContacts,...counts,
    verified:current.queueResult?.verifiedCount??0,message:current.queueResult?.message??'',writes:next.audit.writeStatuses??[]});
}
const output={scope:'same 100 employer URLs; fixed previous blank name/email identities; phone separate',status:run.status,companies:rows.length,
  baseline:baseline.knownContactAudit,current:totals,phone:phones,executorVerified:rows.reduce((s,r)=>s+r.verified,0),
  fixedFieldCount:baseline.knownContactAudit.eligible,unobservedFields:baseline.knownContactAudit.eligible-totals.eligible,
  pairedBaselineCorrect:rows.reduce((s,r)=>s+r.baselineCorrect,0),
  appSeconds:run.finishedAt?(Date.parse(run.finishedAt)-Date.parse(run.startedAt))/1000:null,
  import:run.import,artifactSHA256:createHash('sha256').update(runBytes).digest('hex'),runPath:resolve(runPath),
  realModelRequests:run.realModelRequests,submissions:0,uploads:0,rows};
const outputPath=process.argv[3]??join(root,'polish-100-audit.json');await writeFile(outputPath,JSON.stringify(output,null,2));
console.log(JSON.stringify({...output,rows:undefined,outputPath},null,2));
