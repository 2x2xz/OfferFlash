/** Isolated recording guard: keep genuine read/lookup traffic working, deny employer mutations. */
const telemetryHosts=new Set(['mon.zijieapi.com','mcs.zijieapi.com','mcs.snssdk.com']);
export function recordingRequestDecision(input:{url:string;method:string;resourceType?:string},writing:boolean):'allow'|'block'{
 let u:URL;try{u=new URL(input.url);}catch{return'block';}
 if(['data:','blob:'].includes(u.protocol))return'allow';
 if(u.protocol!=='https:'||u.username||u.password)return'block';
 const method=input.method.toUpperCase(),path=u.pathname.replace(/\/+$/,'');
 if(!writing)return'allow';
 if(['GET','HEAD','OPTIONS'].includes(method))return /\/(?:logout|privacy\/(?:agree|disagree))$/i.test(path)?'block':'allow';
 // Official observability POSTs do not mutate a resume/application; no request body is recorded.
 if(method==='POST'&&telemetryHosts.has(u.hostname))return'allow';
 // Reviewed official client: school suggestions and delivery eligibility are read queries,
 // despite using POST. Application creation remains a separate blocked endpoint.
 if(method==='POST'&&u.origin==='https://modelbest.jobs.feishu.cn'&&[
  '/api/v1/info_session/suggestion','/api/v1/user/deliver/limit_check',
 ].includes(path))return'allow';
 // Everything else, including resume/draft/application creation and file uploads, stays blocked.
 return'block';
}
export function recordingRoute(input:{url:string;method:string}){let u:URL;try{u=new URL(input.url);}catch{return{method:input.method,origin:'invalid',path:'invalid'};}
 return{method:input.method,origin:u.origin,path:u.pathname.replace(/\b\d{5,}\b/g,':id').slice(0,180)};}
