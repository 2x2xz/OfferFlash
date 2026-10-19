const path = require('node:path');
const { pathToFileURL } = require('node:url');
if (process.argv.includes('--site-adapter-lab') && !process.argv.includes('--site-diagnostic')) {
  throw new Error('SITE_ADAPTER_LAB_REQUIRES_DIAGNOSTIC');
}
if (process.argv.includes('--site-diagnostic')) {
  require('./site-diagnostic-main.cjs');
} else {
  import(pathToFileURL(path.join(__dirname, '../../dist/desktop/backend.js')).href).catch(error => {
    console.error(error);
    process.exit(1);
  });
}
