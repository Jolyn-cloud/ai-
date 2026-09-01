/**
 * 错题本「拍照录入」全链路验证
 * 运行：node _cdp_wrong_upload.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
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

const DEVTOOLS_PORT = 9334;
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chrome2`]);
await new Promise(r => rm.on('exit', r));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${ROOT}/.tmp-chrome2`,
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

/* 1. 直接导航错题本 */
await send('Page.navigate', { url: `http://localhost:${PORT}/错题本.html` });
await new Promise(r => setTimeout(r, 800));

const init = await evaluate(`(() => {
  var over = document.getElementById('stTotal') ? document.getElementById('stTotal').textContent : null;
  var hasFab = !!document.querySelector('.camera-fab');
  var chip = document.querySelector('[data-filter="upload"]');
  var cnt = document.getElementById('cntUpload') ? document.getElementById('cntUpload').textContent : null;
  var listTxt = document.getElementById('list') ? document.getElementById('list').textContent : '';
  var hasUpSec = listTxt.indexOf('我的上传') >= 0;
  var hasU01 = listTxt.indexOf('可屏蔽中断') >= 0;
  var hasU02thumb = !!document.querySelector('.q-img-thumb');
  return { over: over, fab: hasFab, chip: chip ? chip.textContent.trim() : null, cnt: cnt, upSec: hasUpSec, u01: hasU01, u02thumb: hasU02thumb };
})()`);
check('总览 total=8', init.over === '8', init.over);
check('右上角拍照按钮存在', init.fab);
check('「我的上传」chip 存在', !!(init.chip && init.chip.indexOf('我的上传') >= 0), init.chip);
check('chip 计数 (2)', init.cnt === '(2)', init.cnt);
check('列表有「我的上传」区', init.upSec);
check('U01 文字题渲染 title', init.u01);
check('U02 图片题渲染占位缩略图', init.u02thumb);

/* 2. 筛选「我的上传」 */
await evaluate(`setFilter('upload')`);
await new Promise(r => setTimeout(r, 200));
const upFilter = await evaluate(`(() => {
  var listTxt = document.getElementById('list').textContent;
  var qcards = document.querySelectorAll('.q-card').length;
  var active = document.querySelector('.chip.active') ? document.querySelector('.chip.active').dataset.filter : null;
  return { txt: listTxt, cards: qcards, active: active };
})()`);
check('筛选后只显示上传题（2 卡）', upFilter.cards === 2, 'cards=' + upFilter.cards);
check('激活 chip = upload', upFilter.active === 'upload', upFilter.active);
check('筛选后无模块题', upFilter.txt.indexOf('进程与线程') < 0);

/* 3. 打开拍照 mask */
await evaluate(`openCam()`);
await new Promise(r => setTimeout(r, 200));
const cam = await evaluate(`(() => {
  var m = document.getElementById('camMask');
  return { display: m ? m.style.display : null, flashOn: !!document.getElementById('camFlash').classList.contains('active') };
})()`);
check('拍照 mask 打开 (flex)', cam.display === 'flex', cam.display);
check('手电筒默认亮', cam.flashOn);

/* 4. 手电筒 toggle */
await evaluate(`toggleFlash()`);
await new Promise(r => setTimeout(r, 100));
const flash = await evaluate(`(() => {
  var sh = document.getElementById('camShade');
  var fl = document.getElementById('camFlash');
  return { shade: sh.style.display, dim: fl.classList.contains('dim') };
})()`);
check('手电筒切换→暗（shade 显示）', flash.shade === 'block', flash.shade);
check('点击 icon 变暗', flash.dim);
await evaluate(`toggleFlash()`); // 恢复亮

/* 5. 拍照 → OCR → 识别成功分支 */
await evaluate(`takePhoto()`);
await new Promise(r => setTimeout(r, 1300));
const okRes = await evaluate(`(() => {
  var res = document.getElementById('camResult');
  var title = document.getElementById('resultTitle').textContent;
  var txt = document.getElementById('resultTxt').value;
  var txtDisp = document.getElementById('resultTxt').style.display;
  var tags = document.querySelectorAll('#resultTags .tag-pill').length;
  var activeTag = document.querySelector('#resultTags .tag-pill.active');
  var prev = document.getElementById('resultPreview').textContent;
  var imgWrap = document.getElementById('resultImgWrap').innerHTML;
  return { on: res.classList.contains('on'), title: title, txt: txt, txtDisp: txtDisp,
    tags: tags, activeTag: activeTag ? activeTag.textContent : null, prev: prev, imgWrap: imgWrap };
})()`);
check('OCR 成功面板打开', okRes.on);
check('标题=识别成功', okRes.title === '识别成功', okRes.title);
check('题干可编辑（textarea 有值+显示）', !!okRes.txt && okRes.txtDisp !== 'none', okRes.txt);
check('4 个标签可替换', okRes.tags === 4, 'tags=' + okRes.tags);
check('有激活标签', !!okRes.activeTag, okRes.activeTag);
check('提示包含「系统推荐标签」', okRes.prev.indexOf('系统推荐标签') >= 0, okRes.prev);
check('图片题占位为空', okRes.imgWrap.trim() === '');

