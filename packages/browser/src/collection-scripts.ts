/** All code here is fixed read-only observation. Website strings are data, never source code. */
export const READ_COLLECTION_LIST = String.raw`(() => {
  const compact = (value, max = 2000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const visible = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 3000).flatMap(anchor => {
    if (!visible(anchor)) return [];
    const rawText = (anchor.innerText || '').trim();
    const heading = anchor.querySelector('h1,h2,h3,h4,[role="heading"]');
    const card = anchor.closest('li,article,[role="listitem"],.job-item,.position-item') || anchor.querySelector('.positionItem');
    const metadata = location.hostname === 'jobs.bytedance.com' ? anchor.querySelector('.positionItem-subTitle')?.querySelectorAll(':scope > span') : undefined;
    return [{ url: anchor.href, title: compact(heading?.innerText || rawText.split(/\n+/).find(line => line.trim()), 140),
      city: compact(metadata?.[0]?.innerText, 160), recruitmentLabel: compact(metadata?.[1]?.innerText, 40),
      context: compact(card?.innerText || rawText, 1400) }];
  });
  const controls = Array.from(document.querySelectorAll('button,a,[role="button"],li')).slice(0, 4000);
  const next = controls.flatMap((element, index) => {
    if (!visible(element)) return [];
    const classes = String(element.className || '');
    const isNextClass = /(?:^|\s)(?:ant-pagination-next|semi-page-next|semi-page-item-next|arco-pagination-item-next|el-pagination-next)(?:\s|$)/.test(classes);
    const container = element.closest('[role="navigation"],[aria-label],.pagination,[class*="pagination"],[class*="Pagination"],.semi-page');
    const label = compact(element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText, 100);
    const markedContainer = container && /分页|pagination|pager|page|pagination/i.test(String(container.className || '') + ' ' + (container.getAttribute('aria-label') || ''));
    const explicit = /^(?:下一页|下页|next(?:\s+page)?|next_page)$/i.test(label);
    if (!isNextClass && !(explicit && markedContainer) && !(/(?:^|\s)btn-next(?:\s|$)/.test(classes) && markedContainer)) return [];
    // A recognized pagination wrapper and its inner button represent one control.
    const outer = element.parentElement?.closest('.ant-pagination-next,.semi-page-next,.semi-page-item-next,.arco-pagination-item-next');
    if (outer && outer !== element) return [];
    const anchor = element.tagName === 'A' ? element : element.querySelector('a[href]');
    const rect = element.getBoundingClientRect();
    const disabled = Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true' || element.querySelector('button:disabled,[aria-disabled="true"]') || /(?:^|[\s_-])disabled(?:$|[\s_-])/i.test(classes));
    const identity = [element.tagName, element.id || '', classes, label, anchor?.href || '', disabled].join('|');
    return [{ index, identity, disabled, href: anchor?.href || '', bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }];
  });
  // Only explicit public job search controls contribute to the scope guard.
  const filters = Array.from(document.querySelectorAll('input[type="search"],input[placeholder],select')).slice(0, 100).flatMap(element => {
    const label = compact(element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.name, 100);
    if (!/搜索|职位|岗位|keyword|job|position/i.test(label) || /姓名|电话|邮箱|password|email|phone/i.test(label) || element.type === 'password') return [];
    return [label + ':' + compact(element.value, 120)];
  });
  return { url: location.href, title: document.title, anchors, next: next.length === 1 ? next[0] : null,
    filters: filters.sort().join('|'),
    listMarker: Boolean(document.querySelector('.positionItem,.position-list,.job-list,[data-testid="job-list"]')),
    viewport: { width: innerWidth, height: innerHeight } };
})()`;

/** Locate the observed pagination target. Contains no DOM click/focus/setters. */
export function readPaginationTarget(index: number, x: number, y: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 4000 || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('分页控件定位无效。');
  return `(() => {
    const target = document.querySelectorAll('button,a,[role="button"],li')[${index}];
    const hit = document.elementFromPoint(${x}, ${y});
    const classes = String(target?.className || '');
    const label = String(target?.getAttribute('aria-label') || target?.getAttribute('title') || target?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100);
    const anchor = target?.tagName === 'A' ? target : target?.querySelector('a[href]');
    const disabled = Boolean(target?.disabled || target?.getAttribute('aria-disabled') === 'true' || target?.querySelector('button:disabled,[aria-disabled="true"]') || /(?:^|[\\s_-])disabled(?:$|[\\s_-])/i.test(classes));
    const identity = target ? [target.tagName, target.id || '', classes, label, anchor?.href || '', disabled].join('|') : '';
    return { url: location.href, exists: Boolean(target), identity, uncovered: Boolean(target && hit && (hit === target || target.contains(hit))) };
  })()`;
}

export const READ_COLLECTION_DETAIL = String.raw`(() => {
  const compact = value => String(value || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  // Read sections within the main detail container, avoiding header/recommendation sections elsewhere.
  const content = document.querySelector('.positionDetail,.job-detail,[data-testid="job-detail"]') || document.querySelector('main,[role="main"]');
  const headings = Array.from(content?.querySelectorAll('h1,h2,h3,h4,h5,[role="heading"],.job-detail-title,.positionDetail-title') || []).slice(0, 150);
  const section = expression => {
    const heading = headings.find(item => expression.test(compact(item.innerText)));
    if (!heading) return { text: '', present: false, truncated: false };
    const parts = []; let cursor = heading.nextElementSibling, length = 0, truncated = false;
    while (cursor && !/^H[1-6]$/.test(cursor.tagName) && !cursor.matches('[role="heading"]')) {
      const text = compact(cursor.innerText); length += text.length + (parts.length ? 1 : 0);
      parts.push(text);
      if (length > 10000) { truncated = true; break; }
      cursor = cursor.nextElementSibling;
    }
    return { text: parts.filter(Boolean).join('\n').slice(0, 10000), present: true, truncated };
  };
  const titleElement = content?.querySelector('.positionDetail-title,.job-detail-title,[data-testid="job-detail-title"]') || content?.querySelector('h1');
  const fullTitle = compact(titleElement?.innerText);
  const description = section(/^(?:职位描述|岗位职责|工作职责|job description|responsibilities)$/i);
  const requirements = section(/^(?:职位要求|岗位要求|任职要求|任职资格|job requirements|qualifications|requirements)$/i);
  const fullText = compact(content?.innerText);
  const truncated = fullTitle.length > 1000 || fullText.length > 14000 || description.truncated || requirements.truncated;
  return { url: location.href, title: fullTitle.slice(0, 1000), description: description.text, requirements: requirements.text,
    descriptionPresent: description.present, requirementsPresent: requirements.present,
    text: fullText.slice(0, 14000), truncated,
    hasHeading: Boolean(fullTitle), hasSections: description.present || requirements.present };
})()`;
