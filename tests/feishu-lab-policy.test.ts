import assert from 'node:assert/strict';
import test from 'node:test';
import { decideLabRequest, decideLabReloadTransition } from '../apps/desktop/feishu-lab-policy.js';

const origin = 'https://modelbest.jobs.feishu.cn';
const fixture = ['虚构南城科技大学', 'Fictional Validator', 'career-form-validation@example.invalid', '2025-09', 'C++'];

test('reload allows HTTPS GET and HEAD without a known fake value and blocks every write method', () => {
  for (const method of ['GET', 'HEAD', 'get']) assert.deepEqual(decideLabRequest({ method, url: `${origin}/apply?language=zh` }, fixture, 'reload'), { allow: true, reason: 'read' });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']) {
    assert.deepEqual(decideLabRequest({ method, url: `${origin}/api/save` }, fixture, 'reload'), { allow: false, reason: 'method' });
  }
});

test('reload blocks non HTTPS, websocket, malformed and credential-bearing URLs without exposing them', () => {
  for (const url of ['http://example.invalid', 'ws://example.invalid', 'wss://example.invalid', 'file:///private/secret', 'data:text/plain,private', 'not a URL', 'https://user:password@example.invalid']) {
    const decision = decideLabRequest({ method: 'GET', url }, fixture, 'reload');
    assert.deepEqual(decision, { allow: false, reason: 'scheme' });
    assert.equal(JSON.stringify(decision).includes(url), false);
  }
});

test('reload blocks raw, encoded and twice nested fake query values including plus-space variants', () => {
  for (const value of fixture) {
    for (const encoded of [value, encodeURIComponent(value), encodeURIComponent(encodeURIComponent(value))]) {
      assert.deepEqual(decideLabRequest({ method: 'GET', url: `${origin}/api?redirect=${encoded}` }, fixture, 'reload'), { allow: false, reason: 'test-query' });
    }
  }
  assert.deepEqual(decideLabRequest({ method: 'GET', url: `${origin}/api?name=Fictional+Validator` }, fixture, 'reload'), { allow: false, reason: 'test-query' });
  assert.deepEqual(decideLabRequest({ method: 'HEAD', url: `${origin}/api?return=%3Femail%3DCAREER-FORM-VALIDATION%40EXAMPLE.INVALID` }, fixture, 'reload'), { allow: false, reason: 'test-query' });
});

test('reload blocks fake values carried by paths, encoded paths and replayed fragments', () => {
  for (const value of fixture) {
    for (const encoded of [value, encodeURIComponent(value), encodeURIComponent(encodeURIComponent(value))]) {
      for (const url of [`${origin}/autosave/${encoded}/draft`, `${origin}/apply#draft=${encoded}`]) {
        assert.deepEqual(decideLabRequest({ method: 'GET', url }, fixture, 'reload'), { allow: false, reason: 'test-query' });
      }
    }
  }
  assert.deepEqual(decideLabRequest({ method: 'HEAD', url: `${origin}/autosave/Fictional+Validator` }, fixture, 'reload'), { allow: false, reason: 'test-query' });
  assert.deepEqual(decideLabRequest({ method: 'GET', url: `${origin}/static/public-script.js?version=stable` }, fixture, 'reload'), { allow: true, reason: 'read' });
  assert.deepEqual(decideLabRequest({ method: 'GET', url: `${origin}/bad-%ZZ/static.js` }, fixture, 'reload'), { allow: false, reason: 'test-query' });
});

test('malformed encoding fails closed instead of masking an encoded fixture elsewhere in the query', () => {
  for (const query of ['bad=%E0%A4%A&school=' + encodeURIComponent(fixture[0]!), 'bad=%ZZ', 'nested=%25ZZ']) {
    assert.deepEqual(decideLabRequest({ method: 'GET', url: `${origin}/api?${query}` }, fixture, 'reload'), { allow: false, reason: 'test-query' });
  }
});

test('actions reject all requests including apparently harmless reads and websocket autosave', () => {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const url of [origin + '/public', origin + '/save?name=' + encodeURIComponent(fixture[0]!), 'wss://example.invalid/live', 'https://static.example.invalid/script.js']) {
      assert.deepEqual(decideLabRequest({ method, url }, fixture, 'actions'), { allow: false, reason: 'locked-network' });
    }
  }
  const request = { get method(): string { throw new Error('method should not be read'); }, get url(): string { throw new Error('url should not be read'); } };
  assert.deepEqual(decideLabRequest(request, [], 'actions'), { allow: false, reason: 'locked-network' });
});

test('reload transition permits only the exact HTTPS main frame GET or HEAD and blocks old document resources', () => {
  const exactURL = origin + '/apply?position=public-role';
  for (const method of ['GET', 'HEAD']) assert.deepEqual(decideLabReloadTransition({ method, url: exactURL, resourceType: 'mainFrame' }, exactURL, fixture), { allow: true, reason: 'read' });
  for (const resourceType of ['xhr', 'fetch', 'ping', 'script', 'image', 'subFrame', 'webSocket', 'other']) {
    assert.deepEqual(decideLabReloadTransition({ method: 'GET', url: exactURL, resourceType }, exactURL, fixture), { allow: false, reason: 'locked-network' });
  }
  for (const url of [origin + '/save/' + encodeURIComponent(fixture[0]!), exactURL + '&school=' + encodeURIComponent(fixture[0]!),
    origin + '/redirect', exactURL + '#different', 'https://unrelated.example.invalid/apply']) {
    assert.deepEqual(decideLabReloadTransition({ method: 'GET', url, resourceType: 'mainFrame' }, exactURL, fixture), { allow: false, reason: 'locked-network' });
  }
  assert.deepEqual(decideLabReloadTransition({ method: 'POST', url: exactURL, resourceType: 'mainFrame' }, exactURL, fixture), { allow: false, reason: 'method' });
  for (const url of ['http://example.invalid/apply', 'wss://example.invalid/live', 'https://user:pass@example.invalid/apply']) {
    assert.deepEqual(decideLabReloadTransition({ method: 'GET', url, resourceType: 'mainFrame' }, url, fixture), { allow: false, reason: 'scheme' });
  }
});
