import {useCallback,useReducer,type Dispatch,type SetStateAction} from 'react';

// Renderer-lifetime presentation state only. Nothing is written to storage or
// restored into a website. Executable plans remain owned by the page controller.
const memory=new Map<string,unknown>();
export function useBrowserPageState<T>(pageKey:string,name:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
 const key=JSON.stringify([pageKey,name]);const [,render]=useReducer((count:number)=>count+1,0);
 if(!memory.has(key))memory.set(key,initial);
 const set=useCallback<Dispatch<SetStateAction<T>>>(update=>{
  const previous=(memory.has(key)?memory.get(key):initial) as T,next=typeof update==='function'?(update as (previous:T)=>T)(previous):update;
  if(!Object.is(previous,next)){memory.set(key,next);render();}
 },[key]);
 return [memory.get(key) as T,set];
}
export function pruneBrowserPageMemory(ids:readonly string[],activeId?:string,revision?:number){
 const valid=new Set(ids);
 for(const key of memory.keys()){const [pageKey]=JSON.parse(key),[id,documentRevision]=JSON.parse(pageKey);if(id!=='legacy'&&(!valid.has(id)||id===activeId&&documentRevision!==revision))memory.delete(key);}
}
