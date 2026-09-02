/** 填空/简答轻提交验证：
    回车确认(committed 蓝态回显) + 背题轻提交→解析 / 做题轻提交→下一题 + 空值拦截 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8774;
const DEVTOOLS_PORT = 9344;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/做题页.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
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
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(900); };

await connect();

/* ===== 1. 做题模式（exam）：填空回车确认回显蓝态 ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=today`);
let r = await evalJs(`(function(){
  var fi = null;
  for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].type === 'fill') { fi = i; break; }
  if (fi === null) return { ok:false };
  jumpTo(fi);
  return { ok:true, idx:fi, type:QUESTIONS[fi].type, keywords:QUESTIONS[fi].keywords };
})()`);
check('存在填空题', r.ok === true, JSON.stringify(r));
const FILL_IDX = r.idx;

/* 填入后容器应出现 fill-input + fill-submit */
r = await evalJs(`(function(){
  return { input: !!document.getElementById('fillInput'), btn: !!document.getElementById('fillSubmit'),
    btnText: document.getElementById('fillSubmit') ? document.getElementById('fillSubmit').textContent : '' };
})()`);
check('填空题渲染输入框 + 轻提交按钮', r.input && r.btn, JSON.stringify(r));
check('做题模式按钮文案=下一题', r.btnText.indexOf('下一题') >= 0, r.btnText);

/* 空值拦截：提交空内容不跳转 */
r = await evalJs(`(function(){
  submitTextAnswer();
  return { idx: idx, type: QUESTIONS[idx].type };
})()`);
check('空值点击轻提交不跳转', r.type === 'fill', JSON.stringify(r));

/* 输入答案回车→确认态（committed，蓝态回显） */
r = await evalJs(`(function(){
  onFillInput('1100');
  onTextKeydown({ key:'Enter', shiftKey:false, preventDefault:function(){} });
  return { committed: !!committed[idx], cls: document.getElementById('fillInput').className, val: document.getElementById('fillInput').value };
})()`);
check('回车→committed=true', r.committed === true, r.committed);
check('回车→输入框 committed 蓝态', /committed/.test(r.cls), r.cls);
check('回车→文字回显', r.val === '1100', r.val);

/* 做题模式轻提交→下一题 */
r = await evalJs(`(function(){
  var before = idx;
  submitTextAnswer();
  return { before: before, after: idx, nextType: QUESTIONS[Math.min(before+1, total-1)].type };
})()`);
check('做题轻提交→下一题', r.after === r.before + 1, JSON.stringify(r));

/* ===== 2. 背题模式（study）：填空 ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=today`);
await evalJs(`(function(){ setMode('study'); })()`);
r = await evalJs(`(function(){
  var fi = null;
  for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].type === 'fill') { fi = i; break; }
  jumpTo(fi);
  onFillInput('1100');
  return { idx: idx };
})()`);
r = await evalJs(`(function(){
  return { revealed: document.getElementById('analysisArea').classList.contains('show'),
    btnText: document.getElementById('fillSubmit').textContent };
})()`);
check('背题：输入后解析未弹出（按钮仍显示）', r.revealed === false, r.revealed);
check('背题按钮文案=查看解析', /查看解析/.test(r.btnText), r.btnText);

/* 按轻提交→显示解析 */
r = await evalJs(`(function(){
  submitTextAnswer();
  return { reviewed: !!reviewed[idx], revealed: document.getElementById('analysisArea').classList.contains('show') };
})()`);
check('背题轻提交→显示解析', r.reviewed === true && r.revealed === true, JSON.stringify(r));

/* ===== 3. 背题模式：填空也可回车确认回显（committed, 但解析需轻提交） ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=today`);
await evalJs(`(function(){ setMode('study'); })()`);
r = await evalJs(`(function(){
  var fi = null;
  for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].type === 'fill') { fi = i; break; }
  jumpTo(fi);
  onFillInput('1100');
  onTextKeydown({ key:'Enter', shiftKey:false, preventDefault:function(){} });
  return { committed: !!committed[idx], revealed: document.getElementById('analysisArea').classList.contains('show'),
    cls: document.getElementById('fillInput').className };
})()`);
check('背题回车→committed=true 蓝态', r.committed === true && /committed/.test(r.cls), JSON.stringify(r));
check('背题回车→解析不弹出', r.revealed === false, r.revealed);

/* ===== 4. 轻提交可见性：解析显示后按钮消失 ===== */
r = await evalJs(`(function(){
  submitTextAnswer();   /* 背题→显示解析 */
  return { btnGone: !document.getElementById('fillSubmit'), revealed: document.getElementById('analysisArea').classList.contains('show') };
})()`);
check('解析显示后轻提交按钮消失', r.btnGone === true && r.revealed === true, JSON.stringify(r));

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);