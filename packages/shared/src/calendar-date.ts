/** Validate user-provided precision without supplying a missing month or day. */
export function validQuestionDate(value:string,format:'date'|'month'):boolean{
 if(format==='month')return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year!,month!-1,day!));
 return date.getUTCFullYear()===year&&date.getUTCMonth()+1===month&&date.getUTCDate()===day;
}
