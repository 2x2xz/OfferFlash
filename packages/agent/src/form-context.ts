/** Project only stale page snapshots out of provider requests. The Pi transcript,
 * tool calls, errors, receipts, facts and final verification remain intact. */
export function projectFormRequest(payload:unknown):unknown{
 if(!payload||typeof payload!=='object'||!Array.isArray((payload as any).messages))return payload;
 const source=(payload as any).messages as Array<Record<string,any>>;
 const observations=source.flatMap((message,index)=>{if(message.role!=='tool'||typeof message.content!=='string')return [];try{const data=JSON.parse(message.content);return data&&typeof data==='object'&&(typeof data.observation==='string'||data.next&&typeof data.next==='object'&&typeof data.next.observation==='string')?[index]:[];}catch{return [];}});
 const keep=new Set(observations.slice(-1));
 const compact=(data:any):any=>{
   if(!data||typeof data!=='object')return data;
   if(data.next)return {...data,next:compact(data.next)};
   if(data.page?.fields)return {...data,page:{...data.page,observedFieldCount:data.page.fields.length,fields:data.page.fields.filter((field:any)=>field.state!=='committed'||field.candidates?.length)}};
   return data;
 };
 const messages=source.map((message,index)=>{
  if(message.role==='user'&&Array.isArray(message.content))return {...message,content:message.content.map((part:any)=>{
    if(part.type!=='text'||typeof part.text!=='string')return part;
    try{const data=JSON.parse(part.text);if(data.offerflashInitialObservation)return {...part,text:JSON.stringify({...data,offerflashInitialObservation:observations.length?{snapshotSuperseded:true,useLatestObservation:true}:compact(data.offerflashInitialObservation)})};}catch{}return part;
  })};
  if(message.role==='user'&&typeof message.content==='string'){
    try{const data=JSON.parse(message.content);if(data.offerflashInitialObservation)return {...message,content:JSON.stringify({...data,offerflashInitialObservation:observations.length?{snapshotSuperseded:true,useLatestObservation:true}:compact(data.offerflashInitialObservation)})};}catch{}
  }
  if(keep.has(index)){const data=JSON.parse(message.content);return {...message,content:JSON.stringify(compact(data))};}
  if(!observations.includes(index))return message;
  const data=JSON.parse(message.content);
  if(data.next){const {next,...receipt}=data;return {...message,content:JSON.stringify({...receipt,snapshotSuperseded:true,useLatestObservation:true})};}
  const {page,fields,records,actions,options,manualFields,sections,activeControl,observation,...receipt}=data;
  return {...message,content:JSON.stringify({...receipt,snapshotSuperseded:true,useLatestObservation:true})};
 });
 return {...payload,messages};
}
