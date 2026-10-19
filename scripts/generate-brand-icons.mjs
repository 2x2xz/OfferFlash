import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Original vector artwork; no screenshots, remote images or personal metadata.
const root = 'apps/desktop/assets';
const iconset = join(root, 'OfferFlash.iconset');
await mkdir(iconset, { recursive: true });
try {
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    execFileSync('rsvg-convert', ['-w', String(size * scale), '-h', String(size * scale), '-o', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), join(root, 'icon.svg')]);
  }
  execFileSync('rsvg-convert', ['-w', '1024', '-h', '1024', '-o', join(root, 'icon.png'), join(root, 'icon.svg')]);
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'OfferFlash.icns')]);
} finally { await rm(iconset, { recursive: true, force: true }); }
