const {pathToFileURL}=require('node:url');const path=require('node:path');
import(pathToFileURL(path.join(__dirname,'../../dist/desktop/benchmark.js')).href).catch(()=>{console.error('BENCHMARK_BOOTSTRAP_FAILED');process.exit(1);});
