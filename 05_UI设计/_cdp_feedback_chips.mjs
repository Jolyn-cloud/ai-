/**
 * 反馈弹窗类型（题目组/解析组）渲染断言
 * 运行：node _cdp_feedback_chips.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8768;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9336;

const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path === '/' ? '/做题页.html' : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chrome`]);
await new Promise(r => rm.on('exit', r));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${ROOT}/.tmp-chrome`,
]);
await new Promise(r => setTimeout(r, 1200));

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

const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILED = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else { FAILED++; console.log(`  ❌ ${name} ${extra}`); }
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('顶层异常: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

try {
  console.log('\n== 反馈弹窗类型断言（做题页） ==');
  await connect();
  await send('Page.navigate', { url: `http://localhost:${PORT}/做题页.html?entry=today` });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evalJs(`document.getElementById('fbOptsQ') && document.getElementById('fbOptsA') && document.querySelectorAll('.tag.type').length > 0`);
    if (ready) break;
    await sleep(200);
  }
  check('做题页加载完成', ready === true);

  const q = await evalJs(`Array.prototype.slice.call(document.querySelectorAll('#fbOptsQ .fb-chip')).map(function(c){ return c.getAttribute('data-k'); })`);
  const a = await evalJs(`Array.prototype.slice.call(document.querySelectorAll('#fbOptsA .fb-chip')).map(function(c){ return c.getAttribute('data-k'); })`);
  check('题目反馈 4 类', q.join(',') === '题干错误,选项错误,答案错误,题型错误', `得到: ${q.join(',')}`);
  check('解析反馈 3 类', a.join(',') === '答案解析错误,文字解析错误,图片解析错误', `得到: ${a.join(',')}`);

  const qText = await evalJs(`document.getElementById('fbOptsQ').innerText`);
  const aText = await evalJs(`document.getElementById('fbOptsA').innerText`);
  const oldBad = ['题干文字错误', '题目重复', '题型标注错误', '归类错误', '解析文字错误', '解析逻辑错误', '解析不完整', '图片解析有误'];
  const oldHits = oldBad.filter(function(k){ return qText.indexOf(k) >= 0 || aText.indexOf(k) >= 0; });
  check('旧类型已清除', oldHits.length === 0, `残留: ${oldHits.join(',')}`);

  /* 触发题目反馈弹窗，确认可打开 */
  await evalJs(`openFeedback()`);
  await sleep(300);
  const qModalShown = await evalJs(`document.getElementById('fbModalQuestion').classList.contains('show')`);
  check('题目反馈弹窗可打开', qModalShown === true);
} finally {
  server.close();
  chrome.kill();
}
console.log(FAILED ? `\n❌ ${FAILED} 项断言失败` : '\n✅ 全部断言通过');
process.exit(FAILED ? 1 : 0);