/* 6. 保存 → 上传题 +1（先看当前数量，以便测完恢复） */
const before = await evaluate(`WRONG_DATA.uploads.length`);
await evaluate(`saveUpload()`);
await new Promise(r => setTimeout(r, 200));
const afterSave = await evaluate(`(() => {
  var n = WRONG_DATA.uploads.length;
  var last = WRONG_DATA.uploads[n-1];
  var totalTxt = document.getElementById('stTotal').textContent;
  var cnt = document.getElementById('cntUpload').textContent;
  var maskDisp = document.getElementById('camMask').style.display;
  return { n: n, qid: last.qid, mode: last.mode, tag: last.tag, source: last.source,
    total: totalTxt, cnt: cnt, mask: maskDisp };
})()`);
check('保存后 uploads +1', afterSave.n === before + 1, before + '→' + afterSave.n);
check('新 qid 前缀 U', /^U\d{2}$/.test(afterSave.qid), afterSave.qid);
check('新题 source=upload', afterSave.source === 'upload');
check('总览 total 刷新为 9', afterSave.total === '9', afterSave.total);
check('chip 计数刷新 (3)', afterSave.cnt === '(3)', afterSave.cnt);
check('mask 已关闭', afterSave.mask === 'none', afterSave.mask);

/* 7. 再次打开→拍照→失败分支（未识别→图片题） */
await evaluate(`openCam()`);
await evaluate(`takePhoto()`);
await new Promise(r => setTimeout(r, 1300));
const failRes = await evaluate(`(() => {
  var res = document.getElementById('camResult');
  var title = document.getElementById('resultTitle').textContent;
  var txtDisp = document.getElementById('resultTxt').style.display;
  var thumb = document.querySelector('#resultImgWrap .result-thumb-img');
  var prev = document.getElementById('resultPreview').textContent;
  var activeTag = document.querySelector('#resultTags .tag-pill.active');
  return { on: res.classList.contains('on'), title: title, txtDisp: txtDisp,
    thumb: !!thumb, prev: prev, activeTag: activeTag ? activeTag.textContent : null,
    tagV: (function(){ var t = document.querySelector('#resultTags .tag-pill.active'); return t ? t.dataset.tag : null; })() };
})()`);
check('失败面板打开', failRes.on);
check('标题=未识别出文字', failRes.title === '未识别出文字', failRes.title);
check('textarea 隐藏（无文字）', failRes.txtDisp === 'none', failRes.txtDisp);
check('图片占位显示', failRes.thumb);
check('提示「未识别出文字，已保存为图片题」', failRes.prev.indexOf('未识别出文字，已保存为图片题') >= 0, failRes.prev);

/* 8. 保存 → 图片题 +1（恢复 uploads 数量） */
await evaluate(`saveUpload()`);
await new Promise(r => setTimeout(r, 200));
const afterImg = await evaluate(`(() => {
  var n = WRONG_DATA.uploads.length;
  var last = WRONG_DATA.uploads[n-1];
  return { n: n, mode: last.mode, tag: last.tag, total: document.getElementById('stTotal').textContent,
    cnt: document.getElementById('cntUpload').textContent, hasThumb: !!document.querySelector('.q-img-thumb') };
})()`);
check('保存图片题后 +1', afterImg.n === before + 2, before + '→' + afterImg.n);
check('新题 mode=image', afterImg.mode === 'image');
check('新试题默认 tag=confusion', afterImg.tag === 'confusion', afterImg.tag);
check('总览 total=10', afterImg.total === '10', afterImg.total);
check('chip 计数 (4)', afterImg.cnt === '(4)', afterImg.cnt);
check('列表出现新图片占位卡', afterImg.hasThumb);

/* 9. 过滤 upload，检查 2 张图片占位 + 2 文字卡 */
await evaluate(`setFilter('upload')`);
await new Promise(r => setTimeout(r, 200));
const finalList = await evaluate(`(() => {
  var thumbs = document.querySelectorAll('.q-img-thumb').length;
  var cards = document.querySelectorAll('.q-card').length;
  var tags = Array.from(document.querySelectorAll('.q-card .q-tag')).map(function(t){ return t.textContent; });
  return { thumbs: thumbs, cards: cards, tags: tags };
})()`);
check('上传筛选下 4 卡', finalList.cards === 4, 'cards=' + finalList.cards);
check('2 张图片占位卡', finalList.thumbs === 2, 'thumbs=' + finalList.thumbs);
console.log('  tags=' + JSON.stringify(finalList.tags));

/* AI 标签关键词单元测试 */
const tagTests = await evaluate(`(() => {
  return {
    op: suggestTag('在 Excel 中，按快捷键 Ctrl+C 复制'),
    mem: suggestTag('背诵口诀：区分顺序'),
    con: suggestTag('操作系统的基本概念和特征'),
    de: suggestTag('呃呃额额')
  };
})()`);
check('AI tag→operation', tagTests.op === 'operation', tagTests.op);
check('AI tag→memory', tagTests.mem === 'memory', tagTests.mem);
check('AI tag→confusion', tagTests.con === 'confusion', tagTests.con);
check('AI 默认→confusion', tagTests.de === 'confusion', tagTests.de);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill();
server.close();
process.exit(failed === 0 ? 0 : 1);