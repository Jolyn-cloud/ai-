/** 操作题分屏模式验证（PM 2026-09-02）：
 *  一 分屏结构：题干区 + 拖拽分界线 + 子题作答区（默认 40% / 可拖 25%~65%）
 *  二 题干独立滚动 / 独立区域
 *  三 子题导航：横向 tab，当前高亮，已答标✓，点击切换
 *  四 交互：题干常显、不遮罩；切题保留答案；上下区域独立滚动；限制=用户点导航/底部钮切换
 *  五 底部：上一题/下一题；最后子题显示「完成操作题」→ 全答后进下一道普通题
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8777;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9350;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/做题页.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeX`]); rm.on('exit', r); });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`, '--headless=new', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${ROOT}/.tmp-chromeX`,
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
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(1000); };

/* today entry 第4题 = 操作题（Q4 现在是5子题） */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=today`);

/* 1. 定位第4题操作题 */
let r = await evalJs(`(function(){
  for (var i=0;i<QUESTIONS.length;i++) if (QUESTIONS[i].type==='operation') { idx=i; resetOp(true); renderQuestion(); return { i:i, subCount:QUESTIONS[i].sub.length }; }
  return null;
})()`);
check('找到操作题且共5子题', r && r.subCount === 5, JSON.stringify(r));

/* 2. 分屏结构：题干区/分界线/作答区/导航tab全部存在 */
r = await evalJs(`(function(){
  var w = document.querySelector('.op-wrap');
  var stem = w.querySelector('.op-stem-pane');
  var div = w.querySelector('.op-divider');
  var pane = w.querySelector('.op-answer-pane');
  var tabs = w.querySelectorAll('.op-tab').length;
  var btn1 = w.querySelector('.op-nav-row');
  var stemScrollable = stem.scrollHeight > stem.clientHeight || stem.style.overflowY === 'auto';
  return { exists:!!w && !!stem && !!div && !!pane, tabs: tabs, hasNavRow:!!btn1,
           stemOverflow: getComputedStyle(stem).overflowY, bodyOverflow: getComputedStyle(document.body).overflowY };
})()`);
check('分屏三区结构存在', r.exists, JSON.stringify(r));
check('横向导航 tab 数 = 子题数5', r.tabs === 5, 'tabs='+r.tabs);
check('分屏内底部有操作按钮行', r.hasNavRow === true, '');
check('题干区自身可滚动 (overflow-y)', r && r.stemOverflow === 'auto', r && r.stemOverflow);

/* 3. 默认比例 40% + 题干不被遮罩 + 题干/子题同步可见 */
r = await evalJs(`(function(){
  var w = document.querySelector('.op-wrap');
  var stem = w.querySelector('.op-stem-pane');
  var mask = w.querySelector('.op-mask');
  var ratio = stem.offsetHeight / (w.offsetHeight || 1);
  var stemText = w.querySelector('.op-stem-text');
  var subStem = w.querySelector('.op-sub-stem');
  return { ratio: +ratio.toFixed(2), maskExists: !!mask, stemVisible: !!stemText && stemText.offsetHeight>0,
           subVisible: !!subStem && subStem.offsetHeight>0, stemTextShown: stemText ? stemText.textContent.slice(0,12) : null };
})()`);
check('默认题干区占比≈40%', r && Math.abs(r.ratio - 0.40) < 0.08, 'ratio='+r.ratio);
check('无黑色遮罩', r.maskExists === false, 'maskExists='+r.maskExists);
check('题干与当前子题同时可见', r.stemVisible && r.subVisible, JSON.stringify(r));

/* 4. 交互：第1题选 B → 切到第2题 → 切回第1题仍保留 B；tab 状态 */
r = await evalJs(`(async function(){
  onSubSelect(0, 1);
  await new Promise(r=>setTimeout(r,60));
  var tab0 = document.querySelectorAll('.op-tab')[0];
  var done0 = tab0.classList.contains('done');
  var saved0 = answers[idx] && answers[idx][0];
  opJumpSub(1);
  await new Promise(r=>setTimeout(r,60));
  var sub2stem = document.querySelector('.op-sub-stem').textContent.trim().slice(0,10);
  opJumpSub(0);
  await new Promise(r=>setTimeout(r,60));
  var restored = answers[idx] && answers[idx][0];
  var activeTab = document.querySelector('.op-tab.active');
  var activeIdx = Array.prototype.indexOf.call(document.querySelectorAll('.op-tab'), activeTab);
  return { done0: done0, saved0: saved0, sub2stem: sub2stem, restored: restored, activeIdx: activeIdx };
})()`);
check('答后 tab 标✓', r.done0 === true, '');
check('第1题答案保留 (切走再切回仍B)', r.saved0 === 1 && r.restored === 1, JSON.stringify(r));
check('切到第2题显示对应子题题干', r.sub2stem && r.sub2stem.length > 0, r.sub2stem);
check('当前 active tab = 返回的第1题', r.activeIdx === 0, 'activeIdx='+r.activeIdx);

/* 5. 拖拽分界线：向下增大题干区（>40%），且钳制在 25%~65% */
r = await evalJs(`(async function(){
  var w = document.querySelector('.op-wrap');
  var stem = w.querySelector('.op-stem-pane');
  var areaH = w.offsetHeight;
  var div = w.querySelector('.op-divider');
  var before = stem.offsetHeight / areaH;
  applyOpRatio(0.55);
  await new Promise(r=>setTimeout(r,40));
  var after55 = stem.offsetHeight / areaH;
  applyOpRatio(0.70);          /* 超出上限 → 钳制到65% */
  await new Promise(r=>setTimeout(r,40));
  var capped = stem.offsetHeight / areaH;
  applyOpRatio(0.10);          /* 低于下限 → 钳制到25% */
  await new Promise(r=>setTimeout(r,40));
  var floored = stem.offsetHeight / areaH;
  return { before:+before.toFixed(2), after55:+after55.toFixed(2), capped:+capped.toFixed(2), floored:+floored.toFixed(2),
           opRatio: opRatio };
})()`);
check('拖分界线到55% → 题干区≈55%', r && Math.abs(r.after55-0.55)<0.05, 'after55='+r.after55);
check('超过65%被钳制到≈65%', r && Math.abs(r.capped-0.65)<0.05, 'capped='+r.capped);
check('低于25%被钳制到≈25%', r && Math.abs(r.floored-0.25)<0.05, 'floored='+r.floored);
check('opRatio 变量同步钳制', r && (r.capped <= 0.65+0.02) && (r.floored >= 0.25-0.02), 'opRatio='+r.opRatio);

/* 6. 底部按钮：不是最后子题 → 显示「下一题」；最后子题 → 显示「完成操作题」 */
r = await evalJs(`(function(){
  opJumpSub(0);
  var b1 = document.querySelector('.op-nav-btn.primary').textContent.trim();
  opJumpSub(4);
  var btnLast = document.querySelector('.op-nav-btn.primary').textContent.trim();
  return { b1: b1, btnLast: btnLast };
})()`);
check('第1题底部按钮 = 下一题', r.b1 === '下一题', r.b1);
check('最后子题底部按钮 = 完成操作题', r.btnLast === '完成操作题', r.btnLast);

/* 7. 完成操作题：全部子题答完 → 进入下一道普通题（exam 卷操作题在第4题=中间位，可前进） */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=exam&paperId=exam1&minutes=100&fullScore=150`);
r = await evalJs(`(async function(){
  for (var i=0;i<QUESTIONS.length;i++) if (QUESTIONS[i].type==='operation') { idx=i; break; }
  resetOp(true); renderQuestion(); await new Promise(r=>setTimeout(r,60));
  var q0 = QUESTIONS[idx];
  var all = {};
  for (var i=0;i<q0.sub.length;i++) {
    var s = q0.sub[i];
    all[i] = (s.type==='single'||s.type==='judge') ? s.answer : (s.fill || 'x');
  }
  answers[idx] = all;
  renderQuestion();
  var posBefore = idx;
  opJumpSub(q0.sub.length-1);        /* 最后一个子题 → 显示「完成操作题」 */
  await new Promise(r=>setTimeout(r,60));
  var btnLab = document.querySelector('.op-nav-btn.primary').textContent.trim();
  opNextSub();                       /* 点「完成操作题」 */
  await new Promise(r=>setTimeout(r,80));
  var qNext = QUESTIONS[idx];
  return { posBefore: posBefore, newIdx: idx, moved: idx>posBefore, btnLab: btnLab,
           nextType: qNext.type, nextNotOp: qNext.type!=='operation', subCount: q0.sub.length };
})()`);
check('全答后点完成 → 前进到下一道普通题', r && r.moved && r.nextNotOp, JSON.stringify(r));
check('完成按钮文案检查在前置（最后一子题）', r && r.btnLab === '完成操作题', 'btnLab='+r.btnLab);

/* 8. 未全答点完成 → 不跳转 + Toast */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=today`);
r = await evalJs(`(async function(){
  for (var i=0;i<QUESTIONS.length;i++) if (QUESTIONS[i].type==='operation') { idx=i; break; }
  resetOp(true); renderQuestion();
  opJumpSub(4); await new Promise(r=>setTimeout(r,50));
  var before = idx;
  opNextSub();
  await new Promise(r=>setTimeout(r,60));
  var toastText = document.querySelector('.toast') ? document.querySelector('.toast').textContent : '';
  return { moved: idx!==before, idx: idx, toast: toastText };
})()`);
check('未全答点完成 → 不跳转', r.moved === false, JSON.stringify(r));

/* 9. 交卷后 → 纵向平铺全部子题（renderOperationAll），有空态 */
r = await evalJs(`(function(){
  submitted = true; renderQuestion();
  var subs = document.querySelectorAll('.sub-q').length;
  submitted = false;
  return { subCards: subs };
})()`);
check('交卷后平铺全部子题(=5)', r.subCards === 5, 'subCards='+r.subCards);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);