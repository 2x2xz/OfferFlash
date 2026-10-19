import { packager } from '@electron/packager';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const pixelPreview = /-pixel\.\d+$/.test(manifest.version);
const uiPreview = /-ui\.\d+$/.test(manifest.version);
const appName = pixelPreview ? 'OfferFlashPixel' : uiPreview ? 'OfferFlashUIPreview' : 'OfferFlash';

const paths = await packager({
  dir: '.', name: appName, appVersion: manifest.version, platform: 'darwin', arch: process.arch,
  out: process.env.OFFERAGENT_PACKAGE_OUTPUT || 'release', overwrite: true, asar: false, prune: true,
  appBundleId: pixelPreview ? 'dev.offeragent.desktop.pixel-preview' : uiPreview ? 'dev.offeragent.desktop.ui-preview' : 'dev.offeragent.desktop', executableName: appName, icon: 'apps/desktop/assets/OfferFlash.icns',
  ignore: [
    /^\/reference-sources(?:\/|$)/, /^\/runtime-home(?:\/|$)/, /^\/data(?:\/|$)/,
    /^\/\.git(?:\/|$)/, /^\/\.backups(?:\/|$)/, /^\/\.env/, /^\/release(?:\/|$)/, /^\/tests(?:\/|$)/,
    /^\/docs(?:\/|$)/, /^\/\.publish(?:\/|$)/, /^\/\.export(?:\/|$)/,
  ],
});
console.log(JSON.stringify({ applications: paths }));
