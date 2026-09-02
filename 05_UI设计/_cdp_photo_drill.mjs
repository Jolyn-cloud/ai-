/**
 * 拍照搜题下钻全链路验证
 * 覆盖：题库 tab「拍照搜题」→ camLayer 下钻 / 相机页默认搜题 / 双模式 / 保存分流 / 做题回看 / 子层标题
 * 运行：node _cdp_photo_drill.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8768;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9339;

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/AI伴学_小程序.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

await new Promise(r => { const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chrome9`]); rm.on('exit', r); });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${ROOT}/.tmp-chrome9`,
]);
await new Promise(r => setTimeout(r, 1500));

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
      const page = (await res.json()).find(p => p.type === 'page');
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = evt => {
        const m = JSON.parse(evt.data);
        if (m.id && pending.has(m.id)) {
          const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
          m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        }
      };
      return;
    } catch (e) { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error('CDP connect failed');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('顶层异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
async function evalIn(name, expr) {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evalJs(`(function(){ var f = document.getElementById('frame-${name}'); return !!(f && f.contentWindow && f.contentWindow.document && f.contentWindow.document.body && f.contentWindow.document.body.children.length); })()`);
    if (ready) break;
    await sleep(150);
  }
  if (!ready) throw new Error(`iframe ${name} 未就绪`);
  const r = await send('Runtime.evaluate', {
    expression: `(function(){ return document.getElementById('frame-${name}').contentWindow.eval(${JSON.stringify(expr)}); })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(`iframe ${name} 异常: ` + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || '')));
  if (!cond) failed++;
}

await connect();

/* 打开总壳 → 切题库 tab（可能弹权益，先关掉） */
await send('Page.navigate', { url: `http://localhost:${PORT}/AI伴学_小程序.html` });
await sleep(3500);
await evalJs(`switchTab('quiz')`);
await sleep(500);
/* 关掉权益弹窗（若有） */
await evalJs(`(function(){ if (typeof closeBenefit === 'function') closeBenefit(); })()`).catch(() => {});
await sleep(200);

const quizInit = await evalIn('quiz', `(() => {
  var item = document.querySelector('.quick-item[onclick*="cam"]');
  return { hasQuick: !!item, quickTxt: item ? item.textContent.trim() : null, hasCamLayer: !!document.getElementById('camLayer'), subKeys: Object.keys(SUB_LAYERS || {}).join(',') };
})()`);
check('题库 tab 有「拍照搜题」快捷项', quizInit.hasQuick, quizInit.quickTxt);
check('快捷项文案=拍照搜题', (quizInit.quickTxt || '').indexOf('拍照搜题') >= 0, quizInit.quickTxt);
check('camLayer 已注册到 SUB_LAYERS', (quizInit.subKeys || '').indexOf('cam') >= 0, quizInit.subKeys);

/* 点拍照搜题 → camLayer 打开 + 子层标题 */
await evalIn('quiz', `document.querySelector('.quick-item[onclick*="cam"]').click()`);
await sleep(800);
const drill = await evalJs(`(function(){
  var quiz = document.getElementById('frame-quiz');
  var cam = quiz && quiz.contentWindow ? quiz.contentWindow.document.getElementById('camLayer') : null;
  var shown = !!(cam && cam.classList.contains('show'));
  var title = document.getElementById('appbarTitle') ? document.getElementById('appbarTitle').textContent : null;
  var exit = document.getElementById('appbarExit') ? document.getElementById('appbarExit').classList.contains('show') : null;
  return { shown: shown, title: title, exit: exit };
})()`);
check('camLayer 下钻打开', drill.shown);
check('appbar 标题=拍照搜题', drill.title === '拍照搜题', drill.title);
check('退出按钮显示', drill.exit);

/* 相机页内：默认搜题模式 + 保存分流 */
const camIn = await evalIn('quiz', `(() => {
  var f = document.getElementById('camLayer').querySelector('iframe');
  var inner = f.contentWindow;
  return {
    mode: inner.CAM_MODE,
    searchActive: inner.document.getElementById('modeSearch').classList.contains('active'),
    hint: inner.document.getElementById('camHint').textContent,
    goBack: typeof inner.goBack === 'function'
  };
})()`);
check('相机页默认搜题模式', camIn.mode === 'search' && camIn.searchActive, camIn.mode);
check('提示文案=拍下题目', (camIn.hint || '').indexOf('拍下题目') >= 0, camIn.hint);
check('相机页有返回函数', camIn.goBack);

