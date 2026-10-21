export type BrowserTabShortcut='new'|'close'|'next'|'previous';
export function browserTabShortcut(input:{type:string;key:string;meta?:boolean;control?:boolean;alt?:boolean;shift?:boolean},platform=process.platform):BrowserTabShortcut|undefined{
 if(input.type!=='keyDown')return;
 const command=platform==='darwin'?input.meta:input.control;
 if(command&&!input.alt&&!input.shift&&input.key.toLowerCase()==='t')return 'new';
 if(command&&!input.alt&&!input.shift&&input.key.toLowerCase()==='w')return 'close';
 if(input.control&&!input.meta&&!input.alt&&input.key==='Tab')return input.shift?'previous':'next';
}
