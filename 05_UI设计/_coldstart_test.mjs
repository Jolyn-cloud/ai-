/**
 * 冷启动重置 + 首次进题库自动弹 VIP 自测（AI伴学_小程序.html）
 * 运行：node _coldstart_test.mjs
 * 覆盖（2026-08-29 PM 拍板：刷新全重置 + VIP 仅首次进题库弹）：
 *   C1 冷启动 STATE 全默认：logged=false / user=null / vipClaimed=false / profileLevel=none
 *   C2 localStorage 残留 'zsb_state_v1' 被清除
 *   C3 冷启动后刷新，仍是全默认（彻底重置）
 *   C4 切到题库 tab → 自动弹 VIP 福利（benefitMask.show）
 *   C5 弹后刷新 → 冷启动重置，切题库再次可弹（会话锁不持久）
 *   C6 领取后（vipClaimed=true）→ 切题库不再弹
 *   C7 闪卡/我的 tab → 不再弹 VIP（改为仅题库）
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

/* C1 冷启动 STATE 全默认 */
assert(await js(`STATE.logged === false`), 'C1a logged=false');
assert(await js(`STATE.user === null`), 'C1b user=null');
assert(await js(`STATE.vipClaimed === false`), 'C1c vipClaimed=false');
assert(await js(`STATE.profileLevel === 'none'`), 'C1d profileLevel=none');

/* C2 预置污染旧值 → 刷新后不恢复，仍全默认（验证非读取、彻底冷启动） */
await js(`localStorage.setItem('zsb_state_v1', JSON.stringify({logged:true, user:{nick:'旧值',school:'旧校'}, vipClaimed:true, profileLevel:'done'}))`);
await cdp('Page.reload', { ignoreCache: true });
await sleep(1600);
assert(await js(`STATE.logged === false`), 'C2a 预置logged=true → 刷新后仍false（不恢复旧值）');
assert(await js(`STATE.vipClaimed === false`), 'C2b 预置vipClaimed=true → 刷新后仍false');
assert(await js(`STATE.profileLevel === 'none'`), 'C2c 预置profileLevel=done → 刷新后仍none');
assert(await js(`STATE.user === null`), 'C2d 预置user → 刷新后仍null');
assert(await js(`JSON.stringify(JSON.parse(localStorage.getItem('zsb_state_v1') || '{}').logged) === 'false'`), 'C2e 预置后刷新 → 旧logged=true未残留，覆盖为新默认false');

/* C3 刷新重载后仍全默认（彻底冷启动） */
await cdp('Page.reload', { ignoreCache: true });
await sleep(1600);
assert(await js(`STATE.logged === false`), 'C3a 刷新后 logged 仍 false');
assert(await js(`STATE.vipClaimed === false`), 'C3b 刷新后 vipClaimed 仍 false');
assert(await js(`STATE.profileLevel === 'none'`), 'C3c 刷新后 profileLevel 仍 none');

/* C4 首次进题库 tab → 自动弹 VIP */
await js(`switchTab('quiz')`);
await sleep(450);
assert(await js(`document.getElementById('benefitMask').classList.contains('show')`), 'C4a 切题库 → benefitMask.show');
assert(await js(`STATE.vipClaimed === false`), 'C4b 未领取（未到时账）');

/* C5 弹后刷新 → 会话锁不持久，切题库再次可弹 */
await cdp('Page.reload', { ignoreCache: true });
await sleep(1600);
await js(`switchTab('quiz')`);
await sleep(450);
assert(await js(`document.getElementById('benefitMask').classList.contains('show')`), 'C5a 刷新后切题库 → 再次弹 VIP');

/* 关掉弹窗（模拟点X）→ 本会话不再弹 */
await js(`document.getElementById('benefitClose').click()`);
await sleep(250);
await js(`switchTab('study')`);
await sleep(300);
await js(`switchTab('quiz')`);
await sleep(400);
assert(await js(`!document.getElementById('benefitMask').classList.contains('show')`), 'C5b 关过 → 本会话切题库不再弹');

/* C6 领取后 vipClaimed=true → 不再弹（刷新后冷启动先恢复否则会污染） */
await cdp('Page.reload', { ignoreCache: true });
await sleep(1600);
await js(`STATE.vipClaimed = true`);       /* 模拟已领取（真实流程走 claimBenefit 链） */
await js(`switchTab('quiz')`);
await sleep(450);
assert(await js(`!document.getElementById('benefitMask').classList.contains('show')`), 'C6 已领取 → 不再弹');

/* C7 闪卡/我的 → 不再弹 */
await cdp('Page.reload', { ignoreCache: true });
await sleep(1600);
await js(`switchTab('flash')`);
await sleep(350);
assert(await js(`!document.getElementById('benefitMask').classList.contains('show')`), 'C7a 切闪卡 → 不弹');
await js(`switchTab('mine')`);
await sleep(400);
assert(await js(`!document.getElementById('benefitMask').classList.contains('show')`), 'C7b 切我的 → 不弹');

/* C8 刷新后学习页显示「填画像」视图（冷启动 → profileLevel=none → obStart → view-onboard） */
await cdp('Page.reload', { ignoreCache: true });
await sleep(1600);
await js(`switchTab('study')`);
await sleep(600);
const onboardVisible = await js(`(function(){
  var f = document.getElementById('frame-study');
  if (!f || !f.contentDocument) return 'no-frame';
  var v = f.contentDocument.getElementById('view-onboard');
  return v ? (v.className.indexOf('active') !== -1 || v.style.display !== 'none') : 'no-view';
})()`);
assert(onboardVisible === true, 'C8 刷新后学习页进入填画像视图 (view-onboard 可见)');
assert(await js(`document.getElementById('frame-study').contentDocument.getElementById('view-onboard') !== null`), 'C8b 学习页存在 view-onboard');

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
server.close();
process.exit(failed ? 1 : 0);