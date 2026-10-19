import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import type { ApplicationQueueState } from '../../packages/shared/src/application-queue.js';

/** Native status follows actual queue state; clicking the menu is the only path that raises the app. */
export class ApplicationQueueTray {
  private readonly tray: Tray;
  private disposed = false;
  constructor(iconPath: string, private window: BrowserWindow, private cancel: () => void) {
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
    this.tray = new Tray(icon); this.tray.setToolTip('OfferAgent · 后台填写助手');
  }
  update(state: ApplicationQueueState): void {
    if (this.disposed || this.window.isDestroyed()) return;
    const running = state.status === 'running', total = state.totalCount, done = state.completedCount;
    const filled = total ? Math.floor(4 * done / total) : 0;
    const active = state.items.find(item => item.id === state.activeItemId);
    this.tray.setTitle(total ? `🐾 ${'▰'.repeat(filled)}${'▱'.repeat(4 - filled)} ${done}/${total}${active ? ` · ${active.verifiedCount}项` : ''}` : '');
    this.tray.setToolTip(active ? `OfferAgent · ${active.company} · ${active.message}` : `OfferAgent · 已处理 ${done}/${total}，等待你核对后提交`);
    this.window.setProgressBar(running && total ? done / total : -1);
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: total ? `填写队列 · 已处理 ${done}/${total}` : 'OfferAgent · 后台填写队列', enabled: false },
      ...(active ? [{ label: `${active.company} · ${active.message}`, enabled: false }] : []),
      { type: 'separator' },
      { label: '打开 OfferAgent', click: () => { if (!this.window.isDestroyed()) { this.window.show(); this.window.focus(); } } },
      { label: '取消剩余填写', enabled: running, click: this.cancel },
      { label: '填写完成不等于已投递', enabled: false },
    ]));
  }
  dispose(): void { this.disposed = true; this.tray.destroy(); }
}
