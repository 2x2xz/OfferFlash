import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { WebContents } from 'electron';

/** Private bridge to ONE host-owned WebContents, never the app's browser process.
 * No remote-debugging flag, cookie transfer, new tab, context, or model CDP API.
 */
export async function attachPlaywrightView(contents: WebContents, diagnostic?:(method:string,stage:'start'|'done'|'error')=>void):Promise<{page:Page;close():Promise<void>}> {
  if(contents.isDestroyed()||contents.debugger.isAttached())throw Error('BROWSER_VIEW_UNAVAILABLE');
  const nonce=randomBytes(32).toString('hex'),main='offerflash-page';
  let socket:WebSocket|undefined,browser:Browser|undefined,closed=false,claimed=false;
  const children=new Set<string>();
  const pending=new Set<Promise<unknown>>();
  const command=(method:string,params:any={},sessionId?:string)=>{const task=contents.debugger.sendCommand(method,params,sessionId);pending.add(task);void task.finally(()=>pending.delete(task)).catch(()=>{});return task;};
  const server=createServer((_req,res)=>{res.writeHead(404);res.end();});
  const ws=new WebSocketServer({noServer:true,maxPayload:8*1024*1024});
  const send=(message:unknown)=>{if(socket?.readyState===1)socket.send(JSON.stringify(message));};
  let target='';
  const info=()=>({targetId:target,type:'page',title:'Application form',url:contents.getURL(),attached:true,browserContextId:'offerflash-context'});
  const onMessage=(_e:unknown,method:string,params:any,sessionId?:string)=>{
    if(method==='Target.attachedToTarget'&&params?.sessionId)children.add(params.sessionId);
    if(method==='Target.detachedFromTarget'&&params?.sessionId)children.delete(params.sessionId);
    send({method,params,sessionId:sessionId||main});
  };
  contents.debugger.attach('1.3');contents.debugger.on('message',onMessage);
  target=((await command('Target.getTargetInfo')) as any).targetInfo.targetId;
  async function close(){
    if(closed)return;closed=true;
    socket?.terminate();ws.close();server.close();
    // An already dispatched renderer command must really settle before releasing the host lock.
    await Promise.allSettled([...pending]);
    contents.debugger.removeListener('message',onMessage);
    if(!contents.isDestroyed()&&contents.debugger.isAttached())contents.debugger.detach();
    await browser?.close().catch(()=>{});
  }
  server.on('upgrade',(request,stream,head)=>{
    if(claimed||request.url!=='/'+nonce||request.headers.origin){stream.destroy();return;}
    claimed=true;ws.handleUpgrade(request,stream,head,connection=>{
      socket=connection;
      connection.on('message',async data=>{
        let message:any;
        try{
          message=JSON.parse(data.toString());const {id,method,params={},sessionId}=message;
          diagnostic?.(method,'start');
          if(closed||!Number.isSafeInteger(id)||typeof method!=='string')throw Error('INVALID_COMMAND');
          let result:unknown;
          if(!sessionId){
            if(method==='Browser.getVersion')result=await command(method);
            else if(method==='Browser.setDownloadBehavior')result={}; // Host retains its own download policy.
            else if(method==='Target.getTargetInfo')result={targetInfo:info()};
            else if(method==='Target.setAutoAttach'){
              result={};send({id,result});
              if(params.autoAttach)send({method:'Target.attachedToTarget',params:{sessionId:main,targetInfo:info(),waitingForDebugger:false}});
              return;
            }else throw Error('BROWSER_COMMAND_NOT_EXPOSED');
          }else{
            if(sessionId!==main&&!children.has(sessionId))throw Error('FOREIGN_TARGET');
            if(method.startsWith('Browser.')||method.startsWith('Storage.')||method==='Target.createTarget'||method==='Target.getTargets'||method==='Target.attachToTarget')throw Error('FOREIGN_TARGET');
            result=await command(method,params,sessionId===main?undefined:sessionId);
          }
          send({id,result,...(sessionId?{sessionId}:{})});diagnostic?.(method,'done');
        }catch{diagnostic?.(message?.method,'error');if(message?.id)send({id:message.id,...(message.sessionId?{sessionId:message.sessionId}:{}),error:{code:-32000,message:'Host-owned page command unavailable'}});}
      });
    });
  });
  try{
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
    const address=server.address();if(!address||typeof address==='string')throw Error('BRIDGE_UNAVAILABLE');
    browser=await chromium.connectOverCDP(`ws://127.0.0.1:${address.port}/${nonce}`,{timeout:8000});
    const pages=browser.contexts().flatMap(context=>context.pages());
    if(pages.length!==1)throw Error('EXACT_PAGE_REQUIRED');
    const page=pages[0]!;page.setDefaultTimeout(3500);page.setDefaultNavigationTimeout(8000);
    return {page,close};
  }catch(error){await close();throw error;}
}
