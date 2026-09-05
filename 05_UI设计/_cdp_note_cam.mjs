/** 解析页「我的笔记」拍照上传 + 错因卡 验证（PM 2026-09-05 v2）：
    A 做题页解析区：拍照入口并入保存行左侧（.note-cam-link），文案「拍照上传」；
      存有关联拍照笔记时显示图片占位格（.note-photo-thumb，回显📷 + N张）
    B 拍照搜题页 note 模式 practice 来源：快门/相册后直接 saveNote（不开预览页）→
      写 zsb_notes_v1（带 source/qkey/quizRef/考点兜底）+ 发 NOTE_SAVED_BACK_PRACTICE；
      非 practice 来源仍走预览页 + NOTE_SAVED_OPEN_NOTEBK
    C 错因卡 renderWrongDiag：5 类纯文字、无 ✓/✗ 符号、无「已掌握」ok 项、无「v5.0」字样
    D 做题页收到 ENTER_REVIEW 带 focusNote → 定位 noteSec 并出现 .note-flash 高亮
  用法：node _cdp_note_cam.mjs [目标目录，默认脚本所在目录] */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] ? join(process.cwd(), process.argv[2]) : SELF;
const PORT = 8781;
const DEVTOOLS_PORT = 9351;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = '/tmp/zsb_notecam_profile';
const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}iframe{width:400px;height:800px;border:0}</style></head>
<body><iframe id="cam" src="拍照搜题.html"></iframe>
<script>
window.__msg = [];
window.addEventListener('message', function(e){ if (e.data && e.data.type) window.__msg.push(e.data.type); });
function camReady(){ var w = document.getElementById('cam').contentWindow; return !!(w && typeof w.takeNote === 'function'); }
function sendTakeNote(ctx){ document.getElementById('cam').contentWindow.postMessage({ type:'TAKE_NOTE', data: ctx || null }, '*'); }
</script></body></html>`;
if (!existsSync(join(ROOT, '做题页.html'))) { console.log('FAIL | 目录缺少做题页.html'); process.exit(1); }
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/做题页.html' : decodeURIComponent(req.url.split('?')[0]);
  if (path === '/__host_note') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(HOST_HTML); }
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', PROFILE]); rm.on('exit', r); });
const chrome = spawn(CHROME, ['--remote-debugging-port=' + DEVTOOLS_PORT, '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${PROFILE}`]);
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
  if (r.exceptionDetails) throw new Error('异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 700));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || ''))); if (!cond) failed++; }
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(1100); };
await connect();
const u0 = `http://localhost:${PORT}/做题页.html?entry=today`;

/* ===== A 做题页：拍照入口在保存行左侧 + 图片占位格反显 ===== */
await gotoT(u0);
let r = await evalJs(`(function(){
  submitted = true; renderQuestion();
  var link = document.querySelector('.note-cam-link');
  var oldBtn = document.querySelector('.note-cam-btn');
  var oldRow = document.querySelector('.note-cam-row');
  var saveRow = document.querySelector('.note-save-row');
  var linkInSaveRow = saveRow ? saveRow.querySelector('.note-cam-link') : null;
  return { hasLink: !!link, linkText: link ? link.textContent : '',
    oldBtnGone: !oldBtn, oldRowGone: !oldRow,
    inSaveRow: !!linkInSaveRow };
})()`);
check('A 拍照入口在保存行左侧（.note-cam-link），旧 .note-cam-row/.note-cam-btn 已删',
  r.hasLink && /拍照上传/.test(r.linkText) && r.oldBtnGone && r.oldRowGone && r.inSaveRow, JSON.stringify(r));

r = await evalJs(`(function(){
  var key = getNoteId(QUESTIONS[0]);
  var arr = [];
  try { arr = JSON.parse(localStorage.getItem('zsb_notes_v1') || '[]'); } catch(e) {}
  arr.unshift({ nid:'NT', type:'photo', img:'camshot_t', qkey: key,
    chapter:'计算机基础', concept:'信息与数据', createdAt:'2026-09-05 00:00' });
  localStorage.setItem('zsb_notes_v1', JSON.stringify(arr));
  submitted = true; renderQuestion();
  var thumb = document.querySelector('.note-photo-thumb');
  var img = thumb ? thumb.querySelector('.note-photo-thumb-img') : null;
  return { has: !!thumb, text: thumb ? thumb.textContent : '', hasImg: !!img };
})()`);
check('A 有已关联拍照笔记时显示图片占位格（.note-photo-thumb + 📷 反显）',
  r.has && /已关联 1 张/.test(r.text) && r.hasImg, JSON.stringify(r));

await evalJs(`(function(){ localStorage.removeItem('zsb_notes_v1'); })()`);

