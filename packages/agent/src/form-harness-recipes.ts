import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

export type FormRecipeStep={action:'open'}|{action:'navigate';role:'tab';label:string}|{action:'choose'};
export type FormRecipe={id:string;shape:string;steps:FormRecipeStep[]};
export const recipeShape=(field:{label:string;section:string;type:string},kind:string)=>createHash('sha256').update(JSON.stringify([1,field.label,field.section,field.type,kind])).digest('hex');
const forbidden=/提交|投递|发送|支付|删除|同意|声明|隐私|协议|本机私人资料|submit|apply|send|delete|remove|agree|consent|privacy|\S+@\S+|\d{7}/i;
/** A recipe is a program over fixed host operations, never executable source.
 * Values, record IDs, node refs, coordinates and CSS selectors are not stored. */
export class FormHarnessRecipes{
 private entries=new Map<string,FormRecipe>();
 constructor(private file?:string){}
 async load(){
  if(!this.file)return;let raw:unknown;
  try{raw=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw Error('RECIPE_FILE_INVALID');}
  if(!Array.isArray(raw)||raw.length>100)throw Error('RECIPE_FILE_INVALID');
  if(!raw.every(value=>this.valid(value)))throw Error('RECIPE_FILE_INVALID');
  this.entries.clear();for(const value of raw)this.entries.set(value.shape,value);
 }
 private valid(value:any):value is FormRecipe{
  return !!value&&Object.keys(value).sort().join(',')==='id,shape,steps'&&/^[a-f0-9]{64}$/.test(value.shape)&&value.id==='recipe-'+value.shape.slice(0,16)&&Array.isArray(value.steps)&&value.steps.length>=3&&value.steps.length<=8&&value.steps[0]?.action==='open'&&value.steps.at(-1)?.action==='choose'&&value.steps.every((step:any,index:number)=>index===0||index===value.steps.length-1?Object.keys(step).join(',')==='action':Object.keys(step).sort().join(',')==='action,label,role'&&step.action==='navigate'&&step.role==='tab'&&typeof step.label==='string'&&step.label.length>0&&step.label.length<=80&&!forbidden.test(step.label));
 }
 find(shape:string){const recipe=this.entries.get(shape);return recipe&&structuredClone(recipe);}
 list(){return [...this.entries.values()].map(entry=>structuredClone(entry));}
 private async persist(){if(this.file){await mkdir(dirname(this.file),{recursive:true,mode:0o700});const temporary=this.file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(this.list(),null,2),{mode:0o600});await rename(temporary,this.file);}}
 async forget(shape:string){this.entries.delete(shape);await this.persist();}
 async rememberVerified(shape:string,steps:FormRecipeStep[],privateValues:readonly string[]){
  const recipe={id:'recipe-'+shape.slice(0,16),shape,steps:structuredClone(steps)};
  if(!this.valid(recipe))return undefined;
  if(steps.some(step=>step.action==='navigate'&&privateValues.some(value=>value.trim().length>=2&&step.label.toLowerCase().includes(value.trim().toLowerCase()))))return undefined;
  this.entries.delete(shape);this.entries.set(shape,recipe);while(this.entries.size>100)this.entries.delete(this.entries.keys().next().value!);
  await this.persist();
  return recipe.id;
 }
}
