export type OutputLink = { kind: 'external'; url: string; host: string } | { kind: 'fragment'; id: string };

/** Generated output can describe a URL; only an explicit UI click may navigate. */
export function outputLink(value: unknown): OutputLink | undefined {
  if (typeof value !== 'string' || !value.trim()) return;
  const raw = value.trim();
  if (/^#[^\s#\x00-\x1f\x7f]+$/.test(raw)) return { kind: 'fragment', id: raw.slice(1) };
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    return { kind: 'external', url: url.href, host: url.host };
  } catch { return; }
}
