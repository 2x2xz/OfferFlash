export interface DetailObservationCheck {
  ready: boolean; permanent: boolean; reason: string; description: string; requirements: string;
}

const normalizedTitle = (value: string) => value.replace(/\s+/g, ' ').trim();

/** A known URL is not proof of a detail: verify its own title and complete, recognized sections. */
export function checkCollectionDetail(expectedTitle: string, raw: Record<string, unknown>): DetailObservationCheck {
  const incomplete = (reason: string, permanent = false): DetailObservationCheck => ({ ready: false, permanent, reason, description: '', requirements: '' });
  if (raw.truncated !== false) return incomplete('岗位详情观察已截短或缺少完整性标记，未把它记录为完整详情。', true);
  const title = typeof raw.title === 'string' ? raw.title : '';
  const description = typeof raw.description === 'string' ? raw.description : '';
  const requirements = typeof raw.requirements === 'string' ? raw.requirements : '';
  const text = typeof raw.text === 'string' ? raw.text : '';
  if (title.length > 1000 || description.length > 10000 || requirements.length > 10000 || text.length > 14000) {
    return incomplete('岗位详情超过本次读取上限，未把截短正文记录为完整详情。', true);
  }
  if (!normalizedTitle(title)) return incomplete('岗位详情没有可核对的主标题，保留列表候选。');
  if (normalizedTitle(title) !== normalizedTitle(expectedTitle)) return incomplete('详情主标题与列表岗位名称不一致，未保存其他页面或推荐职位的正文。');
  if (raw.descriptionPresent !== true || raw.requirementsPresent !== true) return incomplete('没有分别观察到这个岗位的职责与任职要求段落，未把缺失字段当成官网空值。');
  const sections = `${description.trim()} ${requirements.trim()}`.trim();
  if (sections.length < 240 && /^(?:(?:请|需要|您需要|须)?(?:先)?(?:登录|登陆)(?:后|以|才能)|(?:please\s+)?(?:log\s*in|sign\s*in)\s+to\s+(?:view|read)|(?:访问受限|暂无权限|无权访问|access denied|page not found|job no longer available|该职位已关闭|职位已关闭|职位不存在))/i.test(sections)) {
    return incomplete('职责或要求段落只有登录、权限或错误提示，未记录为岗位完整详情。');
  }
  // Existing, explicitly empty sections are meaningful empty values; do not replace them with page text.
  return { ready: true, permanent: false, reason: '', description, requirements };
}
