/** 多选题轻按钮 + 背题答题卡判定 验证（PM 2026-09-05）：
    S1 做题模式：多选题选项下方渲染「下一题」轻按钮；空选点击拦截提示；作答后点击进下一题
    S2 背题模式：未作答渲染「查看解析」轻按钮；点击主动展开解析，按钮消失
    S3 背题模式：已作答自动展开解析 + 轻按钮隐藏 + 选项锁定
    S4 答题卡双态：做题模式未交卷=作答态（已答）；背题答题完成后=判定态（答对/答对一半/答错/未答）
  用法：node _cdp_multi_submit.mjs [目标目录，默认脚本所在目录] */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] ? join(process.cwd(), process.argv[2]) : SELF;
const PORT = 8775;
const DEVTOOLS_PORT = 9345;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = '/tmp/zsb_multi_cdp_profile';
if (!existsSync(join(ROOT, '做题页.html'))) { console.log('FAIL | 找不到做题页.html in ' + ROOT); process.exit(1); }
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/做题页.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', PROFILE]); rm.on('exit', r); });
const chrome = spawn(CHROME, ['--remote-debugging-port=' + DEVTOOLS_PORT, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=390,844', `--user-data-dir=${PROFILE}`]);
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
  if (r.exceptionDetails) throw new Error('异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || ''))); if (!cond) failed++; }
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(1000); };
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/zsb_multi_' + name + '.png', Buffer.from(r.data, 'base64'));
}
/* 定位首个多选并跳转 */
const goMulti = () => evalJs(`(function(){
  var mi = null;
  for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].type === 'multi') { mi = i; break; }
  if (mi === null) return { ok: false };
  jumpTo(mi);
  return { ok: true, idx: mi, options: QUESTIONS[mi].options.length };
})()`);
await connect();

/* ===== S1 做题模式（exam）：多选题轻按钮 ===== */
const url0 = `http://localhost:${PORT}/做题页.html?entry=today`;
await gotoT(url0);
let r = await goMulti();
check('S1 存在多选题', r.ok === true, JSON.stringify(r));
r = await evalJs(`(function(){
  var b = document.getElementById('multiSubmit');
  return { has: !!b, text: b ? b.textContent : '', revealed: document.getElementById('analysisArea').classList.contains('show') };
})()`);
check('S1 渲染「下一题」轻按钮', r.has === true && /下一题/.test(r.text), JSON.stringify(r));
r = await evalJs(`(function(){
  var before = idx, t = document.getElementById('practiceToast');
  submitMultiAnswer();
  return { same: idx === before, toast: t.textContent };
})()`);
check('S1 空选点击提示「请先选择答案」且不跳', r.same === true && /请先选择答案/.test(r.toast), JSON.stringify(r));
r = await evalJs(`(function(){
  if (idx >= total - 1) return { last: true };
  var n = QUESTIONS[idx].options.length;
  onSelectOption(0); onSelectOption(1);
  var before = idx; submitMultiAnswer();
  return { last: false, moved: idx === before + 1, before: before, after: idx };
})()`);
check('S1 作答后点「下一题」→ 下一题', r.last === true || r.moved === true, JSON.stringify(r));
await shot('s1_exam_multi');

/* ===== S2 背题模式：未作答点「查看解析」主动展开 ===== */
await gotoT(url0);
await evalJs(`(function(){ setMode('study'); })()`);
r = await goMulti();
r = await evalJs(`(function(){
  var b = document.getElementById('multiSubmit');
  return { has: !!b, text: b ? b.textContent : '', revealed: document.getElementById('analysisArea').classList.contains('show'), editable: canEdit() };
})()`);
check('S2 背题未作答按钮=「查看解析」', r.has === true && /查看解析/.test(r.text), JSON.stringify(r));
check('S2 未作答时解析未展开', r.revealed === false, JSON.stringify(r));
await evalJs(`(function(){ submitMultiAnswer(); })()`);
r = await evalJs(`(function(){
  return { revealed: document.getElementById('analysisArea').classList.contains('show'), btnGone: !document.getElementById('multiSubmit'), editable: canEdit() };
})()`);
check('S2 点「查看解析」→ 解析展开', r.revealed === true, JSON.stringify(r));
check('S2 解析展开后轻按钮消失', r.btnGone === true, JSON.stringify(r));
check('S2 主动查看解析后选项锁定', r.editable === false, JSON.stringify(r));
await shot('s2_study_review');
/* ===== S3 背题模式：已作答自动展开解析 ===== */
await gotoT(url0);
await evalJs(`(function(){ setMode('study'); })()`);
r = await goMulti();
r = await evalJs(`(function(){
  var n = QUESTIONS[idx].options.length;
  onSelectOption(0);
  if (n > 1 && QUESTIONS[idx].answer.indexOf(0) < 0) onSelectOption(1);
  var b = document.getElementById('multiSubmit');
  return { revealed: document.getElementById('analysisArea').classList.contains('show'), btnGone: !b, editable: canEdit() };
})()`);
check('S3 已作答自动展开解析', r.revealed === true, JSON.stringify(r));
check('S3 自动展开后轻按钮隐藏', r.btnGone === true, JSON.stringify(r));
check('S3 已作答选项锁定', r.editable === false, JSON.stringify(r));

/* ===== S4 答题卡双态：做题模式=作答态 / 背题答题后=判定态 ===== */
await gotoT(url0);   /* 做题模式 */
r = await goMulti();
await evalJs(`(function(){
  answers[idx] = QUESTIONS[idx].type === 'multi' ? QUESTIONS[idx].answer.slice() : QUESTIONS[idx].answer;
  renderQuestion();
  openSheet();
})()`);
r = await evalJs(`(function(){
  var leg = document.getElementById('sheetLegend');
  var cellI = document.querySelectorAll('#sheetGrid .sheet-cell')[idx];
  return { verdict: leg.classList.contains('verdict'), lb: document.getElementById('lgRightLb').textContent,
    right: document.getElementById('lgRight').textContent.trim(), cellI: cellI ? cellI.className : '' };
})()`);
check('S4 做题模式答题卡=作答态（lgRightLb=已答）', r.verdict === false && r.lb === '已答', JSON.stringify(r));
check('S4 做题模式已答格=answered', /answered/.test(r.cellI), r.cellI);
await shot('s4a_sheet_exam');
await evalJs(`(function(){ closeSheet(); setMode('study'); openSheet(); })()`);
r = await evalJs(`(function(){
  var leg = document.getElementById('sheetLegend');
  var cellI = document.querySelectorAll('#sheetGrid .sheet-cell')[idx];
  var st = { correct:0, half:0, wrong:0, none:0 };
  for (var i = 0; i < QUESTIONS.length; i++) st[classifyResult(QUESTIONS[i], answers[i])]++;
  return { verdict: leg.classList.contains('verdict'), lb: document.getElementById('lgRightLb').textContent,
    right: document.getElementById('lgRight').textContent.trim(), half: document.getElementById('lgHalf').textContent.trim(),
    wrong: document.getElementById('lgWrong').textContent.trim(), todo: document.getElementById('lgTodo').textContent.trim(),
    expRight: '' + st.correct, expHalf: '' + st.half, expWrong: '' + st.wrong, expNone: '' + st.none,
    cellI: cellI ? cellI.className : '' };
})()`);
check('S4 背题答题后答题卡=判定态（lgRightLb=答对）', r.verdict === true && r.lb === '答对', JSON.stringify(r));
check('S4 判定统计与页面计数一致', r.right === r.expRight && r.half === r.expHalf && r.wrong === r.expWrong && r.todo === r.expNone, JSON.stringify(r));
check('S4 背题已答对题判定格=done', /done/.test(r.cellI), r.cellI);
await shot('s4b_sheet_study_verdict');

/* ===== S5 视觉对齐断言：多选轻按钮与填空轻按钮外观一致、位置不压选项 ===== */
await gotoT(url0);
await evalJs(`(function(){
  var mi = null;
  for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].type === 'multi') { mi = i; break; }
  if (mi === null) return;
  jumpTo(mi);
  var bar = document.querySelector('.multi-bar');
  var btn = document.querySelector('.multi-submit');
  if (!bar || !btn) return;
  var cs = getComputedStyle(btn), cb = getComputedStyle(bar);
  var br = btn.getBoundingClientRect(), or_ = document.querySelector('.options').getBoundingClientRect();
  window.__geom = { multi: { color: cs.color, fontSize: cs.fontSize, bg: cs.backgroundColor },
    barDisplay: cb.display, barJustify: cb.justifyContent,
    gap: Math.round(or_.bottom - br.top), rightPad: Math.round(window.innerWidth - br.right) };
})()`);
r = await evalJs(`(function(){
  var fi = null;
  for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].type === 'fill') { fi = i; break; }
  if (fi === null) return { foundFill: false };
  jumpTo(fi);
  var b = document.getElementById('fillSubmit');
  if (!b) return { foundFill: false };
  var cs = getComputedStyle(b);
  var g = window.__geom || {};
  window.__geom.fill = { color: cs.color, fontSize: cs.fontSize, bg: cs.backgroundColor };
  return { foundFill: true, hasMultiGeom: !!g.multi,
    sameColor: !!g.multi && g.fill.color === g.multi.color,
    sameSize: !!g.multi && g.fill.fontSize === g.multi.fontSize,
    sameBg: !!g.multi && g.fill.bg === g.multi.bg,
    barDisplay: g.barDisplay, barJustify: g.barJustify,
    gapOk: typeof g.gap === 'number' && g.gap > 0 && g.gap <= 16,
    rightPadOk: typeof g.rightPad === 'number' && g.rightPad > 8 && g.rightPad < 24 };
})()`);
check('S5 多选按钮与填空按钮外观一致（色/字号/无底）', r.foundFill === true && r.sameColor === true && r.sameSize === true && r.sameBg === true, JSON.stringify(r));
check('S5 多选按钮容器右对齐 flex-end', r.barDisplay === 'flex' && r.barJustify === 'flex-end', JSON.stringify(r));
check('S5 多选按钮与末选项间距 0~16px 不重叠', r.gapOk === true, JSON.stringify(r));
check('S5 多选按钮右边距约 16px', r.rightPadOk === true, JSON.stringify(r));
console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);
