/** 章节刷题页重构验证（v3）：左右分栏 / 手风琴单开 / 二级展开同时出三四级 / 切章重置 / 四级入口
 *  覆盖 PM 2026-09-02 规格：点二级标题→进练习，点右侧⌄→展开（三级+四级同时出现）
 *  点三级标题→进练习，点右侧按钮→展开四级考点；同级单开；切一级全重置
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8791;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9361;
const MIME = { '.html': 'text/html' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/章节刷题.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
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
  if (r.exceptionDetails) throw new Error('eval异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || ''))); if (!cond) failed++; }

await connect();
/* 注入：捕获 postMessage（必须在导航完成后，否则重置丢失） */
await evalJs(`(function(){
  window.__msgs = [];
  window.parent.postMessage = function(msg){ window.__msgs.push(JSON.parse(JSON.stringify(msg))); };
  return true;
})()`);
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(900); };

/* ===== 1. 初始渲染 ===== */
await gotoT(`http://localhost:${PORT}/章节刷题.html`);
// 导航后重新注入钩子
await evalJs(`(function(){
  window.__msgs = [];
  window.parent.postMessage = function(msg){ window.__msgs.push(JSON.parse(JSON.stringify(msg))); };
  return true;
})()`);
let r = await evalJs(`(function(){
  var items = [...document.querySelectorAll('.lv-item')];
  var uploadNav = document.querySelector('.lv-upload');
  return {
    navCount: items.length,
    labels: items.map(i => i.textContent.trim()),
    activeIdx: items.findIndex(i => i.classList.contains('active')),
    noIcon: !items.some(i => i.querySelector('.lavy-icon') || i.querySelector('svg')),
    uploadNavExists: !!uploadNav,
    uploadActive: !!uploadNav && uploadNav.classList.contains('active'),
    chName: document.querySelector('.ch-name').textContent,
    metrics: document.querySelector('.ch-metrics').textContent.replace(/\\s+/g,' ').trim(),
    hasProgress: !!document.querySelector('.ch-progress'),
    subRows: document.querySelectorAll('.sub-row').length,
    visLv3: [...document.querySelectorAll('.lv3-root')].filter(n => n.offsetParent !== null).length
  };
})()`);
check('左栏 10 项', r.navCount === 10, r.navCount);
check('左栏短名(规格)', r.labels[0] === '信计' && r.labels[1] === '计思' && r.labels[3] === 'Word2016' && r.labels[4] === 'Excel2016' && r.labels[7] === '网络检索', r.labels.join(','));
check('左栏无图标', r.noIcon === true, r.noIcon);
check('左栏底部有「我的上传」入口(未选中)', r.uploadNavExists === true && r.uploadActive === false, JSON.stringify(r.uploadNavExists));
check('初始第1章选中', r.activeIdx === 0, r.activeIdx);
check('右侧章全名', r.chName === '信息与计算机基础知识', r.chName);
check('章数据 已做96/120·错27·72%', r.metrics.indexOf('96/120') >= 0 && r.metrics.indexOf('错 27') >= 0 && r.metrics.indexOf('72%') >= 0, r.metrics);
check('章有进度条', r.hasProgress === true, r.hasProgress);
check('第1章 4个二级', r.subRows === 4, r.subRows);
check('初始无展开二级(0个可见 lv3-root)', r.visLv3 === 0, r.visLv3);

