import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Standalone Node release CLI is deliberately ESM JavaScript.
import {inspectReleaseText} from '../scripts/export-private-release.mjs';
test('release privacy gate reports fixed codes without echoing private matches',()=>{
 const marker='FICTIONAL-PRIVATE-MARKER';const local='/Users/'+'private-person/project/file';const email='private-person@'+'company.test';
 const result=inspectReleaseText('sample.ts',`${marker} ${local} ${email}`,[marker]);
 assert.deepEqual(result.map((r:{code:string})=>r.code),['PERSONAL_ABSOLUTE_PATH','PRIVATE_MARKER','UNREVIEWED_EMAIL']);
 assert.ok(!JSON.stringify(result).includes(marker)&&!JSON.stringify(result).includes(email));
});
test('release gate accepts only reserved emails and explicit dummy URL-userinfo test words',()=>{
 assert.deepEqual(inspectReleaseText('fixture.ts','demo@example.invalid https://user:pass@careers.company.test'),[]);
 assert.equal(inspectReleaseText('source.ts','https://user:'+'actual.person'+'@company.test')[0]?.code,'UNREVIEWED_EMAIL');
 assert.equal(inspectReleaseText('source.ts','https://'+'private.person'+'@company.test')[0]?.code,'UNREVIEWED_EMAIL');
 assert.equal(inspectReleaseText('source.ts','134'+'56789012')[0]?.code,'UNREVIEWED_PHONE');
});
