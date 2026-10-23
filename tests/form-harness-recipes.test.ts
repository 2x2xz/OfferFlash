import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FormHarnessRecipes,recipeShape,type FormRecipeStep} from '../packages/agent/src/form-harness-recipes.js';

const shape=recipeShape({label:'学历',section:'教育经历',type:'combobox'},'degree');
const steps:FormRecipeStep[]=[{action:'open'},{action:'navigate',role:'tab',label:'进阶'},{action:'choose'}];
test('verified recipes round-trip only structural operations, and copies cannot mutate the registry',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'offerflash-recipes-')),file=join(directory,'recipes.json');
 try{const recipes=new FormHarnessRecipes(file);await recipes.load();const id=await recipes.rememberVerified(shape,steps,['不应写入的姓名']);assert.ok(id);const saved=await readFile(file,'utf8');assert.ok(!saved.includes('不应写入的姓名'));assert.ok(!saved.includes('fact-'));assert.ok(!saved.includes('field-'));
  const loaded=new FormHarnessRecipes(file);await loaded.load();assert.deepEqual(loaded.find(shape)?.steps,steps);loaded.find(shape)!.steps.length=0;assert.equal(loaded.find(shape)?.steps.length,3);await loaded.forget(shape);const again=new FormHarnessRecipes(file);await again.load();assert.equal(again.find(shape),undefined);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('reject private values, submit-like navigation, code injection keys, and unbounded programs',async()=>{
 const recipes=new FormHarnessRecipes();
 assert.equal(await recipes.rememberVerified(shape,[{action:'open'},{action:'navigate',role:'tab',label:'虚构候选人的选项'},{action:'choose'}],['虚构候选人']),undefined);
 assert.equal(await recipes.rememberVerified(shape,[{action:'open'},{action:'navigate',role:'tab',label:'提交申请'},{action:'choose'}],[]),undefined);
 assert.equal(await recipes.rememberVerified(shape,[...steps,{action:'choose'}],[]),undefined);
 assert.equal(await recipes.rememberVerified(shape,[{action:'open'},{action:'navigate',role:'tab',label:'进阶',code:'process.exit()'} as any,{action:'choose'}],[]),undefined);
 assert.equal(await recipes.rememberVerified(shape,Array.from({length:10},()=>({action:'open'} as const)),[]),undefined);
 assert.equal(recipes.list().length,0);
});
test('persisted recipe input is validated instead of loading executable or foreign keys',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'offerflash-recipes-')),file=join(directory,'recipes.json');
 try{await writeFile(file,JSON.stringify([{id:'recipe-'+shape.slice(0,16),shape,steps,script:'doSomething()'}]));await assert.rejects(new FormHarnessRecipes(file).load(),/RECIPE_FILE_INVALID/);}
 finally{await rm(directory,{recursive:true,force:true});}
});
