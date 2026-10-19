/** Normalize user-entered website addresses; the privileged browser performs its own final check. */
export function normalizeBrowserAddress(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error('请输入企业招聘网址。');
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('网址中不能包含换行或控制字符。');
  const hostWithPort = /^(?:localhost|(?:[a-z\d-]+\.)+[a-z\d-]+|\[[0-9a-f:]+\]):\d+(?:[/?#]|$)/i.test(value);
  const hasProtocol = /^[a-z][a-z\d+.-]*:/i.test(value) && !hostWithPort;
  let url: URL;
  try { url = new URL(hasProtocol ? value : `https://${value}`); }
  catch { throw new Error('请输入有效网址，例如 jobs.bytedance.com/campus/position。'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('这里只支持 HTTP 或 HTTPS 招聘网址。');
  if (url.username || url.password) throw new Error('网址不能包含账号或密码；请在网站登录页登录。');
  if (!hasProtocol && !url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('[')) {
    throw new Error('请输入网站域名；岗位关键词请在“岗位”页搜索。');
  }
  return url.href;
}

export function displayBrowserAddress(url: string): string { return url === 'about:blank' ? '' : url; }
