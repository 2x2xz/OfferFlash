'use strict';
const api = window.siteDiagnostic;
const status = document.getElementById('status');
const result = document.getElementById('result');
const read = document.getElementById('read');
const validate = document.getElementById('validate');
let working = false;
const show = value => {
  validate.hidden = !value.labEnabled;
  if (value.labEnabled) {
    document.getElementById('heading').textContent = '飞书适配隔离实验室 · 先手动登录';
    document.getElementById('description').textContent = '结构读取只读。点击隔离验证后先锁写网络，再用虚构履历测试；不提交申请。';
  }
  for (const control of [read, validate, document.getElementById('navigate'), document.getElementById('url')]) {
    control.disabled = working || value.validating || value.reading;
  }
  status.textContent = value.host
    ? `当前网站：${value.host} · 页面类别：${value.pathCategory} · ${value.readable ? '可读取选定网站的结构' : '登录或跳转中，回到选定网站后再读取'}`
    : '尚未选定网站。';
};
document.getElementById('navigation').addEventListener('submit', async event => {
  event.preventDefault();
  result.textContent = '';
  try { show(await api.navigate(document.getElementById('url').value)); }
  catch { result.textContent = '无法打开，请检查 HTTPS 招聘网址。'; }
});
read.addEventListener('click', async () => {
  working = true; read.disabled = true;
  try {
    const response = await api.read();
    show(response.status);
    result.textContent = `已保存过滤后的结构：${response.reportPath}\n字段节点 ${response.fieldCount} 个；分组 ${response.sectionCount} 个；新增控件 ${response.addControlCount} 个。`;
  } catch { result.textContent = '读取未完成：请回到最初选定的网站，并等待页面加载完成后重试。'; }
  finally { working = false; read.disabled = false; }
});
validate.addEventListener('click', async () => {
  working = true;
  for (const control of [read, validate, document.getElementById('navigate'), document.getElementById('url')]) control.disabled = true;
  result.textContent = '隔离验证运行中，请保持本窗口在前台。';
  try {
    const response = await api.validate();
    result.textContent = response.status === 'runner-not-ready'
      ? '适配模块尚未就绪，登录会话保留；模块准备好后可再次点击。'
      : `隔离验证${response.ok ? '完成' : '未通过'}：${response.status}${response.reportPath ? '\n报告：' + response.reportPath : ''}`;
  } catch { result.textContent = '验证未开始或已停止，请确认已回到选定的面壁智能飞书招聘页面。'; }
  finally { working = false; void api.status().then(show).catch(() => {}); }
});
setInterval(() => { void api.status().then(show).catch(() => {}); }, 1500);
