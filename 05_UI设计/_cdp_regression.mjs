/**
 * CDP 跨 tab 联动 + VIP 流程回归
 * 运行：node _cdp_regression.mjs
 * 前置：Chrome headless 以 --remote-debugging-port 启动（脚本自动）
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9333;

/* ---------- 静态文件服务 ---------- */
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/小程序总壳.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

/* ---------- 启动 Chrome ---------- */
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${ROOT}/.tmp-chrome`,
]);
await new Promise(r => setTimeout(r, 1200));

/* ---------- CDP 客户端 ---------- */
let ws;
const pending = new Map();
let msgId = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function connect() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${DEVTOOLS_PORT}/json`);
      const pages = await res.json();
      const page = pages.find(p => p.type === 'page');
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = evt => {
        const m = JSON.parse(evt.data);
        if (m.id && pending.has(m.id)) {
          const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
          m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        }
      };
      await send('Page.enable');
      return page;
    } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('无法连接 CDP');
}

/* ---------- 工具 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILED = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else { FAILED++; console.log(`  ❌ ${name} ${extra}`); }
}

/* 在顶层 frame 执行 */
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('顶层异常: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

/* 等待 iframe 就绪，并在该 iframe window 上下文里执行表达式。
   用 contentWindow.eval：表达式内的 document/函数 解析到 iframe 全局。 */
async function evalIn(name, expr) {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evalJs(`(function(){ var f = document.getElementById('frame-${name}'); return !!(f && f.contentWindow && f.contentWindow.document && f.contentWindow.document.body && f.contentWindow.document.body.children.length); })()`);
    if (ready) break;
    await sleep(150);
  }
  if (!ready) throw new Error(`iframe ${name} 未就绪`);
  const r = await send('Runtime.evaluate', {
    expression: `(function(){ return document.getElementById('frame-${name}').contentWindow.eval(${JSON.stringify(expr)}); })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(`iframe ${name} 异常: ` + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

/* ---------- 主流程 ---------- */
try {
  console.log('\n== 1. 打开总壳 ==');
  await connect();
  await send('Page.navigate', { url: `http://localhost:${PORT}/小程序总壳.html` });
  await sleep(3500); // 闪屏 2.5s

  // 初始：我的 tab 未登录
  await evalJs(`document.querySelector('.tab-item[data-frame="mine"]').click()`);
  let userName = await evalIn('mine', `document.getElementById('userName').textContent`);
  check('初始未登录', userName === '未登录', `得到: ${userName}`);

  // 学习 tab 点补全资料 → 触发 VIP 福利弹窗（第一次）
  await evalJs(`document.querySelector('.tab-item[data-frame="study"]').click()`);
  await evalIn('study', `openProfile(); 'ok'`);
  await sleep(200);
  let vipMaskShown = await evalIn('study', `document.getElementById('vipMask').classList.contains('show')`);
  check('第一次点功能弹 VIP 福利', vipMaskShown === true);

  // 立即领取 → 总壳 VIP 层
  await evalIn('study', `takeVip(); 'ok'`);
  await sleep(400);
  let vipLayerShown = await evalJs(`document.getElementById('vipLayer').classList.contains('show')`);
  check('VIP 领取层弹出', vipLayerShown === true);

  // VIP 页登录
  await evalIn('vip', `(function(){ var box = document.getElementById('agreeBox'); if (!box.checked) box.click(); document.getElementById('loginBtn').click(); return 'ok'; })()`);
  await sleep(500);
  let vipSuccess = await evalIn('vip', `!document.getElementById('boxSuccess').classList.contains('hidden')`);
  check('VIP 页领取成功态', vipSuccess === true);

  // 总壳 STATE 更新
  await sleep(200);
  let shellState = await evalJs(`JSON.stringify({logged: STATE.logged, vipClaimed: STATE.vipClaimed})`);
  const st = JSON.parse(shellState);
  check('总壳 STATE 已更新(登录+VIP)', st.logged === true && st.vipClaimed === true, shellState);

  // goExperience → 回学习 tab
  await evalIn('vip', `document.querySelector('#boxSuccess .btn-primary').click(); 'ok'`);
  await sleep(400);

  // 我的 tab：已登录 + VIP 副文案
  await evalJs(`document.querySelector('.tab-item[data-frame="mine"]').click()`);
  await sleep(300);
  userName = await evalIn('mine', `document.getElementById('userName').textContent`);
  const vipSub = await evalIn('mine', `document.querySelector('.vip-card .vip-sub').textContent`);
  check('我的页显示已登录', userName === '团团酱', `得到: ${userName}`);
  check('我的页 VIP 副文案更新', vipSub.includes('已生效'), `得到: ${vipSub}`);

  // 学习页不再弹 VIP（已领取），直达画像
  await evalJs(`document.querySelector('.tab-item[data-frame="study"]').click()`);
  await sleep(300);
  await evalIn('study', `openProfile(); 'ok'`);
  await sleep(200);
  const profileShown = await evalIn('study', `document.getElementById('profileMask').classList.contains('show')`);
  check('已领取后不再弹 VIP，直达画像', profileShown === true);

  // 保存画像 → 我的页已完善
  await evalIn('study', `doSaveProfile(); 'ok'`);
  await sleep(300);
  await evalJs(`document.querySelector('.tab-item[data-frame="mine"]').click()`);
  await sleep(300);
  const profileTag = await evalIn('mine', `document.getElementById('profileTag').textContent`);
  check('我的页画像已完善', profileTag === '已完善', `得到: ${profileTag}`);

  // 我的页点「完善资料」→ 转发总壳 → 学习页直达画像（登录态下不再弹 VIP）
  await evalIn('mine', `document.querySelector('.list-row[onclick="navProfile()"]').click(); 'ok'`);
  await sleep(500);
  const profileFromMine = await evalIn('study', `document.getElementById('profileMask').classList.contains('show')`);
  check('我的页完善资料转发 → 学习页弹画像', profileFromMine === true);

  console.log(`\n== 结果: ${FAILED === 0 ? '全部通过 ✅' : FAILED + ' 项失败 ❌'} ==`);
} catch (e) {
  console.error('测试中断:', e.message);
  FAILED++;
} finally {
  try { server.close(); } catch {}
  chrome.kill();
  process.exit(FAILED === 0 ? 0 : 1);
}