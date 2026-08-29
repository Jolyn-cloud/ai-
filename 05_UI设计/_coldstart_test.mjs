/**
 * 冷启动登录流程自测（AI伴学_小程序.html）
 * 运行：node _coldstart_test.mjs
 * 覆盖（2026-08-30 登录流程优化：闪屏→题库页→领VIP→领取/关闭→跳AI页填画像→登录 + vipClaimed 持久化）：
 *   C1 冷启动 STATE：logged=false / user=null / profileLevel=none；vipClaimed 首次冷启动=false
 *   C2 localStorage 残留 zsb_state_v1（含旧 vipClaimed:true）不生效（vipClaimed 只认独立 key）
 *   C3 冷启动默认落题库 tab（frame-quiz 可见 / frame-study 懒加载隐藏 / quiz active）
 *   C4 初始进入题库 → 自动弹 VIP（无需手动切 tab）
 *   C5 点 X 关闭 → 本会话不再弹 + 跳学习页
 *   C6 未领取刷新 → 仍弹（未领取 → 每次登录/重开仍显示领取）
 *   C7 未登录点领取 → 弹登录 Sheet
 *   C8 领取路径关登录 → 跳学习页（benefitUsing 保留）
 *   C9 权益线登录成功 → VIP 到账 + 持久化 + 跳学习页
 *   C10 学习页 onboarding（填画像）视图可见
 *   C11 已领取刷新 → 不再弹（首次领取完成后不显示弹窗）
 *   C12 闪卡/我的 tab → 不再弹
 *   C13 已登录点领取 → 直接到账（不弹登录）+ 跳学习页
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8773;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DTP = 9339;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/AI伴学_小程序.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[file.match(/\.\w+$/)?.[0] || ''] || 'octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-coldstart-chrome`]);
await new Promise(r => rm.on('exit', r));
spawn(CHROME, [`--remote-debugging-port=${DTP}`, `--user-data-dir=${ROOT}/.tmp-coldstart-chrome`, '--headless=new', '--disable-gpu', '--window-size=1500,900', 'about:blank']);
await new Promise(r => setTimeout(r, 1400));
let pages;
for (let i = 0; i < 40; i++) {
  try { pages = await (await fetch(`http://127.0.0.1:${DTP}/json`)).json(); if (pages.length) break; } catch (e) {}
  await sleep(250);
}
const page = pages && pages.find(p => p.type === 'page');
if (!page) { console.error('无法连接 Chrome'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, rej) => { ws.onopen = r; ws.onerror = rej; });
let idc = 0; const pending = new Map();
ws.onmessage = evt => { const m = JSON.parse(evt.data.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const cdp = (method, params={}) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const js = async e => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
let passed = 0, failed = 0;
function assert(cond, name) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name); } }

await cdp('Page.enable');
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/AI伴学_小程序.html` });
await sleep(1500);

/* C1 冷启动 STATE：登录/画像全默认，vipClaimed 首次冷启动=false */
assert(await js(`STATE.logged === false`), 'C1a logged=false');
assert(await js(`STATE.user === null`), 'C1b user=null');
assert(await js(`STATE.profileLevel === 'none'`), 'C1c profileLevel=none');
assert(await js(`STATE.vipClaimed === false`), 'C1d vipClaimed=false（首次冷启动无持久记录）');

/* C2 预置污染旧 zsb_state_v1（含 vipClaimed:true）→ 刷新后不恢复（vipClaimed 只认独立 key） */
await js(`localStorage.setItem('zsb_state_v1', JSON.stringify({logged:true, user:{nick:'旧值',school:'旧校'}, vipClaimed:true, profileLevel:'done'}))`);
await cdp('Page.reload', { ignoreCache: true });
await sleep(1800);
assert(await js(`STATE.logged === false`), 'C2a 预置logged=true → 刷新后仍false');
assert(await js(`STATE.profileLevel === 'none'`), 'C2b 预置profileLevel=done → 刷新后仍none');
assert(await js(`STATE.user === null`), 'C2c 预置user → 刷新后仍null');
assert(await js(`STATE.vipClaimed === false`), 'C2d zsb_state_v1 内 vipClaimed=true 不生效（独立 key 为准）');

/* C3 冷启动默认落题库 tab（闪屏后 → 题库页，学习页懒加载） */
assert(await js(`!document.getElementById('frame-quiz').classList.contains('hidden')`), 'C3a frame-quiz 可见（默认落题库）');
assert(await js(`document.getElementById('frame-study').classList.contains('hidden')`), 'C3b frame-study 隐藏（懒加载）');
assert(await js(`document.querySelector('.tab-item[data-frame="quiz"]').classList.contains('active')`), 'C3c quiz tab active');
assert(await js(`document.getElementById('appbarTitle').textContent === '题库'`), 'C3d 顶栏标题=题库');

/* C4 初始进入题库 → 自动弹 VIP（无需手动切 tab） */
assert(await js(`document.getElementById('benefitMask').classList.contains('show')`), 'C4 冷启动进入题库 → 自动弹 VIP');

