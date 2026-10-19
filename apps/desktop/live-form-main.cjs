// Bootstrap asynchronously, like the desktop main.cjs. Directly awaiting
// app.whenReady() in Electron's initial ESM entry can hold application startup.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
import(pathToFileURL(path.join(__dirname, '../../dist/desktop/live-form-runner.js')).href).catch(() => {
  console.error('Live form validation could not start; no provider payload is logged.');
  process.exit(1);
});