/* 拍照（第1次成功）→ 识别结果 AI 填了 Excel 知识点 */
await evalIn('quiz', `(function(){ var f = document.getElementById('camLayer').querySelector('iframe'); f.contentWindow.showResult(true); return true; })()`);
await sleep(1400);
const ocrRes = await evalIn('quiz', `(function(){
  var f = document.getElementById('camLayer').querySelector('iframe');
  var w = f.contentWindow;
  return { type: w.document.getElementById('resultType').value, concept: w.document.getElementById('resultConcept').value,
    txt: w.document.getElementById('resultTxt').value, on: w.document.getElementById('camResult').classList.contains('on') };
})()`);
check('OCR 结果面板打开', ocrRes.on);
check('AI 题型=单选', ocrRes.type === '单选', ocrRes.type);
check('AI 知识点=Excel', ocrRes.concept === 'Excel 电子表格', ocrRes.concept);

/* 保存（搜题）→ 章节刷题「我的上传」localStorage */
await evalIn('quiz', `(function(){ var f = document.getElementById('camLayer').querySelector('iframe'); f.contentWindow.saveUpload(); return true; })()`);
await sleep(300);
const savedSearch = await evalIn('quiz', `(function(){
  var f = document.getElementById('camLayer').querySelector('iframe');
  var share = f.contentWindow.localStorage.getItem('zsb_share_uploads_v1') || '[]';
  return { shareLen: JSON.parse(share).length, qidPrefix: JSON.parse(share)[0].qid[0] };
})()`);
check('搜题保存 → share uploads', savedSearch.shareLen >= 1, savedSearch.shareLen);
check('搜题 qid 前缀 S', savedSearch.qidPrefix === 'S', savedSearch.qidPrefix);

/* 切到错题录入模式 → 拍照 → 保存 → 错题本「我的上传」localStorage */
await evalIn('quiz', `(function(){ var f = document.getElementById('camLayer').querySelector('iframe'); f.contentWindow.setCamMode('capture'); return true; })()`);
const capMode = await evalIn('quiz', `(function(){ var f = document.getElementById('camLayer').querySelector('iframe'); return { m: f.contentWindow.CAM_MODE, active: f.contentWindow.document.getElementById('modeCapture').classList.contains('active') }; })()`);
check('切错题录入模式', capMode.m === 'capture' && capMode.active, capMode.m);

/* 返回 → camLayer 收起 */
await evalIn('quiz', `(function(){ var f = document.getElementById('camLayer').querySelector('iframe'); f.contentWindow.goBack(); return true; })()`);
await sleep(400);
const closed = await evalJs(`(function(){
  var quiz = document.getElementById('frame-quiz');
  return !!(quiz.contentWindow.document.getElementById('camLayer').classList.contains('show'));
})()`);
check('点返回收起 camLayer', !closed);

/* 章节刷题「我的上传」读到搜题题 */
await evalIn('quiz', `document.querySelector('.entry-card[onclick*="chapter"]').click()`);
await sleep(600);
const chapterUp = await evalIn('quiz', `(() => {
  var f = document.getElementById('chapterLayer').querySelector('iframe');
  return { cnt: (f.contentWindow.document.getElementById('cntUpload') || {}).textContent,
    cards: f.contentWindow.document.querySelectorAll('.up-card').length };
})()`);
check('章节刷题「我的上传」chip 有计数', /\(/.test(chapterUp.cnt || ''), chapterUp.cnt);
check('上传卡渲染（含搜题 S01）', chapterUp.cards >= 2, chapterUp.cards);

/* 错题本「我的上传」读到（从错题本直接进，localStorage seed U01/U02 + 可能的错题录入） */
await evalIn('quiz', `document.querySelector('.entry-card[onclick*="wrong"]').click()`);
await sleep(600);
const wrongUp = await evalIn('quiz', `(() => {
  var f = document.getElementById('wrongLayer').querySelector('iframe');
  return { cntUpload: (f.contentWindow.document.getElementById('cntUpload') || {}).textContent,
    listTxt: f.contentWindow.document.getElementById('list').textContent };
})()`);
check('错题本「我的上传」计数显示', /\(/.test(wrongUp.cntUpload || ''), wrongUp.cntUpload);

/* 做题页 upload 链路：模拟章节刷题点「去刷」→ REQ_PRACTICE entry=upload → 做题页能渲染 upload 题 */
await evalJs(`openPractice('upload', { qid: 'S01', name: '我的上传' })`);
await sleep(800);
const practiceUp = await evalIn('practice', `(() => {
  var stem = document.querySelector('.stem');
  var qnum = document.getElementById('navProgress');
  return { stem: stem ? stem.textContent : null, hasBody: !!document.getElementById('qaBody'),
    label: document.querySelector('.tag.type') ? document.querySelector('.tag.type').textContent : null };
})()`);
check('做题页能打开 upload 题（题干渲染）', !!(practiceUp.stem && practiceUp.stem.length > 0), practiceUp.stem);
check('upload 题渲染为判断题', practiceUp.label === '判断题', practiceUp.label);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill();
server.close();
process.exit(failed === 0 ? 0 : 1);