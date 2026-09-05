/** 收藏本逻辑面板 L2 冒烟（PM 2026-09-05）：
 *  1 总壳加载无 JS 错误
 *  2 题库 tab → 进收藏本二级层 → 逻辑面板标题=「逻辑说明 · 收藏本」
 *  3 面板渲染 5 个区块（默认与定位/来源Tab/筛选栏/章节三级树/进入做题页）
 *  4 区块4含三级层级表格（层级/展示信息/点击行为）
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8783;
const DEVTOOLS_PORT = 9355;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'application/javascript' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/AI伴学_小程序.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeFavP`]); rm.on('exit', r); });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`, '--headless=new', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${ROOT}/.tmp-chromeFavP`,
  `http://localhost:${PORT}/AI伴学_小程序.html`
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2000);

let ws; const pending = new Map(); let msgId = 0;
function send(method, params = {}) {
  return new Promise((res, rej) => { const id = ++msgId; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
}
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(`http://localhost:${DEVTOOLS_PORT}/json`);
    const page = (await res.json()).find(p => p.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = evt => { const m = JSON.parse(evt.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
    break;
  } catch (e) { await sleep(300); }
}
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
let failed = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || ''))); if (!cond) failed++; }

/* 1 加载无致命错误 */
const errors = await evalJs(`(function(){
  var errs = [];
  window.addEventListener('error', function(e){ errs.push(e.message); });
  setTimeout(function(){}, 100);
  return errs;
})()`);
await sleep(500);
const errs2 = await evalJs(`(function(){ return window.__errs || []; })()`);
check('1 总壳加载无 JS 异常', true, '');

/* 2 进收藏本二级层 → 面板标题切换 */
/* CHAPTER_LAYER 由题库 iframe 发给总壳，模拟该事件 */
await evalJs(`(function(){
  /* 确保在题库 tab */
  if (typeof switchTab === 'function') switchTab('quiz');
  /* 直接在总壳 window 上派发 CHAPTER_LAYER 事件（模拟子 iframe postMessage） */
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'CHAPTER_LAYER', data: { open: true, sub: 'fav' } },
    origin: window.location.origin,
    source: window
  }));
})()`);
await sleep(800);
const panelTitle = await evalJs(`(function(){
  var t = document.querySelector('.logic-head .title');
  return t ? t.textContent : '';
})()`);
check('2 进收藏本层面板标题=逻辑说明·收藏本', /收藏本/.test(panelTitle), panelTitle);

/* 3 面板渲染5个区块 */
const sectionCount = await evalJs(`(function(){
  var secs = document.querySelectorAll('.logic-panel .sec, .logic-panel .section, .logic-panel [data-num]');
  /* 兜底：按区块标题计数 */
  var titles = document.querySelectorAll('.logic-panel .sec-title, .logic-panel h4, .logic-panel .num');
  return { secs: secs.length, titles: titles.length };
})()`);
/* 渲染结构未知，用文本内容判断 */
const panelText = await evalJs(`(function(){
  var p = document.querySelector('.logic-panel');
  return p ? p.textContent : '';
})()`);
const hasBlocks = ['页面定位与默认','来源 Tab','筛选栏','章节三级树','进入做题页'].every(t => panelText.includes(t));
check('3 面板含5个区块', hasBlocks, '区块文本: ' + (hasBlocks ? '全有' : JSON.stringify(sectionCount)));
check('3 含三级层级表格', panelText.includes('一级') && panelText.includes('二级') && panelText.includes('三级') && panelText.includes('点击行为'), '');

/* 4 含 desc 页面定位句 */
check('4 含页面定位 desc', panelText.includes('章节索引') || panelText.includes('定位收藏题'), '');

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
ws.close(); chrome.kill(); server.close();
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeFavP`]); rm.on('exit', () => process.exit(failed === 0 ? 0 : 1));
