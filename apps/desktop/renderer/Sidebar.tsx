import { BrandMark } from './BrandMark.js';
import { Briefcase, Columns3, Globe, PanelLeftClose, PanelLeftOpen, LayoutDashboard, Settings2, User } from 'lucide-react';
import { PixelMark } from './PixelArt.js';
import type { Page } from './context.js';

const navigation = [
  { id: 'dashboard', label: '任务总览', short: '总览', icon: LayoutDashboard },
  { id: 'browser', label: '申请空间', short: '申请', icon: Globe },
  { id: 'jobs', label: '岗位库', short: '岗位库', icon: Briefcase },
  { id: 'applications', label: '申请进度', short: '进度', icon: Columns3 },
  { id: 'profile', label: '个人资料', short: '资料', icon: User },
] as const;

export function Sidebar({ page, collapsed, layoutLocked, applicationCount, onToggle, onNavigate, onSettings }: {
  page: Page; collapsed: boolean; layoutLocked: boolean; applicationCount: number;
  showDemo: boolean; demoBusy: boolean;
  onToggle: () => void; onNavigate: (page: Page) => void;
  onReviewProfile: () => void; onDemo: () => void; onExport: () => void; onSettings: () => void;
}) {
  const active = ['apply', 'agent', 'telemetry'].includes(page) ? 'browser' : page;
  return <aside className="sidebar workbench-nav" aria-label="工作台导航">
    <div className="brand" aria-label="OfferFlash"><span className="brand-mark"><BrandMark /></span>{!collapsed && <div><span className="brand-name">OfferFlash</span><span className="brand-sub">CAREER OS / 01</span></div>}</div>
    <nav id="workspace-navigation" className="nav" aria-label="主导航">{navigation.map(item => <button type="button" key={item.id} className={`nav-button${active === item.id ? ' active' : ''}`} aria-label={item.label} title={item.label} aria-current={active === item.id ? 'page' : undefined} disabled={layoutLocked} data-testid={item.id === 'browser' ? 'apply-nav' : `nav-${item.id}`} onClick={() => onNavigate(item.id)}><item.icon size={18} strokeWidth={1.65} /><span className="nav-button-label">{collapsed ? item.short : item.label}</span>{item.id === 'applications' && applicationCount > 0 && <span className="nav-count">{applicationCount}</span>}</button>)}</nav>
    <div className="sidebar-foot">{!collapsed && <div className="nav-local-status"><span />LOCAL WORKSPACE<small>你的下一程，从这里开始</small></div>}<button type="button" className="nav-button settings-entry" aria-label="设置与工具" title="设置与工具" disabled={layoutLocked} data-testid="workspace-settings" onClick={onSettings}><Settings2 size={18} /><span className="nav-button-label">{collapsed ? '设置' : '设置与工具'}</span></button><button type="button" className="sidebar-toggle" data-testid="sidebar-toggle" disabled={layoutLocked} aria-label={collapsed ? '展开导航' : '收起导航'} title={layoutLocked ? '当前操作完成后可调整导航宽度' : collapsed ? '展开导航' : '收起导航'} aria-expanded={!collapsed} aria-controls="workspace-navigation" onClick={onToggle}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
  </aside>;
}