/* ===== C 错因卡：5 类纯文字、无符号、无 ok、无 v5.0（entry=wrong 恒显） ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=wrong`);
r = await evalJs(`(function(){
  submitted = true; renderQuestion();
  var card = document.querySelector('.diag-card');
  if (!card) return { noCard: true };
  var btns = card.querySelectorAll('.diag-btn');
  var labels = []; for (var i=0;i<btns.length;i++) labels.push(btns[i].textContent);
  var hasOk = !!card.querySelector('.diag-btn.ok');
  var desc = card.querySelector('.diag-desc') ? card.querySelector('.diag-desc').textContent : '';
  var html = card.innerHTML;
  return { n: btns.length, labels: labels, hasOk: hasOk, desc: desc, hasV5: /v5\\.0/i.test(html), noCard: false };
})()`);
check('C 错因卡 5 类纯文字（审题/盲区/混淆/记忆/操作），无 ✓/✗ 符号',
  r.n === 5 && r.labels[0] === '审题错误' && r.labels[1] === '知识盲区' && r.labels[2] === '概念混淆'
    && r.labels[3] === '记忆遗漏' && r.labels[4] === '操作失误'
    && !/[✓✗]/.test(r.labels.join('')),
  JSON.stringify(r));
check('C 无「已掌握」ok 项、无「v5.0」字样', r.hasOk === false && r.hasV5 === false && !/v5\\.0/i.test(r.desc), JSON.stringify(r));

/* ===== B 拍照搜题页 note 模式（iframe 宿主） ===== */
await gotoT(`http://localhost:${PORT}/__host_note`);
r = await evalJs(`({ ready: window.camReady() })`);
for (let i = 0; i < 30 && !r.ready; i++) { await sleep(300); r = await evalJs(`({ ready: window.camReady() })`); }
check('B 拍照搜题 iframe 就绪', r.ready === true, JSON.stringify(r));

/* B1 practice 来源：TAKE_NOTE 带上下文 → CAM_MODE=note、NOTE_CTX 记录 */
await evalJs(`(function(){ window.sendTakeNote({ from:'practice', qkey:'Q-KEY', q:0, entry:'today',
  chapter:'计算机基础', concept:'信息与数据', stem:'测试题' }); })()`);
await sleep(200);
r = await evalJs(`(function(){ var w = document.getElementById('cam').contentWindow;
  return { mode: w.CAM_MODE, ctx: w.NOTE_CTX }; })()`);
check('B1 TAKE_NOTE(带上下文) 进入记笔记模式', r.mode === 'note' && r.ctx && r.ctx.qkey === 'Q-KEY', JSON.stringify(r));

/* B2 practice 来源快门：直接存图并回跳，不开预览页 */
await evalJs(`(function(){
  var w = document.getElementById('cam').contentWindow;
  w.__noteOpened = false;
  var orig = w.showNoteResult;
  w.showNoteResult = function(){ w.__noteOpened = true; orig.call(w); };
  w.takePhoto();
})()`);
await sleep(900);
r = await evalJs(`(function(){
  var w = document.getElementById('cam').contentWindow;
  var arr = []; try { arr = JSON.parse(localStorage.getItem('zsb_notes_v1') || '[]'); } catch(e) {}
  var it = arr[0] || {};
  return { noteOpened: w.__noteOpened, n: arr.length, source: it.source, qkey: it.qkey,
    chapter: it.chapter, concept: it.concept, msg: window.__msg.slice() };
})()`);
check('B2 practice 快门后直接存图（未开预览页）',
  r.noteOpened === false && r.n >= 1 && r.source === 'practice' && r.qkey === 'Q-KEY'
    && r.chapter === '计算机基础' && r.concept === '信息与数据',
  JSON.stringify(r));
check('B2 practice 收到 NOTE_SAVED_BACK_PRACTICE（回做题页）', r.msg.indexOf('NOTE_SAVED_BACK_PRACTICE') >= 0, JSON.stringify(r.msg));

/* B3 非 practice 来源（笔记本 FAB）仍走预览页 + NOTE_SAVED_OPEN_NOTEBK */
await evalJs(`(function(){
  localStorage.removeItem('zsb_notes_v1');
  window.__msg = [];
  window.sendTakeNote(null);
})()`);
await sleep(400);
await evalJs(`(function(){
  var w = document.getElementById('cam').contentWindow;
  w.__noteOpened2 = false;
  var orig = w.showNoteResult;
  w.showNoteResult = function(){ w.__noteOpened2 = true; orig.call(w); };
  w.takePhoto();
})()`);
await sleep(800);
r = await evalJs(`(function(){
  var w = document.getElementById('cam').contentWindow;
  return { noteOpened: w.__noteOpened2, msg: window.__msg.slice() };
})()`);
check('B3 非 practice 来源仍打开预览页（showNoteResult 被调用）', r.noteOpened === true, JSON.stringify(r));

/* ===== D 做题页收到 ENTER_REVIEW 带 focusNote → 定位 noteSec + 高亮 ===== */
await gotoT(u0);
await evalJs(`(function(){
  submitted = true; renderQuestion();
  window.__flashSeen = false;
  window.addEventListener('message', function(e){
    if (e.data && e.data.type === 'ENTER_REVIEW') {
      setTimeout(function(){
        var sec = document.getElementById('noteSec');
        if (sec && sec.classList.contains('note-flash')) window.__flashSeen = true;
      }, 500);
    }
  });
  setTimeout(function(){
    window.postMessage({ type:'ENTER_REVIEW', data:{ q:0, focusNote:1 } }, '*');
  }, 100);
})()`);
await sleep(1000);
r = await evalJs(`(function(){
  var sec = document.getElementById('noteSec');
  return { hasSec: !!sec, flashClass: sec ? sec.classList.contains('note-flash') : false,
    flashSeen: window.__flashSeen };
})()`);
check('D ENTER_REVIEW(focusNote) 后 noteSec 出现高亮动画', r.flashSeen === true || r.flashClass === true, JSON.stringify(r));

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close();
const rm = spawn('rm', ['-rf', PROFILE]); rm.on('exit', () => process.exit(failed === 0 ? 0 : 1));
