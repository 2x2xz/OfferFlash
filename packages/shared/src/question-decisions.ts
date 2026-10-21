import type {QuestionDecision} from './application-assets.js';
const credentialKey=/^(?:token|access_token|refresh_token|id_token|code|auth|authorization|session|sessionid|api_key|key|ticket)$/i;
export function questionDecisionContextURL(value:string){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||value.length>4096)throw Error('请选择明确的HTTPS申请页。');for(const key of [...url.searchParams.keys()])if(credentialKey.test(key))url.searchParams.delete(key);
 const query=url.hash.indexOf('?');if(query>=0){const hashURL=new URL('https://context.invalid/'+url.hash.slice(1));for(const key of [...hashURL.searchParams.keys()])if(credentialKey.test(key))hashURL.searchParams.delete(key);url.hash=hashURL.pathname.slice(1)+hashURL.search;}
 return url.href;}
export function questionDecisionApplies(item:QuestionDecision,key:string,url:string,version:number){return item.url===questionDecisionContextURL(url)&&item.key===key&&item.disposition!=='ask'&&(item.disposition==='skip'||item.profileVersion===version);}