/* C5 点 X 关闭 → 本会话不再弹 + 跳转学习页 */
await js(`document.getElementById('benefitClose').click()`);
await sleep(400);
assert(await js(`!document.getElementById('benefitMask').classList.contains('show')`), 'C5a 点X → 弹窗隐藏');
assert(await js(`!document.getElementById('frame-study').classList.contains('hidden')`), 'C5b 关闭 → 跳学习页（frame-study 可见）');
assert(await js(`document.getElementById('frame-quiz').classList.contains('hidden')`), 'C5c 已切走 → frame-quiz 隐藏');
await js(`switchTab('quiz')`);
await sleep(400);
assert(await js(`!document.getElementById('benefitMask').classList.contains('show')`), 'C5d 关闭过 → 本会话切回题库不再弹');

/* C6 未领取刷新 → 仍弹（未领取 → 每次登录/重开仍显示领取） */
await cdp('Page.reload', { ignoreCache: true });
await sleep(1800);
assert(await js(`STATE.vipClaimed === false`), 'C6a 刷新后未领取状态保持');
assert(await js(`document.getElementById('benefitMask').classList.contains('show')`), 'C6b 未领取刷新 → 再次弹 VIP');

/* C7 未登录点领取 → 弹登录 Sheet（不立即到账） */
await js(`document.getElementById('benefitCta').click()`);
await sleep(450);
assert(await js(`document.getElementById('loginSheet').classList.contains('show')`), 'C7a 点领取（未登录）→ 弹登录 Sheet');
assert(await js(`STATE.vipClaimed === false`), 'C7b 未登录未到账');

/* C8 领取路径关登录 → 跳学习页（benefitUsing 保留：点过领取，后续登录仍到账） */
await js(`document.getElementById('loginClose').click()`);
await sleep(400);
assert(await js(`!document.getElementById('loginSheet').classList.contains('show')`), 'C8a 登录 Sheet 关闭');
assert(await js(`!document.getElementById('frame-study').classList.contains('hidden')`), 'C8b 领取路径关登录 → 跳学习页');

/* C9 权益线登录成功 → VIP 到账 + 持久化 + 跳学习页 */
await js(`openLoginSheet('benefit')`);
await js(`document.getElementById('loginAgree').checked = true`);
await js(`document.getElementById('loginButton').click()`);
await sleep(500);
assert(await js(`STATE.logged === true`), 'C9a 登录成功 logged=true');
assert(await js(`STATE.vipClaimed === true`), 'C9b 权益线登录 → VIP 到账');
assert(await js(`localStorage.getItem('zsb_vip_claimed_v1') === '1'`), 'C9c vipClaimed 持久化写入 zsb_vip_claimed_v1');
assert(await js(`!document.getElementById('loginSheet').classList.contains('show')`), 'C9d 登录 Sheet 关闭');
assert(await js(`!document.getElementById('frame-study').classList.contains('hidden')`), 'C9e 登录成功 → 跳学习页');

/* C10 学习页 onboarding（填画像）视图可见（未画像 → 填画像） */
await sleep(1500);
const onboardActive = await js(`(function(){
  var f = document.getElementById('frame-study');
  if (!f || !f.contentDocument) return 'no-frame';
  var v = f.contentDocument.getElementById('view-onboard');
  return v ? (v.className.indexOf('active') !== -1 || v.style.display !== 'none') : 'no-view';
})()`);
assert(onboardActive === true, 'C10 跳学习页 → 填画像视图可见（view-onboard active）');

/* C11 已领取刷新 → 不再弹（首次领取完成后不显示弹窗） */
await cdp('Page.reload', { ignoreCache: true });
await sleep(1800);
assert(await js(`STATE.vipClaimed === true`), 'C11a 刷新后 vipClaimed 持久为 true');
assert(await js(`!document.getElementById('benefitMask').classList.contains('show')`), 'C11b 已领取刷新 → 不再弹');

/* C12 闪卡/我的 → 不再弹（仅题库触发） */
await js(`switchTab('flash')`);
await sleep(400);
assert(await js(`!document.getElementById('benefitMask').classList.contains('show')`), 'C12a 切闪卡 → 不弹');
await js(`switchTab('mine')`);
await sleep(400);
assert(await js(`!document.getElementById('benefitMask').classList.contains('show')`), 'C12b 切我的 → 不弹');

/* C13 已登录点领取 → 直接到账（不弹登录）+ 跳学习页 */
await js(`STATE.vipClaimed = false; STATE.logged = true; benefitClosed = false; benefitShown = false;`);
await js(`switchTab('quiz')`);
await sleep(400);
assert(await js(`document.getElementById('benefitMask').classList.contains('show')`), 'C13a 重置会话锁后切题库 → 弹 VIP');
await js(`document.getElementById('benefitCta').click()`);
await sleep(450);
assert(await js(`STATE.vipClaimed === true`), 'C13b 已登录点领取 → 直接到账');
assert(await js(`!document.getElementById('loginSheet').classList.contains('show')`), 'C13c 已登录点领取 → 不弹登录');
assert(await js(`!document.getElementById('frame-study').classList.contains('hidden')`), 'C13d 已登录点领取 → 跳学习页');

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
server.close();
process.exit(failed ? 1 : 0);