/* ===== 2. 二级：点标题→练习；点右侧⌄ 展开 → 三级+四级同时出现（默认展开第一个三级） ===== */
r = await evalJs(`(function(){
  var subRows = document.querySelectorAll('.sub-row');
  subRows[0].querySelector('.sub-title').click();   // 点第1个二级标题 → 应进练习
  return { lastMsg: window.__msgs.slice(-1)[0] };
})()`);
check('点二级标题 → REQ_PRACTICE l2', r.lastMsg && r.lastMsg.type === 'REQ_PRACTICE' && r.lastMsg.data.level === 'l2' && r.lastMsg.data.cid === 1 && r.lastMsg.data.name === '信息与信息技术概述', JSON.stringify(r.lastMsg));
r = await evalJs(`(function(){
  var subRows = document.querySelectorAll('.sub-row');
  var sub0Title = subRows[0].querySelector('.sub-title').textContent;
  subRows[0].querySelector('.sub-arrow').click();   // 点右侧⌄ 展开
  // 渲染重建后重新查询
  var freshRows = [...document.querySelectorAll('.sub-row')];
  var openSubs = freshRows.filter(s => s.classList.contains('open'));
  var visLv4Rows = [...document.querySelectorAll('.lv4-row')].filter(n => n.offsetParent !== null).length;
  var visLv3Groups = [...document.querySelectorAll('.lv3-root')].filter(n => n.offsetParent !== null).length;
  return {
    openSubS: openSub, openL3s: openL3,
    openCnt: openSubs.length,
    firstSubOpen: openSubs[0] && openSubs[0].querySelector('.sub-title').textContent === sub0Title,
    visLv4Rows: visLv4Rows,
    visLv3Groups: visLv3Groups,
    openArrowLbl: openSubs[0] ? openSubs[0].querySelector('.sub-arrow').textContent : ''
  };
})()`);
check('点⌄ → 第1个二级展开', r.openSubS === 0 && r.firstSubOpen, JSON.stringify(r));
check('手风琴：仅1个二级 open', r.openCnt === 1, r.openCnt);
check('展开二级 → 三级组同时出现', r.visLv3Groups === 1, r.visLv3Groups);
check('默认展开第一个三级(四级3考点可见)', r.openL3s === 0 && r.visLv4Rows === 3, JSON.stringify(r));
check('展开箭头变 ⌃', r.openArrowLbl === '⌃', r.openArrowLbl);

/* ===== 3. 手风琴单开（二级）：点第3个二级 → 第1个自动收起 ===== */
r = await evalJs(`(function(){
  document.querySelectorAll('.sub-row')[2].querySelector('.sub-arrow').click();
  var openSubs = [...document.querySelectorAll('.sub-row')].filter(s => s.classList.contains('open'));
  var visLv3 = [...document.querySelectorAll('.lv3-root')].filter(n => n.offsetParent !== null).length;
  return { openSubS: openSub, openL3s: openL3, openCnt: openSubs.length, fstOpen: document.querySelectorAll('.sub-row')[0].classList.contains('open'), thirdOpen: document.querySelectorAll('.sub-row')[2].classList.contains('open'), visLv3: visLv3 };
})()`);
check('点第3个二级 → 第1个自动收起(手风琴)', r.fstOpen === false && r.thirdOpen === true && r.openCnt === 1, JSON.stringify(r));
check('切二级又默认开该二下第一个三级', r.openSubS === 2 && r.openL3s === 0 && r.visLv3 === 1, JSON.stringify(r));

/* ===== 4. 三级：先切回第1个二级，点标题→刷题；点按钮→四级单开切换 ===== */
r = await evalJs(`(function(){
  document.querySelectorAll('.sub-row')[0].querySelector('.sub-arrow').click();  // 切回第1个二级
  var l3rows = [...document.querySelectorAll('.lv3-row')];
  l3rows[0].querySelector('.lv3-title').click();      // 点「信息与数据」标题 → 应进l3练习
  return { lastMsg: window.__msgs.slice(-1)[0] };
})()`);
check('点三级标题 → REQ_PRACTICE l3', r.lastMsg && r.lastMsg.type === 'REQ_PRACTICE' && r.lastMsg.data.level === 'l3' && r.lastMsg.data.name === '信息与数据', JSON.stringify(r.lastMsg));
r = await evalJs(`(function(){
  var l3rows = [...document.querySelectorAll('.lv3-row')];
  l3rows[1].querySelector('.pick').click();           // 点「信息技术与计算机文化」展开钮 → 应替换0
  return {
    openL3s: openL3,
    fstVis: !document.querySelectorAll('.lv4-list')[0].classList.contains('hidden'),
    secVis: !document.querySelectorAll('.lv4-list')[1].classList.contains('hidden'),
    visLv4: [...document.querySelectorAll('.lv4-list')].filter(n => !n.classList.contains('hidden') && n.offsetParent !== null).length
  };
})()`);
check('三级按钮 → 四级单开替换', r.openL3s === 1 && r.fstVis === false && r.secVis === true && r.visLv4 === 1, JSON.stringify(r));
r = await evalJs(`(function(){
  var l3rows = [...document.querySelectorAll('.lv3-row')];
  l3rows[1].querySelector('.pick').click();           // 再点 → 收起
  return { openL3s: openL3, secVis: !document.querySelectorAll('.lv4-list')[1].classList.contains('hidden') };
})()`);
check('三级再点展开钮 → 收起四级', r.openL3s === null && r.secVis === false, JSON.stringify(r));

