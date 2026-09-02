/** 交卷 v2 验证：练习交卷直达解析 / 背题可交卷 / 答题卡 6 态图例（半对）/ 未答题型提示 / 考试REQ_REPORT */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8772;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9342;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/做题页.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeD`]); rm.on('exit', r); });
const chrome = spawn(CHROME, ['--remote-debugging-port=' + DEVTOOLS_PORT, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${ROOT}/.tmp-chromeD`]);
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
  if (r.exceptionDetails) throw new Error('异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || ''))); if (!cond) failed++; }
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(900); };

await connect();

/* ===== 1. 背题模式显示交卷按钮 ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=chapter`);
let r = await evalJs(`(function(){ setMode('study'); return document.getElementById('btnSubmit').style.display; })()`);
check('背题模式交卷按钮可见', r === '', 'display=' + r);

/* ===== 2. classifyResult 四种分类（多选场景） ===== */
await evalJs(`(function(){ setMode('practice'); return true; })()`);   /* 第一节切过 study，恢复 practice */
r = await evalJs(`(function(){
  return { qCount: QUESTIONS.length, q1: { type: QUESTIONS[1].type, answer: QUESTIONS[1].answer, options: QUESTIONS[1].options.length } };
})()`);
check('chapter≥3 题且第2题为多选', r.qCount >= 3 && r.q1.type === 'multi', JSON.stringify(r.q1));

await evalJs(`(function(){ jumpTo(1); answers[1] = []; onSelectOption(QUESTIONS[1].answer[0]); return true; })()`);
r = await evalJs(`(function(){ return classifyResult(QUESTIONS[1], answers[1]); })()`);
check('多选选部分正确 → half', r === 'half', r);

await evalJs(`(function(){ answers[1] = []; QUESTIONS[1].answer.forEach(function(i){ onSelectOption(i); }); return true; })()`);
r = await evalJs(`(function(){ return classifyResult(QUESTIONS[1], answers[1]); })()`);
check('多选全选正确 → correct', r === 'correct', r);

await evalJs(`(function(){
  var q = QUESTIONS[1];
  var wrongI = [0,1,2,3].slice(0, q.options.length).find(function(i){ return q.answer.indexOf(i) < 0; });
  answers[1] = [q.answer[0], wrongI];
  return true;
})()`);
r = await evalJs(`(function(){ return classifyResult(QUESTIONS[1], answers[1]); })()`);
check('多选含错项 → wrong', r === 'wrong', r);

r = await evalJs(`(function(){ return classifyResult({ type: 'multi' }, []); })()`);
check('未答 → none', r === 'none', r);

/* ===== 3. 打开答题卡：图例计数 + 当前题高亮 + 标记 + 未答题型提示 ===== */
const d0 = await evalJs(`(function(){
  var q0 = QUESTIONS[0];
  answers[0] = (q0.type === 'multi') ? q0.answer.slice() : q0.answer;   /* 第1题答对 */
  var q1 = QUESTIONS[1];
  var wrongI = [0,1,2,3].slice(0, q1.options.length).find(function(i){ return q1.answer.indexOf(i) < 0; });
  answers[1] = [q1.answer[0], wrongI];                                  /* 第2题答错 */
  marked[0] = true;                                                     /* 第1题标记 */
  jumpTo(0);
  openSheet();
  return { total: total };
})()`);
const D0_TOTAL = d0.total;
r = await evalJs(`(function(){
  return {
    lgRight: document.getElementById('lgRight').textContent,
    lgHalf: document.getElementById('lgHalf').textContent,
    lgWrong: document.getElementById('lgWrong').textContent,
    lgTodo: document.getElementById('lgTodo').textContent,
    lgMark: document.getElementById('lgMark').textContent,
    tip: document.getElementById('sheetSubmitTip').textContent,
    cells: document.querySelectorAll('.sheet-cell').length,
    current: !!document.querySelector('.sheet-cell.current')
  };
})()`);
check('答题卡 5 个计数标签渲染', r.lgRight && r.lgHalf && r.lgWrong && r.lgTodo && r.lgMark !== undefined, JSON.stringify(r));
check('答对计数=1', r.lgRight === '1', 'lgRight=' + r.lgRight);
check('答错计数=1', r.lgWrong === '1', 'lgWrong=' + r.lgWrong);
check('未答计数=total-2', parseInt(r.lgTodo) === D0_TOTAL - 2, 'lgTodo=' + r.lgTodo + ' total=' + D0_TOTAL);
check('已标记计数=1', r.lgMark === '1', 'lgMark=' + r.lgMark);
check('单元格数与题数一致', r.cells === D0_TOTAL, 'cells=' + r.cells);
check('当前题高亮', r.current === true, r.current);
check('交卷提示列未答题型', /未答/.test(r.tip), r.tip);

/* ===== 4. 练习完整链路：交卷 → 答题卡 → 确认交卷 → 直达解析 ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=chapter`);
r = await evalJs(`(function(){
  document.getElementById('btnSubmit').click();   /* 点交卷开答题卡 */
  return true;
})()`);
await sleep(150);
r = await evalJs(`(function(){
  return { sheetOpen: document.getElementById('sheetMask').classList.contains('show') };
})()`);
check('交卷按钮 → 答题卡上滑', r.sheetOpen === true, r.sheetOpen);
r = await evalJs(`(function(){
  document.getElementById('sheetSubmitBtn').click();  /* 点确认交卷 */
  return true;
})()`);
await sleep(300);
r = await evalJs(`(function(){
  return {
    submitted,
    resultMaskGone: !document.getElementById('resultMask'),
    sheetClosed: !document.getElementById('sheetMask').classList.contains('show'),
    analysisShown: document.getElementById('analysisArea').classList.contains('show')
  };
})()`);
check('练习交卷 → 直达解析（无成绩弹窗）', r.submitted === true && r.resultMaskGone === true && r.sheetClosed === true && r.analysisShown === true, JSON.stringify(r));

/* ===== 5. 考试交卷 → 发送 REQ_REPORT ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=exam&paperId=exam1&minutes=5&fullScore=150`);
await evalJs(`(function(){
  window.__gotReport = null;
  window.addEventListener('message', function(e){ if (e.data && e.data.type === 'REQ_REPORT') window.__gotReport = e.data.data; });
  return true;
})()`);
await evalJs(`(function(){ document.getElementById('btnSubmit').click(); return true; })()`);
await sleep(150);
r = await evalJs(`(function(){
  document.getElementById('sheetSubmitBtn').click();
  return true;
})()`);
await sleep(400);
r = await evalJs(`(function(){
  var gp = window.__gotReport;
  return {
    got: !!gp,
    score: gp ? gp.score : null,
    fullScore: gp ? gp.fullScore : null,
    sheetLen: gp && gp.sheet ? gp.sheet.length : null,
    type: gp ? gp.type : null
  };
})()`);
check('考试交卷 → 发送 REQ_REPORT', r.got === true, JSON.stringify(r));
check('报告带 score / fullScore=150', r.score !== null && r.fullScore === 150, 'score=' + r.score + ' full=' + r.fullScore);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);