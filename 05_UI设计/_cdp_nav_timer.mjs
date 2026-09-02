/** 做题页导航验证：练习类隐藏计时 / 考试保留倒计时 / 模式切换按钮加大 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8770;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9340;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/做题页.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeB`]); rm.on('exit', r); });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`, '--headless=new', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${ROOT}/.tmp-chromeB`,
]);
await new Promise(r => setTimeout(r, 1500));
let ws; const pending = new Map(); let msgId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
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
  if (r.exceptionDetails) throw new Error('异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || ''))); if (!cond) failed++; }

await connect();
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(900); };

/* 1. 练习类（章节）→ 计时隐藏 */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=chapter`);
let r = await evalJs(`(function(){
  var nt = document.getElementById('navTimer');
  var m0 = document.getElementById('modeExam'), m1 = document.getElementById('modeStudy');
  var cs = getComputedStyle(m0);
  return {
    timerDisplay: nt.style.display,       /* none=隐藏 */
    IS_PAPER: IS_PAPER,                   /* false */
    modeExamPad: cs.padding,              /* 变大验证 */
    modeExamFont: cs.fontSize,
    modeSwitchBg: getComputedStyle(document.querySelector('.mode-switch')).backgroundColor,
    btnActiveFont: (m0.classList.contains('active') ? cs.fontWeight : null)
  };
})()`);
check('练习类 IS_PAPER=false', r.IS_PAPER === false, r.IS_PAPER);
check('练习类计时隐藏 (display:none)', r.timerDisplay === 'none', r.timerDisplay);
check('模式按钮 padding ≥ 7px 18px', r.modeExamPad === '7px 18px', r.modeExamPad);
check('模式按钮字号 ≥ 13px', parseFloat(r.modeExamFont) >= 13, r.modeExamFont);

/* 2. 考试模式 → 计时显示 + 倒计时 */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=exam&paperId=exam1&minutes=5&fullScore=150`);
r = await evalJs(`(function(){
  var nt = document.getElementById('navTimer');
  return {
    timerDisplay: nt.style.display,
    IS_PAPER: IS_PAPER,
    txt: nt.textContent,
    endAtSet: !!endAt
  };
})()`);
check('考试模式 IS_PAPER=true', r.IS_PAPER === true, r.IS_PAPER);
check('考试模式计时显示', r.timerDisplay !== 'none', r.timerDisplay);
check('考试模式显示倒计时 (MM:SS, 100分钟卷→100:00)', r.txt === '100:00', r.txt);
check('考试模式 endAt 已设', r.endAtSet === true, r.endAtSet);

/* 3. 背题按钮存在且可切换 */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=chapter`);
r = await evalJs(`(function(){
  var m1 = document.getElementById('modeStudy');
  return { exists: !!m1, txt: m1 ? m1.textContent : null };
})()`);
check('背题按钮存在', r.exists && r.txt === '背题', r.txt);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);