/* ===== 5. 切一级章节 → 展开全重置 + fresh 章无进度条/「未练习」 ===== */
r = await evalJs(`(function(){
  var items = [...document.querySelectorAll('.lv-item')];
  items[2].click();  // Win10（渲染重建）
  var freshItems = [...document.querySelectorAll('.lv-item')];
  var visLv3 = [...document.querySelectorAll('.lv3-root')].filter(n => n.offsetParent !== null).length;
  return {
    activeIdx: freshItems.findIndex(i => i.classList.contains('active')),
    openSubS: openSub, openL3s: openL3,
    hasProgress: !!document.querySelector('.ch-progress'),
    chName: document.querySelector('.ch-name').textContent,
    freshTag: !!document.querySelector('.fresh-tag'),
    subRows: document.querySelectorAll('.sub-row').length,
    visLv3: visLv3,
    collapseLbl: document.querySelector('.ch-collapse').textContent
  };
})()`);
check('切到第3章(Win10)', r.activeIdx === 2 && r.chName === '操作系统（Windows 10）', r.chName);
check('切章 → openSub/openL3 全重置', r.openSubS === null && r.openL3s === null, JSON.stringify(r));
check('fresh 章：无进度条 + 未练习标签', (r.hasProgress === false) && (r.freshTag === true), JSON.stringify(r));
check('第3章 3个二级', r.subRows === 3, r.subRows);
check('切章后无展开', r.visLv3 === 0, r.visLv3);
check('章头按钮显示「展开」', r.collapseLbl === '展开', r.collapseLbl);

/* ===== 6. 章头展开/收起 ===== */
r = await evalJs(`(function(){ document.querySelector('.ch-collapse').click(); return { openSubS: openSub, openL3s: openL3, lbl: document.querySelector('.ch-collapse').textContent, visLv3: [...document.querySelectorAll('.lv3-root')].filter(n=>n.offsetParent!==null).length }; })()`);
check('「展开」→ 第1个二级+其三级四级全开', r.openSubS === 0 && r.openL3s === 0 && r.visLv3 === 1, JSON.stringify(r));
r = await evalJs(`(function(){ document.querySelector('.ch-collapse').click(); return { openSubS: openSub, lbl: document.querySelector('.ch-collapse').textContent }; })()`);
check('再点 → 全部收起', r.openSubS === null && r.lbl === '展开', JSON.stringify(r));

