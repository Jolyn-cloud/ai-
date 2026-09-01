/**
 * 拍照录入 v2 全链路验证
 * 覆盖：右下角 FAB / 搜题·错题录入模式切换 / AI 题型·知识点 / 保存分流 / 章节刷题「我的上传」
 * 运行：node _cdp_photo_v2.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8766;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = { '.html': 'text/html', '.js': 'application/javascript' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/AI伴学_小程序.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[file.match(/\.\w+$/)?.[0] || ''] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

const DEVTOOLS_PORT = 9335;
await new Promise(r => { const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chrome3`]); rm.on('exit', r); });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${ROOT}/.tmp-chrome3`,
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
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || '')));
  if (!cond) failed++;
}

await connect();

/* ========== PART A 错题本 ========== */
await send('Page.navigate', { url: `http://localhost:${PORT}/错题本.html` });
await new Promise(r => setTimeout(r, 800));

const init = await evaluate(`(() => {
  var fab = document.querySelector('.camera-fab');
  var fabStyle = fab ? getComputedStyle(fab) : null;
  var hasSvg = !!(fab && fab.querySelector('svg'));
  return {
    fabPos: fabStyle ? fabStyle.bottom + '/' + fabStyle.right : null,
    fabRound: fabStyle ? fabStyle.borderRadius : null,
    hasSvg: hasSvg,
    cntUpload: document.getElementById('cntUpload') ? document.getElementById('cntUpload').textContent : null
  };
})()`);
check('FAB 右下角 fixed bottom:18/right:18', init.fabPos === '18px/18px', init.fabPos);
check('FAB 圆形', init.fabRound === '50%', init.fabRound);
check('FAB 线性 SVG 相机图标', init.hasSvg);

/* 打开相机 → 顶部模式切换控件 */
await evaluate(`openCam()`);
await new Promise(r => setTimeout(r, 200));
const cam = await evaluate(`(() => {
  return {
    modeBtns: document.querySelectorAll('.cam-mode-btn').length,
    hasCapture: !!document.getElementById('modeCapture'),
    hasSearch: !!document.getElementById('modeSearch'),
    defaultMode: CAM_MODE,
    capActive: document.getElementById('modeCapture').classList.contains('active'),
    hint: document.getElementById('camHint').textContent,
    albumSvg: !!document.querySelector('.cam-side svg'),
    torch: !!document.getElementById('camTorch'),
    torchActive: document.getElementById('camTorch').classList.contains('active')
  };
})()`);
check('相机顶栏两个模式按钮', cam.modeBtns === 2, cam.modeBtns);
check('默认错题录入', cam.defaultMode === 'capture' && cam.capActive);
check('默认提示文案', cam.hint.indexOf('对准题目纸') >= 0, cam.hint);
check('底栏相册/手电筒线性图标', cam.albumSvg && cam.torch);
check('手电筒默认亮态', cam.torchActive);

/* 切换到搜题模式 */
await evaluate(`setCamMode('search')`);
await new Promise(r => setTimeout(r, 100));
const searchMode = await evaluate(`(() => {
  return {
    mode: CAM_MODE,
    searchActive: document.getElementById('modeSearch').classList.contains('active'),
    capActive: document.getElementById('modeCapture').classList.contains('active'),
    hint: document.getElementById('camHint').textContent
  };
})()`);
check('切换后 CAM_MODE=search', searchMode.mode === 'search');
check('搜题按钮高亮', searchMode.searchActive && !searchMode.capActive);
check('搜题提示文案', searchMode.hint.indexOf('AI 搜索题库匹配') >= 0, searchMode.hint);

/* 拍照 → OCR → 识别成功（搜题模式 mock 文案应触发 Excel 知识点） */
await evaluate(`setCamMode('capture')`);   /* 回错题录入，验证默认分支 */
await evaluate(`takePhoto()`);
await new Promise(r => setTimeout(r, 1300));
const okRes = await evaluate(`(() => {
  return {
    txt: document.getElementById('resultTxt').value,
    typeV: document.getElementById('resultType').value,
    conceptV: document.getElementById('resultConcept').value,
    tagPills: document.querySelectorAll('#resultTags .tag-pill').length
  };
})()`);
check('识别成功题干预填', okRes.txt.length > 0);
check('AI 题型预填', okRes.typeV === '单选', okRes.typeV);
check('AI 知识点=操作系统', okRes.conceptV === '操作系统', okRes.conceptV);
check('错题标签 4 选', okRes.tagPills === 4, okRes.tagPills);

/* AI 引擎单元测试 */
const engines = await evaluate(`(() => ({
  multi: suggestType('下列哪些属于操作系统功能（ ）'),
  judge: suggestType('下列关于进程的说法是否正确？'),
  fill: suggestType('______是程序的一次执行过程。'),
  single: suggestType('操作系统的作用不包括（ ）。'),
  ex: suggestConcept('SUM 函数用于求和，VLOOKUP 用于查找'),
  os: suggestConcept('操作系统的基本概念和特征'),
  net: suggestConcept('TCP/IP 协议分层'),
  db: suggestConcept('SQL 中 SELECT 查询语句'),
  def: suggestConcept('请问这道题选什么')
}))()`);
check('题型→多选', engines.multi === 'multi', engines.multi);
check('题型→判断', engines.judge === 'judge', engines.judge);
check('题型→填空', engines.fill === 'fill', engines.fill);
check('题型默认→单选', engines.single === 'single', engines.single);
check('知识点→Excel', engines.ex === 'Excel 电子表格', engines.ex);
check('知识点→操作系统', engines.os === '操作系统', engines.os);
check('知识点→网络', engines.net === '计算机网络', engines.net);
check('知识点→数据库', engines.db === '数据库', engines.db);
check('知识点默认→待归类', engines.def === '待归类', engines.def);

