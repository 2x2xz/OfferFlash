import type { FillPlan, FillResult } from '../../shared/src/contracts.js';

export function formPreviewRows(plan: FillPlan, result?: FillResult) {
  if (result?.planId !== plan.id) result = undefined;
  const verified = new Set(result?.verified.map(item => item.fieldId) ?? []);
  const unresolved = new Map(result?.unresolved.map(item => [item.fieldId, item.reason]) ?? []);
  return plan.items.map(item => ({
    item,
    status: verified.has(item.fieldId) ? 'verified' as const : unresolved.has(item.fieldId) ? 'unresolved' as const : item.status,
    reason: unresolved.get(item.fieldId) ?? item.reason,
    label: verified.has(item.fieldId) ? '已验证' : unresolved.has(item.fieldId) ? '未完成，需处理' : item.status === 'ready' ? '可填写' : item.status === 'review' ? '待确认' : '保留',
  }));
}

export function selectablePreviewIds(plan: FillPlan, result?: FillResult): string[] {
  return formPreviewRows(plan, result).filter(row => row.status === 'ready').map(row => row.item.fieldId);
}

export function formPreviewCounts(plan: FillPlan, selectedIds: readonly string[], result?: FillResult) {
  const rows = formPreviewRows(plan, result);
  const selectable = new Set(selectablePreviewIds(plan, result));
  return {
    ready: rows.filter(row => row.status === 'ready').length,
    selected: [...new Set(selectedIds)].filter(id => selectable.has(id)).length,
    kept: rows.filter(row => row.status === 'skip').length,
    review: rows.filter(row => row.status === 'review').length,
    verified: rows.filter(row => row.status === 'verified').length,
    unresolved: rows.filter(row => row.status === 'unresolved').length,
  };
}