/* ===== 6b. 三级顽固示例：第2章展开「算法基础」→「基本算法」行带顽固标签 ===== */
r = await evalJs(`(function(){
  var items = [...document.querySelectorAll('.lv-item')];
  items[1].click();                       // 切到第2章（计算思维）
  document.querySelectorAll('.sub-arrow')[1].click();  // 展开「算法基础」（顺带默认开第一个三级）
  var l3rows = [...document.querySelectorAll('.lv3-row')];
  var basic = l3rows.find(row => row.querySelector('.lv3-title').textContent === '基本算法');
  return {
    openSubS: openSub,
    basicTitle: basic ? basic.querySelector('.lv3-title').textContent : '',
    l3Stubborn: basic ? !!basic.querySelector('.lv3-meta .m-stubborn') : false,
    metaTxt: basic ? basic.querySelector('.lv3-meta').textContent.replace(/\\s+/g,' ').trim() : '',
    chHeadMetrics: document.querySelector('.ch-metrics').textContent.replace(/\\s+/g,' ').trim()
  };
})()`);
check('二级手风琴展开「算法基础」', r.openSubS === 1, r.openSubS);
check('基本算法行带三级顽固标签', r.basicTitle === '基本算法' && r.l3Stubborn === true, r.metaTxt);
check('第2章数据自洽(21/48·错9)', r.chHeadMetrics.indexOf('21/48') >= 0 && r.chHeadMetrics.indexOf('错 9') >= 0, r.chHeadMetrics);

/* ===== 7. 四级整行 → REQ_PRACTICE l4（切回来第1章） ===== */
r = await evalJs(`(function(){
  var items = [...document.querySelectorAll('.lv-item')];
  items[0].click();   // 切回第1章（渲染重建）
  document.querySelectorAll('.sub-row')[0].querySelector('.sub-arrow').click();  // 展开（渲染重建）
  var l4 = document.querySelectorAll('.lv4-row')[0];
  var name = l4.querySelector('.lv4-title').textContent;
  l4.click();  // 整行点击
  return { name: name, msgs: window.__msgs.slice(-1)[0] };
})()`);
check('四级整行点击 → REQ_PRACTICE chapter/l4', r.msgs && r.msgs.type === 'REQ_PRACTICE' && r.msgs.data.entry === 'chapter' && r.msgs.data.level === 'l4' && r.msgs.data.cid === 1 && r.msgs.data.name === r.name, JSON.stringify(r.msgs));

/* ===== 8. 「我的上传」入口：左栏底部 → 右侧切上传列表 ===== */
r = await evalJs(`(function(){
  document.querySelector('.lv-upload').click();   // 切到我的上传视图
  var freshBox = document.getElementById('lvContent');
  var uploadCard = freshBox.querySelector('.up-card');
  return {
    showUploadS: showUpload,
    cn: freshBox.querySelector('.ch-name').textContent,
    metric: freshBox.querySelector('.ch-metrics').textContent.replace(/\\s+/g,' ').trim(),
    uploadCardExists: !!uploadCard,
    uploadTitle: uploadCard ? uploadCard.querySelector('.up-title').textContent : '',
    typeTag: uploadCard ? uploadCard.querySelector('.tag-pill').textContent.trim() : '',
    uploadNavActive: document.querySelector('.lv-upload').classList.contains('active'),
    noChapActive: [...document.querySelectorAll('.lv-item')].some(i => i.classList.contains('active'))
  };
})()`);
check('点我的上传 → 右侧显示上传列表', r.showUploadS === true && r.cn === '我的上传' && r.metric.indexOf('1') >= 0, JSON.stringify(r));
check('上传卡片标题存在', r.uploadCardExists === true && r.uploadTitle.indexOf('Excel 中可以进行单元格引用') >= 0, r.uploadTitle);
check('上传卡片标签只显示题型「单选」', r.typeTag === '单选', r.typeTag);
check('我的上传入口选中 + 章节无选中', r.uploadNavActive === true && r.noChapActive === false, JSON.stringify(r));

/* ===== 9. 切回任意章节 → 回到章节视图且我的上传取消选中 ===== */
r = await evalJs(`(function(){
  [...document.querySelectorAll('.lv-item')][1].click();   // 切到第2章
  return {
    showUploadS: showUpload,
    cn: document.querySelector('.ch-name').textContent,
    uploadActive: document.querySelector('.lv-upload').classList.contains('active'),
    chapActive: [...document.querySelectorAll('.lv-item')].find(i => i.classList.contains('active'))?.textContent.trim()
  };
})()`);
check('切回章节 → 我的上传视图退出', r.showUploadS === false && r.cn === '计算思维' && r.uploadActive === false && r.chapActive === '计思', JSON.stringify(r));

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);