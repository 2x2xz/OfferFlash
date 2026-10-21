/** Build a separately identified full desktop application. Does not launch or drive UI. */
import {packager} from '@electron/packager';
import {readFile,writeFile,mkdir,mkdtemp,readdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';

const root=resolve('.'),parent=join(root,'.backups/real-site-qa-20261019');
const replayPath=process.argv.find(s=>s.startsWith('--replay='))?.slice(9),replayLimit=Number(process.argv.find(s=>s.startsWith('--replay-limit='))?.slice(15)??3);
const extendReplay=process.argv.includes('--extend');
const inputCases=replayPath?JSON.parse(await readFile(replayPath,'utf8')):undefined;
const replay=inputCases?(inputCases.cases??inputCases.results.filter(j=>j.realFormObserved)).slice(0,replayLimit).map(({company,title,url,provider,description,city,requirements})=>({company,title,url,provider,description:description??'',city:city??'',requirements:requirements??''})):undefined;
if(replay&&(!Number.isSafeInteger(replayLimit)||replayLimit<1||replayLimit>300||replay.length!==replayLimit))throw new Error('Need exactly the requested number of form cases');
const targetArg=process.argv.find(s=>s.startsWith('--target='))?.slice(9),priorArg=process.argv.find(s=>s.startsWith('--prior='))?.slice(8);
if(targetArg!==undefined&&(!/^\d+$/.test(targetArg)||Number(targetArg)<1||Number(targetArg)>100))throw new Error('Invalid target');
if(priorArg!==undefined&&(!/^\d+$/.test(priorArg)||Number(priorArg)<0||Number(priorArg)>99))throw new Error('Invalid prior count');
const label=process.argv.find(s=>s.startsWith('--label='))?.slice(8)??'';if(label&&!/^[a-z0-9]{1,12}$/.test(label))throw new Error('Invalid run label');
const batch=process.argv.includes('--batch')||!!replay;const name=(replay?'OfferFlashReplayQA'+replayLimit:batch?'OfferFlashBatchQA':'OfferFlashQA')+label;
await mkdir(parent,{recursive:true,mode:0o700});
const destination=await mkdtemp(join(parent,'full-app-'));
const dataRoot=join(destination,'instances');await mkdir(dataRoot,{mode:0o700});
const manifest=JSON.parse(await readFile('package.json','utf8'));
const electronVersion=JSON.parse(await readFile('node_modules/electron/package.json','utf8')).version;
const cacheRoot=join(homedir(),'Library/Caches/electron');let electronZipDir;
for(const entry of await readdir(cacheRoot,{withFileTypes:true})){if(!entry.isDirectory()||entry.isSymbolicLink())continue;
  const path=join(cacheRoot,entry.name);try{await access(join(path,`electron-v${electronVersion}-darwin-${process.arch}.zip`));electronZipDir=path;break;}catch{}}
if(!electronZipDir)throw new Error('Existing official Electron cache required; this packager does not download binaries');
const backend=await readFile('dist/desktop/backend.js');
if(!backend.includes(Buffer.from('--real-site-qa')))throw new Error('Build the QA-capable backend first');
const paths=await packager({dir:root,name,appVersion:manifest.version,platform:'darwin',arch:process.arch,
  electronZipDir,
  appBundleId:(replay?'dev.offeragent.desktop.real-site-replay-qa-'+replayLimit:batch?'dev.offeragent.desktop.real-site-batch-qa':'dev.offeragent.desktop.real-site-qa')+(label?'.'+label:''),executableName:name,out:join(destination,'package'),
  overwrite:false,asar:false,prune:true,icon:'apps/desktop/assets/OfferFlash.icns',
  ignore:[/^\/reference-sources(?:\/|$)/,/^\/runtime-home(?:\/|$)/,/^\/data(?:\/|$)/,/^\/\.git(?:\/|$)/,
    /^\/\.backups(?:\/|$)/,/^\/\.env/,/^\/release(?:\/|$)/,/^\/tests(?:\/|$)/,/^\/docs(?:\/|$)/,
    /^\/\.publish(?:\/|$)/,/^\/\.export(?:\/|$)/,/^\/AGENTS\.md$/,/^\/plan\.md$/],
  afterCopy:[async({buildPath})=>{
    const pkg=JSON.parse(await readFile(join(buildPath,'package.json'),'utf8'));pkg.main='real-site-qa-main.cjs';
    await writeFile(join(buildPath,'package.json'),JSON.stringify(pkg,null,2));
    await writeFile(join(buildPath,'qa-resume.txt'),await readFile(join(parent,'fictional-resume.txt')));
    if(replay)await writeFile(join(buildPath,'qa-replay.json'),JSON.stringify(replay,null,2));
    await writeFile(join(buildPath,'real-site-qa-main.cjs'),`process.argv.push('--real-site-qa'${batch?",'--real-site-qa-batch'":''}${replay?",'--real-site-qa-replay'":''}${extendReplay?",'--real-site-qa-extend'":''}${targetArg!==undefined?",'--qa-target="+Number(targetArg)+"'":''}${priorArg!==undefined?",'--qa-prior="+Number(priorArg)+"'":''});\nprocess.env.OFFERAGENT_TEST_DATA_DIR=${JSON.stringify(dataRoot)};\nrequire('./apps/desktop/main.cjs');\n`);
  }]});
const report={application:join(paths[0],name+'.app'),dataRoot,backendSHA256:createHash('sha256').update(backend).digest('hex'),batch,
  fullRenderer:true,isolatedEmptyDatabaseOnLaunch:true,normalAppRestarted:false,launched:false,realEmployerRuns:0};
await writeFile(join(destination,'package-report.json'),JSON.stringify(report,null,2));
await writeFile(join(parent,'latest-full-app.json'),JSON.stringify({...report,report:join(destination,'package-report.json')},null,2));
console.log(JSON.stringify(report));
