export function isAllowedNavigation(raw: string, fixtureURL?: string): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    return fixtureURL !== undefined && url.href === fixtureURL;
  } catch { return false; }
}
