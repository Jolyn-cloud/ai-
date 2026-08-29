/**
 * 学习页逻辑说明面板自测（AI伴学_小程序.html）
 * 运行：node _study_logic_test.mjs
 * 覆盖：
 *   S1 初始面板默认「学习页」（闪屏+AI对话首页），胶囊高亮 learning
 *   S2 学习页面板内容：闪屏一句 + AI 首页 sections ≥4
 *   S3 点「学习页」胶囊 → 手机壳切到 study tab + 面板保持学习页
 *   S4 点「首页」胶囊 → 面板切到闪卡首页（view-home），学习页不误发闪卡跳转
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8769;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DTP = 9337;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/AI伴学_小程序.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[file.match(/\.\w+$/)?.[0] || ''] || 'octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-study-chrome`]);
await new Promise(r => rm.on('exit', r));
spawn(CHROME, [`--remote-debugging-port=${DTP}`, `--user-data-dir=${ROOT}/.tmp-study-chrome`, '--headless=new', '--disable-gpu', '--window-size=1500,900', 'about:blank']);
await new Promise(r => setTimeout(r, 1400));
let pages;
for (let i = 0; i < 40; i++) {
  try { pages = await (await fetch(`http://127.0.0.1:${DTP}/json`)).json(); if (pages.find(p => p.type === 'page')) break; } catch (e) {}
  await sleep(250);
}
const page = pages && pages.find(p => p.type === 'page');
if (!page) { console.error('无法连接 Chrome'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, rej) => { ws.onopen = r; ws.onerror = rej; });
let idc = 0; const pending = new Map();
ws.onmessage = evt => { const m = JSON.parse(evt.data.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const cdp = (method, params={}) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const js = async e => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

let passed = 0, failed = 0;
function assert(cond, name) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name); } }

await cdp('Page.enable');
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/AI伴学_小程序.html` });
await sleep(3500);

/* S1 初始默认学习页 */
assert(await js(`activePanel === 'view-study'`), 'S1a 初始 activePanel=view-study');
assert(await js(`document.querySelector('#viewSwitch .view-chip.active').getAttribute('data-view') === 'view-study'`), 'S1b 初始胶囊高亮=学习页');
assert(await js(`document.querySelector('.logic-body .logic-desc').textContent.includes('学习页')`), 'S1c 面板 desc 含「学习页」');

/* S2 学习页面板内容：闪屏一句 + sections */
assert(await js(`PANELS['view-study'].sections.length >= 2`), 'S2a 学习页面板≥2节');
const splashText = await js(`document.querySelectorAll('.logic-sec')[0].querySelector('.sec-name').textContent`);
assert(splashText.includes('品牌闪屏'), 'S2b 第一节=品牌闪屏');
const secCount = await js(`document.querySelectorAll('.logic-sec').length`);
const secTotal = await js(`PANELS['view-study'].sections.length`);
assert(secCount === secTotal, `S2c 渲染 section 数与数据一致(${secCount})`);

/* S3 点学习页胶囊 → 切 study tab + 面板仍学习页 */
await js(`document.querySelector('.view-chip[data-view="view-study"]').click()`);
await sleep(300);
assert(await js(`activePanel === 'view-study'`), 'S3a 点学习页胶囊后 activePanel 仍 study');
assert(await js(`document.querySelector('#frame-study').classList.contains('hidden') === false`), 'S3b 手机壳切到 study tab');

/* S4 点首页胶囊 → 面板切闪卡首页，且不发 REQUEST_NAV 给 flash（学习页逻辑独立） */
await js(`document.querySelector('.view-chip[data-view="view-home"]').click()`);
await sleep(300);
assert(await js(`activePanel === 'view-home'`), 'S4a 点首页胶囊 → activePanel=view-home（闪卡首页）');
assert(await js(`document.querySelector('#viewSwitch .view-chip.active').getAttribute('data-view') === 'view-home'`), 'S4b 高亮随动');

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
server.close();
process.exit(failed ? 1 : 0);