import {setTimeout as delay} from 'node:timers/promises';
import {BackgroundFillError} from '../../domain/src/application-queue.js';

/** Startup only: no plan exists and no input has been sent. Execution subsequently
 * pins its own generation; this must never be used to renew a running write plan. */
export async function waitForBackgroundNavigationReady(read:()=>{url:string;generation:number;loading:boolean},
  signal:AbortSignal,settle:(ms:number)=>Promise<void>=ms=>delay(ms,undefined,{signal})):Promise<void>{
  let previous=read(),stable=0;
  for(let sample=0;sample<8;sample++){
    if(signal.aborted)throw new BackgroundFillError('context-changed');
    await settle(150);
    if(signal.aborted)throw new BackgroundFillError('context-changed');
    const current=read();
    stable=!current.loading&&current.url===previous.url&&current.generation===previous.generation?stable+1:0;
    previous=current;
    if(stable>=2)return;
  }
  throw new BackgroundFillError('page-changing');
}
