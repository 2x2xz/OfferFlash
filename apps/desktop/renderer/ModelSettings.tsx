import { useState } from 'react';
import type { ModelConfig } from '../../../packages/shared/src/contracts.js';
import { Button, ErrorMessage, Field, Modal, Notice } from './components.js';
import { useWorkspace } from './context.js';
import { errorText } from './helpers.js';

const bailianURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
type Service = 'bailian' | 'deepseek' | 'openai' | 'anthropic' | 'custom';
const serviceNames: Record<Service, string> = { bailian: '阿里云百炼', deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Anthropic', custom: '自定义兼容接口' };
const officialDomains: Partial<Record<Service, string>> = { deepseek: 'api.deepseek.com', openai: 'api.openai.com', anthropic: 'api.anthropic.com' };

export function ModelDialog({ onClose }: { onClose: () => void }) {
  const { api, model, setModel, agentBusy, notify } = useWorkspace();
  const [service, setService] = useState<Service>(() => model.mode === 'live'
    ? (model.baseURL === bailianURL ? 'bailian' : ['deepseek', 'openai', 'anthropic'].includes(model.configurationProvider ?? model.provider) ? (model.configurationProvider ?? model.provider) as Service : 'custom') : 'bailian');
  const [draft, setDraft] = useState<ModelConfig>(() => ({ mode: 'live', provider: 'custom',
    modelId: model.mode === 'live' ? model.modelId : 'qwen-flash', apiKey: '', baseURL: model.mode === 'live' ? model.baseURL ?? '' : bailianURL }));
  const [remember,setRemember]=useState(true);
  const [forgotten,setForgotten]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const compatible = service === 'bailian' || service === 'custom';
  let domain = officialDomains[service] ?? '';
  let endpointError = '';
  if (compatible) {
    try {
      const endpoint = new URL(draft.baseURL?.trim() || '');
      if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
      domain = endpoint.host;
    } catch { endpointError = '请输入有效的 HTTP(S) 服务地址，地址中不能包含账号或密钥。'; }
  }
  const canReuse=!!model.canReuseKey && (compatible?'custom':service)===(model.configurationProvider??model.provider) && (!compatible||(draft.baseURL??'').trim().replace(/\/$/,'')===(model.baseURL??'').trim().replace(/\/$/,''));
  function close() { if (!busy) { setDraft(current => ({ ...current, apiKey: '' })); onClose(); } }
  function selectService(next: Service) {
    setService(next); setError(undefined);
    setDraft(current => ({ ...current, provider: next === 'bailian' ? 'custom' : next,
      modelId: next === 'bailian' ? 'qwen-flash' : '', baseURL: next === 'bailian' ? bailianURL : '', apiKey: '' }));
  }
  async function save() {
    if (busy || agentBusy) return;
    setBusy(true); setError(undefined);
    const key = draft.apiKey.trim();
    try {
      const status = await api.configureModel({ mode: draft.mode, provider: compatible ? 'custom' : service,
        remember,reuseKey:canReuse,modelId: draft.modelId.trim(), apiKey: draft.mode === 'live' ? key : '',
        ...(draft.mode === 'live' && compatible && draft.baseURL?.trim() ? { baseURL: draft.baseURL.trim() } : {}) });
      setModel(status); setDraft(current => ({ ...current, apiKey: '' }));
      notify(status.connectionWarning ?? (status.mode === 'demo' ? '已切换为离线演示，已保存的连接仍保留' : status.remembered ? '连接已应用并加密保存在本机' : '连接已应用，仅本次打开使用')); onClose();
    } catch (err) {
      const message = errorText(err);
      setError(`${key ? message.split(key).join('[密钥已隐藏]') : message} 原有模型配置仍保留，可修改后重试。`);
    } finally { setBusy(false); }
  }
  return <Modal title="连接填写模型" description="连接可加密保存在本机，下次打开自动恢复" onClose={close}
    footer={<><Button variant="secondary" disabled={busy} onClick={close}>取消</Button><Button data-testid="model-apply" busy={busy}
      disabled={agentBusy || (draft.mode === 'live' && (!draft.modelId.trim() || (!draft.apiKey.trim() && !canReuse) || !!endpointError))}
      onClick={() => void save()}>应用配置</Button></>}>
    <ErrorMessage message={error ?? model.connectionWarning} />
    <div className="pill-switch" style={{ marginBottom: 20 }}>
      <button disabled={busy} className={draft.mode === 'demo' ? 'active' : ''} onClick={() => setDraft(current => ({ ...current, mode: 'demo', apiKey: '' }))}>离线演示</button>
      <button disabled={busy} className={draft.mode === 'live' ? 'active' : ''} onClick={() => setDraft(current => ({ ...current, mode: 'live' }))}>我的在线模型</button>
    </div>
    {draft.mode === 'demo' ? <Notice>使用固定演示响应读取本地岗位与申请，无需密钥。要用真实模型识别网申字段，请切换到“我的在线模型”。</Notice> : <>
      <div className="stack">
        <Field label="模型服务"><select disabled={busy} value={service} onChange={event => selectService(event.target.value as Service)}>
          <option value="bailian">阿里云百炼（低成本）</option><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">自定义兼容接口</option>
        </select></Field>
        {service === 'bailian' && <Notice>已预填 qwen-flash 和百炼北京地域地址。请使用该地域可用的 Key；费用以百炼账户实际计费为准。</Notice>}
        <Field label="模型名称" hint="使用该服务商提供的准确模型名称"><input disabled={busy} placeholder="填写模型名称" value={draft.modelId} onChange={event => setDraft(current => ({ ...current, modelId: event.target.value }))} /></Field>
        {compatible && <Field label="兼容接口服务地址" required hint={service === 'bailian' ? '默认北京地域；使用其他地域时，请按百炼控制台地址修改' : '填写你信任的服务地址'}>
          <input disabled={busy} type="url" placeholder="https://..." value={draft.baseURL ?? ''} onChange={event => setDraft(current => ({ ...current, baseURL: event.target.value }))} />
        </Field>}
        {compatible && !!draft.baseURL?.trim() && <ErrorMessage message={endpointError || undefined} />}
        <Field label="API Key" hint="密钥不会回显；修改服务地址后需要重新输入">
          <input disabled={busy} type="password" autoComplete="off" spellCheck={false} data-testid="model-api-key" placeholder={canReuse ? "已配置，留空继续使用" : "粘贴你的密钥"} value={draft.apiKey} onChange={event => setDraft(current => ({ ...current, apiKey: event.target.value }))} />
        </Field>
        <label style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={remember} disabled={busy} onChange={event=>setRemember(event.target.checked)}/>本机加密记住连接，重启后继续使用</label>
        <small>使用系统加密；加密不可用时仅本次使用，不保存明文。连接不随个人资料导出。</small>
        {model.remembered&&!forgotten&&api.forgetModelConnection&&<Button variant="secondary" disabled={busy} data-testid="model-forget" onClick={()=>{setBusy(true);void api.forgetModelConnection!().then(status=>{setModel(status);setForgotten(true);notify('已删除保存的连接，本次连接仍可使用');}).catch(error=>setError(errorText(error))).finally(()=>setBusy(false));}}>忘记已保存的连接</Button>}
        <div className="model-config-summary" aria-live="polite"><strong>本次连接</strong><div>{serviceNames[service]} · {draft.modelId.trim() || '未填写模型'}</div><div>请求域名：{domain || '请填写服务地址'}</div></div>
      </div>
      <div style={{ marginTop: 18 }}><Notice tone="warning">自动填写会发送网页字段、选项及相关的已确认职业经历，供模型匹配和整理草稿。联系方式、出生日期和证件号码不通过职业事实工具发送；原始简历文件不发送。AI 聊天会发送相关上下文。应用配置不会立即调用或测试 API。</Notice></div>
    </>}
  </Modal>;
}
