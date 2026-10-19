const {pathToFileURL}=require('node:url');const path=require('node:path');
import(pathToFileURL(path.join(__dirname,'../../dist/desktop/benchmark-career.js')).href).catch(error=>{console.error(JSON.stringify({code:'CAREER_BENCHMARK_FAILED',name:error?.name,message:error?.message}));process.exit(2);});
