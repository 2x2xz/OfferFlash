/** This policy is exclusive to the explicit isolated lab, never the product browser. */
export type FeishuLabPhase = 'reload' | 'actions';
export type FeishuLabRequestReason = 'read' | 'method' | 'scheme' | 'test-query' | 'locked-network';
export interface FeishuLabRequestDecision { allow: boolean; reason: FeishuLabRequestReason; }

/** It deliberately accepts no headers, cookies, upload bytes or request body. */
export function decideLabRequest(request: { method: string; url: string }, fixtureStrings: readonly string[], phase: FeishuLabPhase): FeishuLabRequestDecision {
  if (phase === 'actions') return { allow: false, reason: 'locked-network' };
  if (phase !== 'reload') return { allow: false, reason: 'locked-network' };
  let url: URL;
  try { url = new URL(request.url); } catch { return { allow: false, reason: 'scheme' }; }
  if (url.protocol !== 'https:' || url.username || url.password) return { allow: false, reason: 'scheme' };
  if (typeof request.method !== 'string' || !['GET', 'HEAD'].includes(request.method.toUpperCase())) return { allow: false, reason: 'method' };

  const values = fixtureStrings.filter(value => typeof value === 'string' && value.trim()).map(value => value.toLowerCase());
  const containsFixture = (value: string) => values.some(fixture => value.toLowerCase().includes(fixture));
  let resource = url.pathname + url.search + url.hash;
  // Draft replay may encode a value in the path instead of the query. Inspect
  // both before allowing new-document reads; fragments are checked defensively.
  // No more than two decoding rounds; malformed encoding fails closed.
  for (let round = 0; round <= 2; round++) {
    if (containsFixture(resource) || containsFixture(resource.replace(/\+/g, ' '))) return { allow: false, reason: 'test-query' };
    if (round === 2) break;
    try { resource = decodeURIComponent(resource.replace(/\+/g, ' ')); }
    catch { return { allow: false, reason: 'test-query' }; }
  }
  return { allow: true, reason: 'read' };
}

/** Before the old document commits its replacement, permit only that exact reload. */
export function decideLabReloadTransition(request: { method: string; url: string; resourceType: string },
  exactURL: string, fixtureStrings: readonly string[]): FeishuLabRequestDecision {
  if (request.resourceType !== 'mainFrame') return { allow: false, reason: 'locked-network' };
  let expected: URL; let target: URL;
  try { expected = new URL(exactURL); target = new URL(request.url); }
  catch { return { allow: false, reason: 'scheme' }; }
  if (expected.protocol !== 'https:' || target.protocol !== 'https:' || expected.username || expected.password || target.username || target.password) {
    return { allow: false, reason: 'scheme' };
  }
  if (request.url !== exactURL || target.href !== expected.href) return { allow: false, reason: 'locked-network' };
  return decideLabRequest({ method: request.method, url: request.url }, fixtureStrings, 'reload');
}
