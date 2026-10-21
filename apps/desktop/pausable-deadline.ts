/** Keep the existing execution budget; time spent waiting for the user is excluded. */
export class PausableDeadline {
 private remaining:number;private started=0;private timer?:ReturnType<typeof setTimeout>;private disposed=false;
 constructor(milliseconds:number,private expire:()=>void,private now=()=>performance.now(),private schedule:typeof setTimeout=setTimeout,private unschedule:typeof clearTimeout=clearTimeout){this.remaining=milliseconds;this.resume();}
 pause(){if(this.disposed||!this.timer)return;this.remaining=Math.max(1,this.remaining-(this.now()-this.started));this.unschedule(this.timer);this.timer=undefined;}
 resume(){if(this.disposed||this.timer)return;this.started=this.now();this.timer=this.schedule(()=>{this.timer=undefined;this.disposed=true;this.expire();},this.remaining);}
 dispose(){if(this.timer)this.unschedule(this.timer);this.timer=undefined;this.disposed=true;}
}
