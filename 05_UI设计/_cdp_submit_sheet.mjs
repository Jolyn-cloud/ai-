/** 交卷新流程验证：交卷→上滑答题卡核对→答题卡点确认交卷→出成绩；未答满也交；考试自动交卷不受影响 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8771;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9341;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/做题页.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeC`]); rm.on('exit', r); });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`, '--headless=new', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${ROOT}/.tmp-chromeC`,
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
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(900); };

await connect();

/* ===== 1. 练习类（章节课）：点交卷→答题卡，不弹确认弹窗 ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=chapter`);
let r = await evalJs(`(function(){
  var submitModalGone = !document.getElementById('submitModal');   /* 弹窗已废除 */
  document.getElementById('btnSubmit').click();                    /* 点交卷 */
  return {
    submitModalGone,
    sheetOpen: document.getElementById('sheetMask').classList.contains('show'),
    sheetSubmitBtn: !!document.getElementById('sheetSubmitBtn'),
    btnTxt: document.getElementById('sheetSubmitBtn').textContent.trim()
  };
})()`);
check('交卷确认弹窗已废除（DOM 不存在）', r.submitModalGone === true, r.submitModalGone);
check('点交卷→直接上滑答题卡', r.sheetOpen === true);
check('答题卡有确认交卷按钮', r.sheetSubmitBtn === true, r.btnTxt);

/* ===== 2. 图例计数：当前未答（chapter 题全部未答） ===== */
r = await evalJs(`(function(){
  var cells = document.querySelectorAll('.sheet-cell');
  var done = document.querySelectorAll('.sheet-cell.done').length;
  return { total: cells.length, doneCells: done, lgDone: document.getElementById('lgRight').textContent, lgTodo: document.getElementById('lgTodo').textContent };
})()`);
check('答题卡题号数>0', r.total >= 3, r.total);

/* ===== 3. 答一题再上交卷：图例已答计数 ===== */
await evalJs(`(function(){ jumpTo(0); closeSheet(); var opts=document.querySelectorAll('.option'); if(opts.length) opts[0].click(); })()`);
await sleep(200);
await evalJs(`document.getElementById('btnSubmit').click()`);
r = await evalJs(`(function(){
  return { sheetOpen: document.getElementById('sheetMask').classList.contains('show'),
    lgDone: document.getElementById('lgRight').textContent,
    lgTodo: document.getElementById('lgTodo').textContent };
})()`);
check('答一题后点交卷→答题卡仍先出', r.sheetOpen === true);
// 简校：lgDone(lgRight) + lgTodo == total
r = await evalJs(`(function(){
  var total = document.querySelectorAll('.sheet-cell').length;
  var done = parseInt(document.getElementById('lgRight').textContent);
  var todo = parseInt(document.getElementById('lgTodo').textContent);
  return { sumOk: done + todo === total, total: total, done: done, todo: todo };
})()`);
check('图例已答+未答=总题数', r.sumOk, JSON.stringify(r));
check('图例已答=1, 未答=total-1', r.done === 1 && r.todo === r.total - 1, JSON.stringify(r));

/* ===== 4. 答题卡点确认交卷 → 交卷态（直接进解析，resultMask 旧弹窗已废弃） ===== */
await evalJs(`document.getElementById('sheetSubmitBtn').click()`);
await sleep(400);
r = await evalJs(`(function(){
  return { submitted: submitted,
    sheetClosed: !document.getElementById('sheetMask').classList.contains('show'),
    reviewShown: document.getElementById('analysisArea').classList.contains('show') };
})()`);
check('交卷后 submitted=true', r.submitted === true);
check('答题卡已收起', r.sheetClosed === true, r.sheetClosed);
check('交卷后进入解析态', r.reviewShown === true, '');

/* ===== 5. 未答满也照交（无特判）：直接开卡→交卷 ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=chapter`);
await evalJs(`document.getElementById('btnSubmit').click()`);   /* 什么都没答直接点交卷 */
await sleep(200);
r = await evalJs(`(function(){
  return { sheetOpen: document.getElementById('sheetMask').classList.contains('show'),
    lgTodo: document.getElementById('lgTodo').textContent };
})()`);
check('未答直接交卷也能开答题卡', r.sheetOpen === true, 'lgTodo=' + r.lgTodo);
await evalJs(`document.getElementById('sheetSubmitBtn').click()`);
await sleep(300);
r = await evalJs(`(function(){
  return { submitted: submitted,
    reviewShown: document.getElementById('analysisArea').classList.contains('show') };
})()`);
check('未答满点确认交卷→照常交卷进解析', r.submitted === true && r.reviewShown === true, JSON.stringify(r));

/* ===== 6. 考试模式：确认交卷按钮存在 + 正常流程不受影响 ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=exam&paperId=exam1&minutes=5&fullScore=150`);
r = await evalJs(`(function(){
  document.getElementById('btnSubmit').click();
  return { sheetOpen: document.getElementById('sheetMask').classList.contains('show'),
    hasBtn: !!document.getElementById('sheetSubmitBtn'),
    navTimerShown: document.getElementById('navTimer').style.display !== 'none' };
})()`);
check('考试模式点交卷→也走答题卡', r.sheetOpen === true, r.sheetOpen);
check('考试模式答题卡也有确认交卷', r.hasBtn === true);
check('考试模式倒计时仍显示', r.navTimerShown === true);
await evalJs(`document.getElementById('sheetSubmitBtn').click()`);
await sleep(300);
r = await evalJs(`(function(){
  var posted = typeof _lastReportPosted !== 'undefined';
  return { submitted: submitted,
    sheetClosed: !document.getElementById('sheetMask').classList.contains('show'),
    posted: posted };
})()`);
/* 考试模式交卷 → 上报成绩报告（REQ_REPORT，总壳报告层），不经本地解析区（report 跳解析由总壳 ENTER_REVIEW 触发） */
check('考试模式确认交卷→submitted + 答题卡收起', r.submitted === true && r.sheetClosed === true, JSON.stringify(r));

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);