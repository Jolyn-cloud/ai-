/**
 * CDP 回归：拍照搜题 AI识别结果页页头由 appbar 统一承担
 * 运行：node _cdp_cam_appbar.mjs
 * 前置：Chrome headless 以 --remote-debugging-port 启动（脚本自动）
 *
 * 验证链路：
 *  1. 拍照搜题：拍照 → appbar 标题=AI识别 + 页内 result-head 隐藏
 *  2. appbar 退出 → 回取景（标题恢复拍照搜题，result-head 仍隐藏但不可见）
 *  3. 错题本拍照录入：同款链路（cam/wrong 子层一致）
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8766;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9334;

/* ---------- 静态文件服务 ---------- */
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/AI伴学_小程序.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

/* ---------- 启动 Chrome ---------- */
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chrome`]);
await new Promise(r => rm.on('exit', r));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${ROOT}/.tmp-chrome`,
]);
await new Promise(r => setTimeout(r, 1200));

/* ---------- CDP 客户端 ---------- */
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
      const pages = await res.json();
      const page = pages.find(p => p.type === 'page');
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = evt => {
        const m = JSON.parse(evt.data);
        if (m.id && pending.has(m.id)) {
          const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
          m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        }
      };
      await send('Page.enable');
      return page;
    } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('无法连接 CDP');
}

