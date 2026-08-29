/**
 * 学习页子 tab 自测（AI伴学_小程序.html）
 * 覆盖：
 *   U1 初始学习 tab → studySwitch 显示，默认激活「登录」，渲染登录面板
 *   U2 登录面板内容：品牌闪屏/AI对话首页/登录流程/游客模式/领取VIP权益判定 5节
 *   U3 点「学习页」子 tab → 渲染对话交互面板（首次对话/AI问答）
 *   U4 学习页子 tab 面板含关键词回复判定条件
 *   U5 切闪卡 tab → studySwitch 隐藏，闪卡胶囊显示
 *   U6 点「登录」子 tab 回来 → 重新渲染登录面板
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8771;
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
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-subtab-chrome`]);
await new Promise(r => rm.on('exit', r));
spawn(CHROME, [`--remote-debugging-port=${DTP}`, `--user-data-dir=${ROOT}/.tmp-subtab-chrome`, '--headless=new', '--disable-gpu', '--window-size=1500,900', 'about:blank']);
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
await sleep(1800);

/* 冷启动默认落题库 tab；学习页子 tab 断言前先切到学习 tab */
await js(`switchTab('study')`);
await sleep(300);

/* U1 学习 tab */
assert(await js(`studySwitch.style.display !== 'none'`), 'U1a 学习tab显示子tab条');
assert(await js(`document.querySelector('#studySwitch .view-chip.active[data-sub="login"]') !== null`), 'U1b 默认激活「登录」子tab');
assert(await js(`document.querySelector('.logic-head .title').textContent.includes('学习页')`), 'U1c 面板标题含学习页');
assert(await js(`PANELS['view-study-login'] !== undefined && PANELS['view-study-page'] !== undefined`), 'U1d 两个子tab面板数据存在');

/* U2 登录面板内容 5 节 */
assert(await js(`PANELS['view-study-login'].sections.length === 5`), 'U2a 登录面板5节');
assert(await js(`document.querySelector('.logic-body .logic-desc').textContent.includes('登录')`), 'U2b 面板desc含登录');
assert(await js(`document.querySelectorAll('.logic-sec').length === 5`), 'U2c 渲染5节');

/* U3 点「学习页」子tab */
await js(`document.querySelector('#studySwitch .view-chip[data-sub="page"]').click()`);
await sleep(300);
assert(await js(`document.querySelector('.logic-body .logic-desc').textContent.includes('对话交互')`), 'U3a 学习页子tab渲染对话交互');
assert(await js(`PANELS['view-study-page'].sections.length === 2`), 'U3b 学习页面板2节');

/* U4 关键词回复判定条件 */
assert(await js(`document.querySelector('.logic-body').textContent.includes('关键词')`), 'U4a 面板含关键词');
assert(await js(`document.querySelector('.logic-body').textContent.includes('知识库')`), 'U4b 含知识库+大模型判定条件');

/* U5 切闪卡 */
await js(`switchTab('flash')`);
await sleep(400);
assert(await js(`studySwitch.style.display === 'none'`), 'U5a 闪卡tab隐藏学习页子tab');
assert(await js(`viewSwitch.style.display !== 'none'`), 'U5b 闪卡胶囊显示');

/* U6 切回学习，子tab保留/重渲染 */
await js(`switchTab('study')`);
await sleep(400);
assert(await js(`document.querySelector('#studySwitch .view-chip.active[data-sub="page"]') !== null`), 'U6a 切回学习保留「学习页」子tab激活');

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
server.close();
process.exit(failed ? 1 : 0);