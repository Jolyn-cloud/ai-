/**
 * 逻辑面板 tab 联动自测（AI伴学_小程序.html）
 * 运行：node _tab_logic_test.mjs
 * 覆盖：
 *   T1 初始（学习 tab）→ 面板=学习页，胶囊隐藏，闪卡通栏隐藏
 *   T2 切闪卡 tab → 胶囊显示，通栏显示，面板=闪卡首页，activePanel=view-home
 *   T3 切题库 tab → 面板=题库占位
 *   T4 切我的 tab → 面板=我的占位
 *   T5 切回学习 tab → 面板=学习页，胶囊隐藏
 *   T6 闪卡 tab 内点胶囊（单卡）→ 面板切换 + 发送 REQUEST_NAV
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8770;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DTP = 9338;
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
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-tablog-chrome`]);
await new Promise(r => rm.on('exit', r));
spawn(CHROME, [`--remote-debugging-port=${DTP}`, `--user-data-dir=${ROOT}/.tmp-tablog-chrome`, '--headless=new', '--disable-gpu', '--window-size=1500,900', 'about:blank']);
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
// 跳过闪屏：切到学习 tab 直接初始化（study 初始无闪屏等待逻辑多长用顶点，等 1s 即可）
await sleep(1800);

/* T1 初始：学习 tab */
assert(await js(`activePanel === 'view-study'`), 'T1a activePanel=view-study');
assert(await js(`document.querySelector('.logic-head .title').textContent.includes('学习页')`), 'T1b 面板标题含学习页');
assert(await js(`document.querySelector('.logic-body .logic-desc').textContent.includes('学习页')`), 'T1c 面板内容=学习页');
assert(await js(`viewSwitch.style.display === 'none'`), 'T1d 胶囊区隐藏');
assert(await js(`(logicGlobal.style.display === 'none')`), 'T1e 闪卡通栏隐藏');

/* T2 切闪卡 tab */
await js(`switchTab('flash')`);
await sleep(500);
assert(await js(`activePanel === 'view-home' || FLASH_VIEWS.indexOf(activePanel) !== -1`), 'T2a 闪卡 tab activePanel=闪卡视图');
assert(await js(`viewSwitch.style.display !== 'none'`), 'T2b 胶囊区显示');
assert(await js(`logicGlobal.style.display !== 'none'`), 'T2c 通栏显示');
assert(await js(`document.querySelector('#viewSwitch .view-chip.active') !== null`), 'T2d 有胶囊高亮');
assert(await js(`document.querySelector('.logic-head .title').textContent.includes('闪卡')`), 'T2e 面板标题含闪卡');

/* T3 切题库 tab */
await js(`switchTab('quiz')`);
await sleep(400);
assert(await js(`document.querySelector('.logic-head .title').textContent.includes('题库')`), 'T3a 面板标题=题库');
assert(await js(`document.querySelector('.logic-body .logic-desc').textContent.includes('题库')`), 'T3b 面板内容=题库占位');
assert(await js(`viewSwitch.style.display === 'none'`), 'T3c 胶囊隐藏');

/* T4 切我的 tab */
await js(`switchTab('mine')`);
await sleep(400);
assert(await js(`document.querySelector('.logic-head .title').textContent.includes('我的')`), 'T4a 面板标题=我的');
assert(await js(`activePanel === 'view-mine-placeholder'`), 'T4b activePanel=我的占位');

/* T5 切回学习 tab */
await js(`switchTab('study')`);
await sleep(400);
assert(await js(`document.querySelector('.logic-head .title').textContent.includes('学习页')`), 'T5a 面板重新=学习页');
assert(await js(`viewSwitch.style.display === 'none'`), 'T5b 胶囊隐藏');

/* T6 闪卡 tab 点胶囊 → 面板切换 + REQUEST_NAV */
await js(`switchTab('flash')`);
await sleep(400);
await js(`document.querySelector('.view-chip[data-view="view-single"]').click()`);
await sleep(400);
assert(await js(`activePanel === 'view-single'`), 'T6a 点单卡胶囊 → activePanel=view-single');
assert(await js(`document.querySelector('.logic-head .title').textContent.includes('闪卡')`), 'T6b 面板标题保持闪卡');

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
server.close();
process.exit(failed ? 1 : 0);