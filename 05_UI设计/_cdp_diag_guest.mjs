/** 诊断：未登录题库页显示体验卷/定制卷
    冷启动（未登录）→ 切题库 tab → 抓题库页 SHELL_STATE / isGuest / trialExperienced / aiCard 渲染
    运行：node _cdp_diag_guest.mjs */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8792;
const DEVTOOLS_PORT = 9382;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, p === '/' ? '/AI伴学_小程序.html' : p);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
const DIR = `${ROOT}/.tmp-chromeG`;
await new Promise(r => { const rm = spawn('rm', ['-rf', DIR]); rm.on('exit', r); });
const chrome = spawn(CHROME, ['--remote-debugging-port=' + DEVTOOLS_PORT, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${DIR}`]);
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
      await send('Page.enable');
      return;
    } catch (e) { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error('connect fail');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('顶层异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
function evalIn(name, expr) {
  return send('Runtime.evaluate', {
    expression: `(function(){ return document.getElementById('frame-${name}').contentWindow.eval(${JSON.stringify(expr)}); })()`,
    returnByValue: true, awaitPromise: true
  }).then(r => { if (r.exceptionDetails) throw new Error('iframe ' + name + ' 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; });
}

try {
  await connect();
  await evalJs(`location.href = 'http://localhost:${PORT}/AI伴学_小程序.html'`);
  await sleep(1200);  // 等总壳冷启动 + switchTab('quiz')

  // 总壳 STATE
  const shellState = await evalJs(`JSON.stringify(STATE)`);
  console.log('总壳 STATE =', shellState);

  // localStorage 持久键
  const ls = await evalJs(`JSON.stringify({ state: localStorage.getItem('zsb_state_v1'), trial: localStorage.getItem('zsb_trial_done_v1'), vip: localStorage.getItem('zsb_vip_claimed_v1') })`);
  console.log('总壳 localStorage =', ls);

  // 题库页视角
  const quizView = await evalIn('quiz', `JSON.stringify({
    SHELL_STATE: window.SHELL_STATE,
    isGuest: isGuest(),
    trialExperienced: trialExperienced(),
    aiCardText: (document.getElementById('aiCard').innerText || '').replace(/\\s+/g, ' ').slice(0, 80)
  })`);
  console.log('题库页视角 =', quizView);

  // 等一拍再抓一次（确保 STATE 广播到达后）
  await sleep(500);
  const quizView2 = await evalIn('quiz', `JSON.stringify({
    SHELL_STATE: window.SHELL_STATE,
    isGuest: isGuest(),
    aiCardText: (document.getElementById('aiCard').innerText || '').replace(/\\s+/g, ' ').slice(0, 80)
  })`);
  console.log('题库页视角(500ms后) =', quizView2);

  console.log('\n判定：未登录时 aiCard 应含「免费体验卷」；若含「AI为你定制/今日学习任务」即为 bug。');
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try { await send('Browser.close'); } catch(e) {}
  chrome.kill();
  server.close();
}
