import { ArrowRight, Check, FileCheck2, Upload, MessageCircleQuestion, BookmarkCheck } from 'lucide-react';
import { onboardingSteps, type OnboardingStep } from '../../../packages/ui/src/onboarding.js';
import { Button, Modal } from './components.js';
import './Onboarding.css';
import {PixelArrow} from './PixelGuide.js';

function Steps({ current }: { current: OnboardingStep }) {
  return <ol className="onboarding-steps" aria-label="开始使用的三个步骤">{onboardingSteps(current).map((step, index) => <li key={step.id} data-step={step.id} data-status={step.status} aria-current={step.status === 'current' ? 'step' : undefined}><span className="onboarding-step-number">{step.status === 'complete' ? <Check size={13} /> : index + 1}</span><span>{step.label}</span></li>)}</ol>;
}

export function OnboardingDialog({ step, pendingCount, onImport, onBrowse, onSkip }: {
  step: 'import' | 'apply'; pendingCount: number; onImport: () => void; onBrowse: () => void; onSkip: () => void;
}) {
  const importing = step === 'import';
  return <Modal title={importing ? '先选一份简历，剩下的跟着走' : '准备好了，打开你的第一份网申'} description={importing ? '只需三步。每一步都会告诉你该做什么。' : 'Agent 填资料；需要你的地方，会明确停下来问你。'} onClose={onSkip}
    footer={<><Button variant="ghost" data-testid="onboarding-skip" onClick={onSkip}>{importing ? '稍后再说' : '我知道了'}</Button><span className="onboarding-primary-target"><PixelArrow/><Button data-testid={importing ? 'onboarding-import' : 'onboarding-browse'} onClick={importing ? onImport : onBrowse}>{importing ? <Upload size={16} /> : <ArrowRight size={16} />}{importing ? '选择我的简历' : '开始找岗位'}</Button></span></>}>
    <div className="onboarding" data-testid="onboarding-dialog" data-stage={step}><div className="onboarding-brand"><span>开始你的下一次申请</span></div><Steps current={step} />
      {importing ? <><div className="onboarding-main"><FileCheck2 size={26} /><div><span className="onboarding-action-label">现在只做这件事</span><h3>点击下方「选择我的简历」</h3><p>支持 PDF、DOCX 和 TXT，提取联系信息、教育、实习与项目。解析结果先放进草稿，由你核对后保存。</p></div></div><p className="onboarding-note">来源原文会保留。经历需要你确认，Agent 才能在后续网申里使用；无需先配置模型服务。</p></> : <><div className="onboarding-main"><FileCheck2 size={26} /><div><span className="onboarding-action-label">接下来这样做</span><h3>找一个岗位 → 登录官网 → 自动填写</h3><p>在岗位卡片点“去网申”，手动登录企业网站，然后点网页顶部的“自动填写”。需要你补充的项目会单独提醒，最终提交由你操作。</p></div></div>{pendingCount > 0 && <p className="onboarding-note">另有 {pendingCount} 条经历仍待你逐条确认，可到“个人资料”继续核对；不会把这些草稿当作已确认事实。</p>}</>}
      <div className="onboarding-memory"><MessageCircleQuestion size={20}/><div><strong>遇到资料里没有的问题，会问你</strong><p>醒目提示 → 逐题回答 → 你确认后记住。适用的相同问题，下次直接复用。</p></div><BookmarkCheck size={20}/></div><p className="onboarding-reopen">随时可在“设置与工具”重新查看这个引导。</p>
    </div>
  </Modal>;
}

export function OnboardingProfileGuide({ step, busy, onImport, onSkip }: {
  step: 'import' | 'review'; busy: boolean; onImport: () => void; onSkip: () => void;
}) {
  return <section className="onboarding-profile-guide" data-testid="onboarding-profile-guide" data-stage={step} aria-label="简历上手引导"><Steps current={step} /><div className="onboarding-guide-copy"><div><h3>{step === 'import' ? '选一份简历，开始准备资料' : '下一步：核对下方资料，再确认'}</h3><p>{step === 'import' ? '选择文件后，候选资料会出现在下面；也可以手动填写。' : '核对下方姓名和联系方式，明确选择一条教育，再点“确认资料并推荐岗位”。其他经历可在完整资料里逐条确认。'}</p></div><div className="onboarding-guide-actions">{step === 'import' && <span className="onboarding-primary-target"><PixelArrow/><Button disabled={busy} data-testid="onboarding-import-again" onClick={onImport}><Upload size={15} />选择简历</Button></span>}<Button variant="ghost" disabled={busy} data-testid="onboarding-profile-skip" onClick={onSkip}>收起引导</Button></div></div></section>;
}