/* 保存分流：错题录入 → WRONG_DATA.uploads */
await evaluate(`saveUpload()`);
await new Promise(r => setTimeout(r, 200));
const saveCap = await evaluate(`(() => {
  var n = WRONG_DATA.uploads.length;
  var last = WRONG_DATA.uploads[n-1];
  var share = JSON.parse(localStorage.getItem('zsb_share_uploads_v1') || '[]');
  return { n: n, qid: last.qid, source: last.source, concept: last.concept,
    type: last.type, shareLen: share.length, cnt: document.getElementById('cntUpload').textContent };
})()`);
check('错题录入 → WRONG_DATA.uploads +1', saveCap.n === 3, saveCap.n);
check('错题录入 qid 前缀 U', /^U\d{2}$/.test(saveCap.qid), saveCap.qid);
check('错题录入存了知识点', saveCap.concept === '操作系统', saveCap.concept);
check('错题录入未写 share localStorage', saveCap.shareLen === 0, saveCap.shareLen);
check('chips 更新 (3)', saveCap.cnt === '(3)', saveCap.cnt);

/* 模式切到搜题 → 拍照→保存 → SHARE_DATA localStorage
   （CAM_SHOTS 跨会话累加：第二次拍照命中失败分支，需手动 showResult(true) 钻入成功分支，mock 文案用搜题题） */
await evaluate(`openCam()`);
await evaluate(`setCamMode('search')`);
await evaluate(`CAM_SHOTS = 0; takePhoto()`);
await new Promise(r => setTimeout(r, 1300));
await evaluate(`saveUpload()`);
await new Promise(r => setTimeout(r, 200));
const saveSearch = await evaluate(`(() => {
  var share = JSON.parse(localStorage.getItem('zsb_share_uploads_v1') || '[]');
  var wrong = WRONG_DATA.uploads.length;
  return { shareLen: share.length, last: share[0], wrong: wrong };
})()`);
check('搜题 → share localStorage +1', saveSearch.shareLen === 1, saveSearch.shareLen);
check('搜题新题 qid 前缀 S', /^S\d{2}$/.test(saveSearch.last.qid), saveSearch.last.qid);
check('搜题新题知识点=Excel', saveSearch.last.concept === 'Excel 电子表格', saveSearch.last.concept);
check('搜题不影响错题本 uploads', saveSearch.wrong === 3, saveSearch.wrong);

/* ========== PART B 章节刷题 ========== */
await send('Page.navigate', { url: `http://localhost:${PORT}/章节刷题.html` });
await new Promise(r => setTimeout(r, 800));

const share = await evaluate(`(() => {
  var chip = document.querySelector('[data-filter="upload"]');
  var cnt = document.getElementById('cntUpload') ? document.getElementById('cntUpload').textContent : null;
  var sec = document.querySelector('.upload-section');
  var cards = document.querySelectorAll('.up-card').length;
  var qids = Array.from(document.querySelectorAll('.up-card')).map(function(c){ return c.dataset.qid; });
  var titles = document.querySelectorAll('.up-title');
  var imgs = document.querySelectorAll('.up-thumb').length;
  return { chip: chip ? chip.textContent.trim() : null, cnt: cnt, sec: !!sec, cards: cards,
    qids: qids, firstTitle: titles.length ? titles[0].textContent : null, imgs: imgs };
})()`);
check('章节刷题有「我的上传」chip', !!(share.chip && share.chip.indexOf('我的上传') >= 0), share.chip);
check('chip 计数含 U01+搜题', share.cnt === '(2)', share.cnt);
check('「我的上传」区块渲染', share.sec);
check('渲染 2 张上传卡（U01 + S01）', share.cards === 2, share.cards);
check('搜题 S01 排最前（新建优先）', share.qids[0].indexOf('S') === 0, JSON.stringify(share.qids));
check('S01 标题存在', /运算符/.test(share.firstTitle || ''), share.firstTitle);
check('推理题缩略图标渲染', share.imgs === 2, share.imgs);

/* 点击「我的上传」chip → 只看上传 */
await evaluate(`setFilter('upload')`);
await new Promise(r => setTimeout(r, 200));
const upFilter = await evaluate(`(() => {
  var ch = document.querySelectorAll('.chapter-card').length;
  var sec = document.querySelector('.upload-section') ? 'keep' : 'none';
  var active = document.querySelector('.chip.active') ? document.querySelector('.chip.active').dataset.filter : null;
  return { ch: ch, sec: sec, active: active };
})()`);
check('upload 筛选下章节隐藏', upFilter.ch === 0, upFilter.ch);
check('upload 筛选下上传区保留', upFilter.sec === 'keep');
check('激活 chip=upload', upFilter.active === 'upload', upFilter.active);

/* 切回 all，验证上传区恢复 */
await evaluate(`setFilter('all')`);
await new Promise(r => setTimeout(r, 200));
const allBack = await evaluate(`(() => ({
  ch: document.querySelectorAll('.chapter-card').length,
  sec: !!document.querySelector('.upload-section')
}))()`);
check('切回全部 10 章', allBack.ch === 10, allBack.ch);
check('上传区仍显示', allBack.sec);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill();
server.close();
process.exit(failed === 0 ? 0 : 1);