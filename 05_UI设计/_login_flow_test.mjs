/**
 * 登录页流程自测（登录演示.html）
 * 运行：node _login_flow_test.mjs
 * 前置：Chrome headless（脚本自动起）
 * 覆盖：
 *   F1 首页加载 → 闪屏视图默认激活
 *   F2 2s 后自动跳登录页
 *   F3 不勾协议 → 主按钮 disable
 *   F4 勾协议 → 主按钮可点，点后 450ms 进首页 + 已登录态
 *   F5 游客先逛逛 → 游客态首页；点 VIP 卡 → 引导 Sheet 出现
 *   F6 Sheet「暂不需要」→ 关闭且仍游客；Sheet「微信登录」→ 已登录 + VIP 到账
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8766;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9334;

/* ---------- 静态文件服务 ---------- */
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/登录演示.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

/* ---------- 启动 Chrome（独立 profile）---------- */
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-login-chrome`]);
await new Promise(r => rm.on('exit', r));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`,
  `--user-data-dir=${ROOT}/.tmp-login-chrome`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
]);
await new Promise(r => setTimeout(r, 1200));

let idc = 0;
const pending = new Map();
let ws;
async function cdp(method, params = {}) {
  const id = ++idc;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/* ---------- 工具 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result.value;
}
async function waitFor(expr, timeout = 5000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evalJs(expr)) return; } catch (e) {}
    await sleep(120);
  }
  throw new Error('timeout: ' + label);
}
let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

/* ---------- 启动 CDP ---------- */
await sleep(300);
let pageWsUrl;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`);
    const pages = await r.json();
    const page = pages.find(p => p.type === 'page');
    if (page) { pageWsUrl = page.webSocketDebuggerUrl; break; }
  } catch (e) {}
  await sleep(200);
}
if (!pageWsUrl) { console.error('无法连接 Chrome'); process.exit(1); }
ws = new WebSocket(pageWsUrl);
await new Promise((r, rej) => { ws.onopen = r; ws.onerror = rej; });
ws.onmessage = evt => {
  const m = JSON.parse(evt.data.toString());
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
};
await cdp('Page.enable');
await cdp('Runtime.enable');

const base = `http://127.0.0.1:${PORT}/登录演示.html`;

/* ================= 用例 ================= */
console.log('\n登录页流程自测');

/* F1 首页加载 → 闪屏激活 */
await cdp('Page.navigate', { url: base });
await waitFor(`document.readyState === 'complete'`, 5000, '页面加载');
await sleep(300);
assert(await evalJs(`document.getElementById('view-splash').classList.contains('active')`), 'F1 闪屏视图默认激活');

/* F2 2s 后自动进登录页 */
await sleep(2100);
assert(await evalJs(`document.getElementById('view-login').classList.contains('active')`), 'F2 闪屏 2s 后自动进入登录页');
assert(await evalJs(`document.getElementById('wechatBtn').classList.contains('disable') === false`), 'F2b 登录按钮默认可点（协议默认勾选）');

/* F3 取消勾选协议 → 主按钮 disable */
await evalJs(`document.getElementById('agreeBox').checked=false; syncLoginBtn()`);
assert(await evalJs(`document.getElementById('wechatBtn').classList.contains('disable')`), 'F3 不勾协议 → 主按钮置灰');

/* F4 勾选 → 可点 → 授权 450ms → 首页 + 已登录 VIP */
await evalJs(`document.getElementById('agreeBox').checked=true; syncLoginBtn()`);
assert(await evalJs(`document.getElementById('wechatBtn').classList.contains('disable') === false`), 'F4a 勾选后主按钮恢复');
await evalJs(`document.getElementById('wechatBtn').click()`);
await sleep(600);
assert(await evalJs(`document.getElementById('view-home').classList.contains('active')`), 'F4b 登录成功进入首页');
assert(await evalJs(`document.getElementById('stateChipText').textContent === '已登录'`), 'F4c 首页状态徽标=已登录');
assert(await evalJs(`document.getElementById('vLogged').textContent === '已登录'`), 'F4d 状态电子登录态=已登录');
assert(await evalJs(`document.getElementById('vVip').textContent === '已领取'`), 'F4e 状态电子 VIP=已领取');

/* F5 重置 → 游客先逛逛 → 首页游客态 → 点 VIP 卡弹 Sheet */
await evalJs(`location.reload()`);
await sleep(2600);
assert(await evalJs(`document.getElementById('view-login').classList.contains('active')`), 'F5a 重置后回到登录页');
await evalJs(`document.getElementById('guestBtn').click()`);
await sleep(200);
assert(await evalJs(`document.getElementById('view-home').classList.contains('active')`), 'F5b 游客先进首页');
assert(await evalJs(`document.getElementById('stateChipText').textContent === '游客访问'`), 'F5c 首页状态徽标=游客');
await evalJs(`document.getElementById('vipCard').click()`);
await sleep(200);
assert(await evalJs(`document.getElementById('guideMask').classList.contains('show')`), 'F5d 游客点 VIP 卡 → 引导 Sheet 出现');

/* F6 Sheet「暂不需要」→ 关 Sheet 仍游客 */
await evalJs(`document.querySelector('.btn-sec').click()`);
await sleep(200);
assert(await evalJs(`document.getElementById('guideMask').classList.contains('show') === false`), 'F6a 暂不需要 → Sheet 关闭');
assert(await evalJs(`document.getElementById('stateChipText').textContent === '游客访问'`), 'F6b 仍是游客态');

/* F6c 再次点 VIP → Sheet → 微信登录 → 已登录 */
await evalJs(`document.getElementById('vipCard').click()`);
await sleep(200);
await evalJs(`document.querySelector('.btn-prime').click()`);
await sleep(200);
assert(await evalJs(`document.getElementById('stateChipText').textContent === '已登录'`), 'F6c Sheet 登录 → 已登录态');

/* F7 已登录后点 VIP 卡 → 直接 toaster 到账不再弹 Sheet */
await evalJs(`document.getElementById('vipCard').click()`);
await sleep(150);
assert(await evalJs(`document.getElementById('guideMask').classList.contains('show') === false`), 'F7 已登录点 VIP 卡不弹 Sheet');

/* ---------- 汇总 ---------- */
console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
chrome.kill();
server.close();
process.exit(failed ? 1 : 0);