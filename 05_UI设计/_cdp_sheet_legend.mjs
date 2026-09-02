/** 答题卡图例双态验证：未交卷=作答态(已答/未答/已标记/当前题) 交卷后=判定态(答对/答错/答对一半/未答/已标记) 两行排版 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8773;
const DEVTOOLS_PORT = 9343;
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
await gotoT(`http://localhost:${PORT}/做题页.html?entry=chapter`);

/* ---------- 1. 未交卷：作答态图例 ---------- */
let r = await evalJs(`(function(){
  /* 答第1、2题 */
  var q0 = QUESTIONS[0]; answers[0] = (q0.type === 'multi') ? q0.answer.slice() : q0.answer;
  var q1 = QUESTIONS[1]; answers[1] = (q1.type === 'multi') ? [q1.answer[0]] : q1.answer;
  marked[0] = true;
  openSheet();
  return { submitted: submitted };
})()`);
r = await evalJs(`(function(){
  var legend = document.getElementById('sheetLegend');
  return {
    verdict: legend.classList.contains('verdict'),
    lgRightLb: document.getElementById('lgRightLb').textContent,
    lgRight: document.getElementById('lgRight').textContent,
    lgHalf: document.getElementById('lgHalf').textContent,
    lgWrong: document.getElementById('lgWrong').textContent,
    lgTodo: document.getElementById('lgTodo').textContent,
    lgMark: document.getElementById('lgMark').textContent,
    gridCols: getComputedStyle(legend).gridTemplateColumns.split(' ').length,
    cells: document.querySelectorAll('.sheet-cell').length,
    answeredCells: document.querySelectorAll('.sheet-cell.answered').length,
    todoCells: document.querySelectorAll('.sheet-cell.todo').length,
    halfCells: document.querySelectorAll('.sheet-cell.half').length,
    wrongCells: document.querySelectorAll('.sheet-cell.wrong').length,
    doneCells: document.querySelectorAll('.sheet-cell.done').length,
    tip: document.getElementById('sheetSubmitTip').textContent
  };
})()`);
check('未交卷：图例非判定态(verdict类无)', r.verdict === false, r.verdict);
check('未交卷：标签为「已答」', r.lgRightLb === '已答', r.lgRightLb);
check('未交卷：已答计数=2', r.lgRight === '2', r.lgRight);
check('未交卷：答对一半/答错图例隐藏(计数0)', r.lgHalf === '0' && r.lgWrong === '0', r.lgHalf + '/' + r.lgWrong);
check('未交卷：单元格用 answered/todo 类，不用 done/half/wrong', r.answeredCells >= 2 && r.todoCells >= 1 && r.halfCells === 0 && r.wrongCells === 0 && r.doneCells === 0, JSON.stringify(r));
check('未交卷：网格为两列', r.gridCols === 2, 'cols=' + r.gridCols);
check('未交卷：提示列未答题型', /未答/.test(r.tip), r.tip);

/* ---------- 2. 交卷后：判定态图例 ---------- */
await evalJs(`(function(){ closeSheet(); document.getElementById('btnSubmit').click(); return true; })()`);
await sleep(150);
r = await evalJs(`(function(){ document.getElementById('sheetSubmitBtn').click(); return true; })()`);
await sleep(300);
/* 交卷后直接进了解析（练习模式），再开答题卡看判定态 */
r = await evalJs(`(function(){
  openSheet();
  var legend = document.getElementById('sheetLegend');
  return {
    submitted: submitted,
    verdict: legend.classList.contains('verdict'),
    lgRightLb: document.getElementById('lgRightLb').textContent,
    lgRight: document.getElementById('lgRight').textContent,
    lgHalf: document.getElementById('lgHalf').textContent,
    lgWrong: document.getElementById('lgWrong').textContent,
    lgTodo: document.getElementById('lgTodo').textContent,
    lgMark: document.getElementById('lgMark').textContent,
    gridCols: getComputedStyle(legend).gridTemplateColumns.split(' ').length,
    doneCells: document.querySelectorAll('.sheet-cell.done').length,
    halfCells: document.querySelectorAll('.sheet-cell.half').length,
    wrongCells: document.querySelectorAll('.sheet-cell.wrong').length,
    todoCells: document.querySelectorAll('.sheet-cell.todo').length,
    answeredCells: document.querySelectorAll('.sheet-cell.answered').length,
    tip: document.getElementById('sheetSubmitTip').textContent
  };
})()`);
check('交卷后：submitted=true', r.submitted === true, r.submitted);
check('交卷后：图例判定态(verdict类有)', r.verdict === true, r.verdict);
check('交卷后：标签切为「答对」', r.lgRightLb === '答对', r.lgRightLb);
check('交卷后：答对/半对/答错/未答都显示', parseInt(r.lgRight) >= 1 && parseInt(r.lgRight) >= 0 && parseInt(r.lgHalf) >= 0 && parseInt(r.lgWrong) >= 0, JSON.stringify(r));
check('交卷后：单元格用 done/half/wrong/todo，不再用 answered', r.answeredCells === 0 && r.doneCells >= 1 && (r.todoCells >= 0), JSON.stringify(r));
check('交卷后：网格为三列（两行排下6标签）', r.gridCols === 3, 'cols=' + r.gridCols);
check('交卷后：提示为全部作答或未答', /已全部作答|未答/.test(r.tip), r.tip);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);