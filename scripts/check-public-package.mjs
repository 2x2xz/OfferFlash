import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A release check, not a claim that free text or Git history is anonymous. */
export function inspectPublicFiles(files) {
  const failures = [];
  for (const { path, bytes } of files) {
    const normalized = path.replaceAll('\\', '/');
    if (/(?:^|\/)(?:\.env(?:\..*)?|offeragent\.sqlite(?:-.*)?|Cookies|Login Data|Session Storage|browser-session|runtime-home|\.backups|agent\/sessions|resume-versions)(?:\/|$)/i.test(normalized)
      && !normalized.endsWith('.env.example')) failures.push({ path, code: 'PRIVATE_RUNTIME_FILE' });
    if (/\.(?:sqlite|sqlite3|db|pem|p12|key|log|zip|dmg)$/i.test(normalized)) failures.push({ path, code: 'PRIVATE_OR_DISTRIBUTION_ARTIFACT' });
    const extension = extname(normalized).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.icns', '.pdf', '.docx', '.woff', '.woff2'].includes(extension)) {
      if (normalized !== 'docs/architecture.png' && !/^(?:apps\/desktop\/(?:assets|fixtures)\/|docs\/screenshots\/)/.test(normalized)) failures.push({ path, code: 'UNREVIEWED_BINARY' });
      continue;
    }
    const text = Buffer.from(bytes).toString('utf8');
    if (/(?:sk-(?:proj-|ant-)?[a-z\d_-]{24,}|sk-ws-[a-z\d._-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i.test(text)) failures.push({ path, code: 'POSSIBLE_CREDENTIAL' });
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
  const failures = inspectPublicFiles(paths.map(path => ({ path, bytes: readFileSync(path) })));
  // Deliberately emit only file paths and fixed codes; never print matched secrets.
  console.log(JSON.stringify({ checkedFiles: paths.length, failures, passed: failures.length === 0 }));
  if (failures.length) process.exitCode = 1;
}
