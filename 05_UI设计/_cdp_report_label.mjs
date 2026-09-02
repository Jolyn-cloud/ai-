/** 薄弱点分析文案验证：模拟考场+历年真题「查看报告」已改为「薄弱点分析」 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8777;
const DEVTOOLS_PORT = 9347;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!existsSync(file)) { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeD`]); rm.on('exit', r); });
const chrome = spawn(CHROME, ['--remote-debugging-port=' + DEVTOOLS_PORT, '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${ROOT}/.tmp-chromeD`]);
await new Promise(r => setTimeout(r, 1500));
let ws; const pending = new Map(); let msgId = 0;
function send(method, params = {}) { return new Promise((res, rej) => { const id = ++msgId; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); }); }
async function connect() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${DEVTOOLS_PORT}/json`);
      const page = (await res.json()).find(p => p.type === 'page');
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = evt => { const m = JSON.parse(evt.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
      return;
    } catch (e) { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error('connect fail');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || ''))); if (!cond) failed++; }

await connect();

/* ===== 模拟考场 ===== */
await send('Page.navigate', { url: `http://localhost:${PORT}/模拟考场.html` }); await sleep(1000);
let r = await evalJs(`(function(){
  var btns = Array.prototype.slice.call(document.querySelectorAll('.paper-btn'));
  var lbl = btns.map(function(b){ return b.textContent; });
  return { hasWeak: lbl.indexOf('薄弱点分析') >= 0, hasOld: lbl.indexOf('查看报告') >= 0, btns: lbl };
})()`);
check('模拟考场：卡片含「薄弱点分析」', r.hasWeak === true, JSON.stringify(r.btns));
check('模拟考场：无「查看报告」', r.hasOld === false, JSON.stringify(r.btns));

/* ===== 历年真题 ===== */
await send('Page.navigate', { url: `http://localhost:${PORT}/历年真题.html` }); await sleep(1000);
r = await evalJs(`(function(){
  var btns = Array.prototype.slice.call(document.querySelectorAll('.paper-btn'));
  var lbl = btns.map(function(b){ return b.textContent; });
  return { hasWeak: lbl.indexOf('薄弱点分析') >= 0, hasOld: lbl.indexOf('查看报告') >= 0, btns: lbl };
})()`);
check('历年真题：卡片含「薄弱点分析」', r.hasWeak === true, JSON.stringify(r.btns));
check('历年真题：无「查看报告」', r.hasOld === false, JSON.stringify(r.btns));

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);