/* ---------- 工具 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILED = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else { FAILED++; console.log(`  ❌ ${name} ${extra}`); }
}

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('顶层异常: ' + JSON.stringify(r.exceptionDetails));
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
    returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(`iframe ${name} 异常: ` + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

/* ---------- 主流程 ---------- */
try {
  console.log('\n== 启动总壳 + 登录前置 ==');
  await connect();
  await send('Page.navigate', { url: `http://localhost:${PORT}/AI伴学_小程序.html` });
  await sleep(3500);

  // 快速登录：切功能 tab → 领权益 → 登录 sheet → 同意协议 → 微信登录 → 选手机号
  await evalJs(`document.querySelector('.tab-item[data-frame="quiz"]').click()`);
  await sleep(300);
  await evalJs(`document.getElementById('benefitCta').click()`);
  await sleep(260);
  await evalJs(`loginAgree.checked=true; loginButton.click()`);
  await sleep(300);
  await evalJs(`document.querySelector('.phone-item').click()`);
  await sleep(400);
  const logged = await evalJs(`STATE.logged === true && STATE.vipClaimed === true`);
  check('登录前置完成', logged === true);

  // 填画像（避免后续提示）
  await evalJs(`switchTab('study')`);
  await sleep(200);
  await evalIn('study', `
    document.getElementById('schoolInput').value = '山东大学';
    document.getElementById('majorInput').value = '计算机科学与技术';
    var g = document.querySelector('#gradeGroup .field-chip[data-v="大三"]');
    if (g) g.classList.add('on');
    doSaveProfile(); 'ok'
  `);
  await sleep(400);

  console.log('\n== 1. 拍照搜题：拍照 → appbar 承担 AI识别 标题 ==');
  await evalJs(`switchTab('quiz')`);
  await sleep(400);
  // 题库首页点「拍照搜题」入口 → 打开 cam 子层
  await evalIn('quiz', `openSubLayer('cam'); 'ok'`);
  await sleep(400);
  const camTitle = await evalJs(`document.getElementById('appbarTitle').textContent`);
  check('打开拍照搜题子层 → appbar 标题=拍照搜题', camTitle === '拍照搜题', `得到: ${camTitle}`);
  const camExitShown = await evalJs(`document.getElementById('appbarExit').classList.contains('show')`);
  check('拍照搜题子层 → appbar 退出按钮显示', camExitShown === true);

  // 在 cam iframe 内拍照（奇数次=成功 → 出 AI 识别结果页）
  await evalIn('quiz', `(function(){ var f=document.getElementById('camLayer').querySelector('iframe'); if(f&&f.contentWindow) f.contentWindow.takePhoto(); })(); 'ok'`);
  await sleep(1300); // OCR 1s + 结果页渲染
  const resultTitle = await evalJs(`document.getElementById('appbarTitle').textContent`);
  check('拍照出结果页 → appbar 标题=AI识别', resultTitle === 'AI识别', `得到: ${resultTitle}`);

  // 页内 result-head 应被隐藏（has-appbar）
  const resultHeadHidden = await evalIn('quiz', `(function(){ var f=document.getElementById('camLayer').querySelector('iframe'); if(!f||!f.contentWindow) return 'no-iframe'; var h=f.contentWindow.document.querySelector('.result-head'); if(!h) return 'no-head'; return getComputedStyle(h).display; })()`);
  check('结果页内自绘 result-head 已隐藏', resultHeadHidden === 'none', `得到: ${resultHeadHidden}`);

  // 隐藏页头后 result-body 顶部 padding 补到 12px（appbar 下方留白）
  const bodyPadding = await evalIn('quiz', `(function(){ var f=document.getElementById('camLayer').querySelector('iframe'); if(!f||!f.contentWindow) return 'no-iframe'; var b=f.contentWindow.document.querySelector('.result-body'); if(!b) return 'no-body'; return getComputedStyle(b).paddingTop; })()`);
  check('隐藏页头后 result-body 顶部留白=12px', bodyPadding === '12px', `得到: ${bodyPadding}`);

  // camResult.on 已打开
  const resultOn = await evalIn('quiz', `(function(){ var f=document.getElementById('camLayer').querySelector('iframe'); if(!f||!f.contentWindow) return false; return f.contentWindow.document.getElementById('camResult').classList.contains('on'); })()`);
  check('结果页 camResult.on 已打开', resultOn === true);

  console.log('\n== 2. appbar 退出 → 回取景（标题恢复拍照搜题）==');
  await evalJs(`document.getElementById('appbarExit').click()`);
  await sleep(400);
  const backTitle = await evalJs(`document.getElementById('appbarTitle').textContent`);
  check('退出结果页 → appbar 标题恢复=拍照搜题', backTitle === '拍照搜题', `得到: ${backTitle}`);
  // 仍在 cam 子层（未收层）
  const stillInCam = await evalIn('quiz', `(function(){ var l=document.getElementById('camLayer'); return l.classList.contains('show'); })()`);
  check('退出结果页后仍在拍照搜题子层(未收层)', stillInCam === true);
  // 结果页已关闭
  const resultClosed = await evalIn('quiz', `(function(){ var f=document.getElementById('camLayer').querySelector('iframe'); if(!f||!f.contentWindow) return false; return f.contentWindow.document.getElementById('camResult').classList.contains('on'); })()`);
  check('退出结果页后 camResult 已关闭', resultClosed === false);

  console.log('\n== 3. 错题本拍照录入：同款链路 ==');
  // 先收起 cam 子层，再开 wrong 子层
  await evalIn('quiz', `closeSubLayer(); 'ok'`);
  await sleep(300);
  await evalIn('quiz', `openSubLayer('wrong'); 'ok'`);
  await sleep(400);
  const wrongTitle = await evalJs(`document.getElementById('appbarTitle').textContent`);
  check('打开错题本子层 → appbar 标题=错题本', wrongTitle === '错题本', `得到: ${wrongTitle}`);

  // 在 wrong iframe 内打开相机 + 拍照
  await evalIn('quiz', `(function(){ var f=document.getElementById('wrongLayer').querySelector('iframe'); if(f&&f.contentWindow) f.contentWindow.openCam(); })(); 'ok'`);
  await sleep(300);
  await evalIn('quiz', `(function(){ var f=document.getElementById('wrongLayer').querySelector('iframe'); if(f&&f.contentWindow) f.contentWindow.takePhoto(); })(); 'ok'`);
  await sleep(1300);
  const wrongResultTitle = await evalJs(`document.getElementById('appbarTitle').textContent`);
  check('错题本拍照出结果页 → appbar 标题=AI识别', wrongResultTitle === 'AI识别', `得到: ${wrongResultTitle}`);

  const wrongHeadHidden = await evalIn('quiz', `(function(){ var f=document.getElementById('wrongLayer').querySelector('iframe'); if(!f||!f.contentWindow) return 'no-iframe'; var h=f.contentWindow.document.querySelector('.result-head'); if(!h) return 'no-head'; return getComputedStyle(h).display; })()`);
  check('错题本结果页内 result-head 已隐藏', wrongHeadHidden === 'none', `得到: ${wrongHeadHidden}`);

  // appbar 退出 → 回取景
  await evalJs(`document.getElementById('appbarExit').click()`);
  await sleep(400);
  const wrongBackTitle = await evalJs(`document.getElementById('appbarTitle').textContent`);
  check('错题本退出结果页 → 标题恢复=错题本', wrongBackTitle === '错题本', `得到: ${wrongBackTitle}`);

  console.log('\n== 4. 错题本卡片结构（三级标题 + 错次右侧 + 无状态/数量）==');
  // 打开错题本子层，渲染列表后检查
  await evalIn('quiz', `closeSubLayer(); 'ok'`);
  await sleep(200);
  await evalIn('quiz', `openSubLayer('wrong'); 'ok'`);
  await sleep(400);
  // 章节题：W01 path='操作系统 → 操作系统概述 → 作用' → 三级标题=作用
  const w1Head = await evalIn('quiz', `(function(){
    var f=document.getElementById('wrongLayer').querySelector('iframe');
    if(!f||!f.contentWindow) return 'no-iframe';
    var card=f.contentWindow.document.querySelector('.swipe-cell[data-qid="W01"] .q-card');
    if(!card) return 'no-card';
    var t=card.querySelector('.q-head-title');
    var tags=card.querySelector('.q-head-tags');
    var meta=card.querySelector('.q-meta');
    var path=card.querySelector('.q-path');
    return JSON.stringify({
      hasTitle: !!t,
      hasErrTag: !!(tags&&tags.querySelector('.q-tag')),
      hasWrongCount: !!(tags&&/错\\s*\\d+\\s*次/.test(tags.textContent)),
      hasStatus: !!(meta&&/待攻克|已攻克|顽固/.test(meta.textContent)),
      hasPath: !!path
    });
  })()`);
  const w1 = JSON.parse(w1Head);
  check('章节题卡片无考点标题(已删)', w1.hasTitle === false, w1Head);
  check('章节题右侧有错误类型标签', w1.hasErrTag === true);
  check('章节题右侧有错N次', w1.hasWrongCount === true);
  check('章节题无待攻克/已攻克状态', w1.hasStatus === false, w1Head);
  check('章节题无 q-path 路径行', w1.hasPath === false);

  // 二级标题带 n道 顽固n个（PM 2026-09-07：错题本列表改 1/2/3 级树，2级带数量）
  const l2Meta = await evalIn('quiz', `(function(){
    var f=document.getElementById('wrongLayer').querySelector('iframe');
    if(!f||!f.contentWindow) return 'no-iframe';
    var l2 = f.contentWindow.document.querySelector('.wt-l2');
    if(!l2) return 'no-l2';
    var m = l2.querySelector('.wt-meta').textContent.trim();
    /* 形如「1 道」「2 道 顽固 1 个」均合法 */
    var ok = /^\\d+\\s*道(\\s*顽固\\s*\\d+\\s*个)?$/.test(m);
    return JSON.stringify({ m: m, ok: ok });
  })()`);
  const l2r = JSON.parse(l2Meta);
  check('二级标题带 n道 顽固n个', l2r.ok, `得到: ${l2r.m}`);

  // 我的上传题 U01：卡片不显示考点标题（PM 2026-09-07 修正）；无拍照/原图/单选标签
  const u1Head = await evalIn('quiz', `(function(){
    var f=document.getElementById('wrongLayer').querySelector('iframe');
    if(!f||!f.contentWindow) return 'no-iframe';
    var card=f.contentWindow.document.querySelector('.swipe-cell[data-qid="U01"] .q-card');
    if(!card) return 'no-card';
    var t=card.querySelector('.q-head-title');
    var tags=card.querySelector('.q-head-tags');
    return JSON.stringify({
      hasTitle: !!t,
      hasPhotoTag: !!(tags&&tags.querySelector('.q-tag.upload')),
      hasTypeTag: !!(tags&&tags.querySelector('.q-tag.type-tag')),
      hasImgTag: !!(tags&&tags.querySelector('.q-tag.img-tag'))
    });
  })()`);
  const u1 = JSON.parse(u1Head);
  check('上传题卡片无考点标题(已删)', u1.hasTitle === false, u1Head);
  check('上传题无📷拍照标签', u1.hasPhotoTag === false, u1Head);
  check('上传题无单选type标签', u1.hasTypeTag === false, u1Head);
  check('上传题无📷原图标签', u1.hasImgTag === false, u1Head);

  // 3级顽固标签只写"顽固"不写n个；3级meta只写"n道"（PM 2026-09-07 修正）
  const l3Stub = await evalIn('quiz', `(function(){
    var f=document.getElementById('wrongLayer').querySelector('iframe');
    if(!f||!f.contentWindow) return 'no-iframe';
    var l3s=[...f.contentWindow.document.querySelectorAll('.wt-l3')];
    if(!l3s.length) return 'no-l3';
    var stubs=l3s.filter(x=>x.classList.contains('stubborn'));
    if(!stubs.length) return 'no-stub';
    var s=stubs[0];
    var stub=s.querySelector('.wt-l3-stub');
    var meta=s.querySelector('.wt-meta');
    return JSON.stringify({
      stubText: stub?stub.textContent:'',
      metaText: meta?meta.textContent:'',
      nextIsCardList: s.nextElementSibling?.className==='wt-card-list'
    });
  })()`);
  const l3s = JSON.parse(l3Stub);
  check('3级顽固标签只写"顽固"(无n个)', l3s.stubText === '顽固', `得到: ${l3s.stubText}`);
  check('3级meta只写n道(无顽固n个)', /^\d+\s*道$/.test(l3s.metaText), `得到: ${l3s.metaText}`);
  check('3级下卡片是兄弟(非竖线包裹)', l3s.nextIsCardList === true, l3Stub);

  console.log('\n== 5. 独立调试兜底：无 appbar 时 result-head 保留 ==');
  // 直接导航到拍照搜题.html（非总壳）→ 无 appbar → result-head 不隐藏
  await send('Page.navigate', { url: `http://localhost:${PORT}/拍照搜题.html` });
  await sleep(800);
  const standaloneNoAppbar = await evalJs(`!document.body.classList.contains('has-appbar')`);
  check('独立打开拍照搜题 → 无 has-appbar 类', standaloneNoAppbar === true);
  const standaloneHeadVisible = await evalJs(`(function(){ var h=document.querySelector('.result-head'); if(!h) return 'no-head'; return getComputedStyle(h).display; })()`);
  check('独立调试 → result-head 保留显示(兜底)', standaloneHeadVisible === 'flex', `得到: ${standaloneHeadVisible}`);

  console.log(`\n== 结果: ${FAILED === 0 ? '全部通过 ✅' : FAILED + ' 项失败 ❌'} ==`);
} catch (e) {
  console.error('测试中断:', e.message);
  FAILED++;
} finally {
  try { server.close(); } catch {}
  chrome.kill();
  process.exit(FAILED === 0 ? 0 : 1);
}
