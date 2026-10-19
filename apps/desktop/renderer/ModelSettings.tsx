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
    ? (['deepseek', 'openai', 'anthropic'].includes(model.provider) ? model.provider as Service : 'custom') : 'bailian');
  const [draft, setDraft] = useState<ModelConfig>(() => ({ mode: 'live', provider: 'custom',
    modelId: model.mode === 'live' ? model.modelId : 'qwen-flash', apiKey: '', baseURL: model.mode === 'live' ? '' : bailianURL }));
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
        modelId: draft.modelId.trim(), apiKey: draft.mode === 'live' ? key : '',
        ...(draft.mode === 'live' && compatible && draft.baseURL?.trim() ? { baseURL: draft.baseURL.trim() } : {}) });
      setModel(status); setDraft(current => ({ ...current, apiKey: '' }));
      notify(status.mode === 'demo' ? '已切换为离线演示' : '模型配置已应用，仅保留在本次打开期间'); onClose();
    } catch (err) {
      const message = errorText(err);
      setError(`${key ? message.split(key).join('[密钥已隐藏]') : message} 原有模型配置仍保留，可修改后重试。`);
    } finally { setBusy(false); }
  }
  return <Modal title="连接填写模型" description="配置一次，就能在网申页识别输入栏；Key 仅在本次打开期间保留" onClose={close}
    footer={<><Button variant="secondary" disabled={busy} onClick={close}>取消</Button><Button busy={busy}
      disabled={agentBusy || (draft.mode === 'live' && (!draft.modelId.trim() || !draft.apiKey.trim() || !!endpointError))}
      onClick={() => void save()}>应用配置</Button></>}>
    <ErrorMessage message={error} />
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
        <Field label="API Key" hint="只保存在本次进程内存，不写磁盘或钥匙串；切换服务会清空输入">
          <input disabled={busy} type="password" autoComplete="off" spellCheck={false} placeholder="粘贴你的密钥" value={draft.apiKey} onChange={event => setDraft(current => ({ ...current, apiKey: event.target.value }))} />
        </Field>
        <div className="model-config-summary" aria-live="polite"><strong>本次连接</strong><div>{serviceNames[service]} · {draft.modelId.trim() || '未填写模型'}</div><div>请求域名：{domain || '请填写服务地址'}</div></div>
      </div>
      <div style={{ marginTop: 18 }}><Notice tone="warning">字段识别仅发送网页字段标签、类型和选项，填写值从本地资料取用。AI 聊天任务会发送相关上下文。应用配置不会立即调用或测试 API。</Notice></div>
    </>}
  </Modal>;
}
