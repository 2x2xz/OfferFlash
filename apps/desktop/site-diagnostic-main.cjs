const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (!process.argv.includes('--site-diagnostic')) throw new Error('SITE_DIAGNOSTIC_FLAG_REQUIRED');
import(pathToFileURL(path.join(__dirname, '../../dist/desktop/site-diagnostic.js')).href).catch(() => {
  // Diagnostics must never print a remote URL, authentication error or page data.
  console.error('SITE_DIAGNOSTIC_START_FAILED');
  process.exit(1);
});
