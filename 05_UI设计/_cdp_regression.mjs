/**
 * CDP 跨 tab 联动 + VIP 流程回归
 * 运行：node _cdp_regression.mjs
 * 前置：Chrome headless 以 --remote-debugging-port 启动（脚本自动）
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9333;

/* ---------- 静态文件服务 ---------- */
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/小程序总壳.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

/* ---------- 启动 Chrome ---------- */
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

/* 在顶层 frame 执行 */
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('顶层异常: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

/* 等待 iframe 就绪，并在该 iframe window 上下文里执行表达式。
   用 contentWindow.eval：表达式内的 document/函数 解析到 iframe 全局。 */
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
  if (r.exceptionDetails) throw new Error(`iframe ${name} 异常: ` + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

/* ---------- 主流程 ---------- */
try {
  console.log('\n== 1. 打开总壳 ==');
  await connect();
  await send('Page.navigate', { url: `http://localhost:${PORT}/小程序总壳.html` });
  await sleep(3500); // 闪屏 2.5s

  // 初始：我的 tab 未登录
  await evalJs(`document.querySelector('.tab-item[data-frame="mine"]').click()`);
  let userName = await evalIn('mine', `document.getElementById('userName').textContent`);
  check('初始未登录', userName === '未登录', `得到: ${userName}`);

  // 首次切到功能 tab（非学习）→ 弹免费权益层
  await evalJs(`document.querySelector('.tab-item[data-frame="flash"]').click()`);
  await sleep(400);
  const benefitShown = await evalJs(`document.getElementById('benefitMask').classList.contains('show')`);
  check('首次切功能tab弹免费权益', benefitShown === true);

  // 点「领取专属权益」→ 卡片缩起(leave) + 遮罩隐藏 + 登录 Bottom Sheet 上浮
  await evalJs(`document.getElementById('benefitCta').click(); 'ok'`);
  await sleep(120);   // 动画 230ms 内，leave 类尚未移除
  const benefitLeave = await evalJs(`(function(){
    const c = document.querySelector('.vip-card') || document.querySelector('.benefit-card');
    return c ? c.classList.contains('leave') : false;
  })()`);
  check('切换缩小动画', benefitLeave === true);
  await sleep(300);
  const benefitHidden = await evalJs(`!document.getElementById('benefitMask').classList.contains('show')`);
  check('点领取后遮罩隐藏', benefitHidden === true);
  const loginSheetShown = await evalJs(`document.getElementById('loginSheet').classList.contains('show')`);
  check('登录Sheet底部弹出', loginSheetShown === true);

  // 未勾选协议 → 提示 + 不登录
  await evalJs(`loginAgree.checked=false; loginButton.click(); 'ok'`);
  await sleep(200);
  const tipShown = await evalJs(`document.getElementById('loginTip').classList.contains('show')`);
  const notLogged = await evalJs(`STATE.logged === false`);
  check('未勾选协议显示提示', tipShown === true);
  check('未勾选协议不登录', notLogged === true);

  // 勾选协议 → 微信一键登录 → VIP 到账 + Sheet 关闭
  await evalJs(`loginAgree.checked=true; loginButton.click(); 'ok'`);
  await sleep(400);
  const vipArrived = await evalJs(`STATE.vipClaimed === true`);
  check('登录后VIP直接到账', vipArrived === true);
  const sheetClosed = await evalJs(`!document.getElementById('loginSheet').classList.contains('show')`);
  check('登录后Sheet关闭', sheetClosed === true);
  const benefitClosed = await evalJs(`benefitClosed === true`);
  check('权益不再弹', benefitClosed === true);

  // 总壳 STATE 更新
  await sleep(200);
  let shellState = await evalJs(`JSON.stringify({logged: STATE.logged, vipClaimed: STATE.vipClaimed})`);
  const st = JSON.parse(shellState);
  check('总壳 STATE 已更新(登录+VIP)', st.logged === true && st.vipClaimed === true, shellState);

  // 我的 tab：已登录 + VIP 副文案
  await evalJs(`document.querySelector('.tab-item[data-frame="mine"]').click()`);
  await sleep(300);
  userName = await evalIn('mine', `document.getElementById('userName').textContent`);
  const vipSub = await evalIn('mine', `document.querySelector('.vip-card .vip-sub').textContent`);
  check('我的页显示已登录', userName === '团团酱', `得到: ${userName}`);
  check('我的页 VIP 副文案更新', vipSub.includes('已生效'), `得到: ${vipSub}`);

  // 学习页不再弹 VIP（已领取），直达画像
  await evalJs(`document.querySelector('.tab-item[data-frame="study"]').click()`);
  await sleep(300);
  await evalIn('study', `openProfile(); 'ok'`);
  await sleep(200);
  const profileShown = await evalIn('study', `document.getElementById('profileMask').classList.contains('show')`);
  check('已领取后不再弹 VIP，直达画像', profileShown === true);

  // 保存画像（先填完表单 → 个人资料完整）→ 我的页「已完善」
  await evalIn('study', `
    document.getElementById('schoolInput').value = '山东大学';
    document.getElementById('majorInput').value = '计算机科学与技术';
    var g = document.querySelector('#gradeGroup .field-chip[data-v="大三"]');
    if (g) { g.classList.add('on'); }
    doSaveProfile(); 'ok'
  `);
  await sleep(400);
  await evalJs(`document.querySelector('.tab-item[data-frame="mine"]').click()`);
  await sleep(300);
  const profileTag = await evalIn('mine', `document.getElementById('profileTag').textContent`);
  check('我的页画像已完善(三态done)', profileTag === '已完善', `得到: ${profileTag}`);

  // 我的页点「完善资料」→ 转发总壳 → 学习页直达画像（登录态下不再弹 VIP）
  await evalIn('mine', `document.querySelector('.list-row[onclick="navProfile()"]').click(); 'ok'`);
  await sleep(500);
  const profileFromMine = await evalIn('study', `document.getElementById('profileMask').classList.contains('show')`);
  check('我的页完善资料转发 → 学习页弹画像', profileFromMine === true);

  console.log('\n== 2. 逻辑面板 ↔ 闪卡 iframe 联动 ==');
  // 切闪卡 tab（懒加载首次加载）
  await evalJs(`document.querySelector('.tab-item[data-frame="flash"]').click()`);
  await sleep(1200);
  // 面板初始高亮「首页」
  const chipHome = await evalJs(`document.querySelector('#viewSwitch .view-chip.active').textContent`);
  check('面板初始高亮「首页」', chipHome === '首页', `得到: ${chipHome}`);

  // 点面板「单卡模式」chip → REQUEST_NAV → 闪卡 iframe nav
  await evalJs(`[...document.querySelectorAll('#viewSwitch .view-chip')].find(c => c.textContent === '单卡模式').click(); 'ok'`);
  await sleep(500);
  const activeViewInFlash = await evalIn('flash', `document.querySelector('.view.active') ? document.querySelector('.view.active').id : 'none'`);
  const chipActive = await evalJs(`document.querySelector('#viewSwitch .view-chip.active').textContent`);
  check('面板点「单卡模式」→ 闪卡跳单卡视图', activeViewInFlash === 'view-single', `得到: ${activeViewInFlash}`);
  check('面板高亮同步「单卡模式」', chipActive === '单卡模式', `得到: ${chipActive}`);

  // 闪卡内置 nav → 发 NAV → 面板跟随（切成列表视图测试反向链路）
  await evalIn('flash', `nav('view-list'); 'ok'`);
  await sleep(400);
  const chipFromFlash = await evalJs(`document.querySelector('#viewSwitch .view-chip.active').textContent`);
  check('闪卡 nav 列表 → 面板高亮跟随', chipFromFlash === '列表模式', `得到: ${chipFromFlash}`);

  // 点面板「完成结算页」chip → 闪卡跳 view-complete
  await evalJs(`[...document.querySelectorAll('#viewSwitch .view-chip')].find(c => c.textContent === '完成结算页').click(); 'ok'`);
  await sleep(500);
  const flashComplete = await evalIn('flash', `document.querySelector('.view.active') ? document.querySelector('.view.active').id : 'none'`);
  check('面板点「完成结算页」→ 闪卡跳完成页', flashComplete === 'view-complete', `得到: ${flashComplete}`);

  console.log('\n== 3. 固定顶栏 + 遮罩清除 + 退出复位 ==');

  // 当前在闪卡 tab（自带顶部栏）→ 总壳 appbar 应收起，避免双条
  const appbarHiddenFlash = await evalJs(`document.getElementById('appbar').classList.contains('hidden')`);
  check('闪卡 tab 总壳顶栏收起(闪卡自带)', appbarHiddenFlash === true);

  // 切到题库 → appbar 显示「题库」，且固定在状态栏之下（相对 phone-screen 偏离 34）
  await evalJs(`document.querySelector('.tab-item[data-frame="quiz"]').click()`);
  await sleep(400);
  const appbarQuiz = await evalJs(`(function(){
    var s = document.querySelector('.phone-screen').getBoundingClientRect();
    var a = document.getElementById('appbar').getBoundingClientRect();
    var c = document.querySelector('.content-frame').getBoundingClientRect();
    return JSON.stringify({
      hidden: document.getElementById('appbar').classList.contains('hidden'),
      title: document.getElementById('appbarTitle').textContent,
      appbarRel: Math.round(a.top - s.top),
      contentRel: Math.round(c.top - s.top)
    });
  })()`);
  const q3 = JSON.parse(appbarQuiz);
  check('题库 tab 顶栏显示且标题=题库', q3.hidden === false && q3.title === '题库', appbarQuiz);
  check('顶栏固定于状态栏下方(appbarRel=34)', q3.appbarRel === 34, appbarQuiz);
  check('内容区从顶栏之下开始(contentRel=34)', q3.contentRel === 34, appbarQuiz);

  // VIP 领取层默认隐藏且不可交互（不再遮罩内容）
  const vl3 = await evalJs(`(function(){ var v=document.getElementById('vipLayer'); var cs=getComputedStyle(v); return JSON.stringify({ vis: cs.visibility, op: cs.opacity, pe: cs.pointerEvents }); })()`);
  const vv3 = JSON.parse(vl3);
  check('VIP领取层默认隐藏且不可交互', vv3.vis === 'hidden' && vv3.op === '0' && vv3.pe === 'none', vl3);

  // 退出按钮：清登录态回学习 tab（退出保留画像草稿，PM 决策）
  await evalJs(`document.getElementById('appbarExit').click()`);
  await sleep(400);
  const afterExit = await evalJs(`(function(){
    var tab = document.querySelector('.tab-item.active');
    return JSON.stringify({
      logged: STATE.logged, vip: STATE.vipClaimed,
      profileLevel: STATE.profileLevel,
      tab: tab ? tab.dataset.frame : '?',
      title: document.getElementById('appbarTitle').textContent
    });
  })()`);
  const ex3 = JSON.parse(afterExit);
  check('退出后登录态复位(logged/vip=false)', ex3.logged === false && ex3.vip === false, afterExit);
  check('退出后回学习 tab 且顶栏标题=学习', ex3.tab === 'study' && ex3.title === '学习', afterExit);

  console.log('\n== 4. 登录成功轻量提示（Toast）==');

  // 重新加载页面，重置会话状态，走一遍完整登录链路
  await send('Page.navigate', { url: `http://localhost:${PORT}/小程序总壳.html` });
  await sleep(3500);

  // 首切功能 tab → 弹权益 → 领取 → 登录 sheet
  await evalJs(`document.querySelector('.tab-item[data-frame="quiz"]').click()`);
  await sleep(300);
  await evalJs(`document.getElementById('benefitCta').click()`);
  await sleep(260);
  await evalJs(`loginAgree.checked=true`);

  // 触发登录成功
  await evalJs(`loginButton.click()`);
  await sleep(120);  // 等 .show 加上（requestAnimationFrame 后）

  // Toast 出现：.show + opacity=1 + 文案 + 位置
  const toastOn = await evalJs(`(function(){
    var t = document.getElementById('successToast');
    var cs = getComputedStyle(t);
    var box = t.getBoundingClientRect();
    var screen = document.querySelector('.phone-screen').getBoundingClientRect();
    return JSON.stringify({
      show: t.classList.contains('show'),
      op: cs.opacity,
      text: t.textContent.trim(),
      boxW: Math.round(box.width),
      boxH: Math.round(box.height),
      bottomGap: Math.round(screen.bottom - box.bottom),  // 距手机底部距离
      whiteBg: cs.backgroundColor,
      radius: cs.borderRadius
    });
  })()`);
  const t4 = JSON.parse(toastOn);
  check('Toast 出现(show且opacity>0)', t4.show === true && Number(t4.op) > 0, toastOn);
  check('Toast 文案正确', t4.text.includes('登录成功') && t4.text.includes('VIP权益已到账'), t4.text);
  check('Toast 紧凑(宽min260/高46-52)', t4.boxW >= 260 && t4.boxW <= 290 && t4.boxH >= 46 && t4.boxH <= 52, `W=${t4.boxW} H=${t4.boxH}`);
  check('Toast 半透明白底+圆角14-16', /rgba\(255, 255, 255/.test(t4.whiteBg) && ['14px','15px','16px'].includes(t4.radius), toastOn);
  check('Toast 位于页中下部且不贴底', t4.bottomGap >= 70 && t4.bottomGap <= 130, `bottomGap=${t4.bottomGap}`);

  // 停留 1.5s + 消失 0.2s 过渡，等完全结束
  await sleep(1700);
  const tAfter = await evalJs(`(function(){
    var t = document.getElementById('successToast');
    var cs = getComputedStyle(t);
    return JSON.stringify({ show: t.classList.contains('show'), hiding: t.classList.contains('hiding'), op: cs.opacity, pe: cs.pointerEvents, logged: STATE.logged });
  })()`);
  const ta4 = JSON.parse(tAfter);
  check('Toast 停留后完全隐藏(无show/无交互)', ta4.show === false && ta4.hiding === false && Number(ta4.op) === 0 && ta4.pe === 'none', tAfter);
  check('Toast 消失后登录态保持(继续原功能)', ta4.logged === true, tAfter);

  console.log('\n== 5. 新规则：①已登录也弹权益/直接到账 + ②④未登录填画像草稿 ==');

  // 重置会话
  await send('Page.navigate', { url: `http://localhost:${PORT}/小程序总壳.html` });
  await sleep(2000);

  // 场景 A：未登录填画像（规则②④ + C）→ 未登录 openProfile 可进（不再强制登录）
  await evalJs(`switchTab('study')`);  // 学习页，不触发权益
  await sleep(200);
  await evalIn('study', `openProfile(); 'ok'`);
  await sleep(200);
  const profileOpenedNoLogin = await evalIn('study', `document.getElementById('profileMask').classList.contains('show')`);
  check('未登录可打开画像(规则②④)', profileOpenedNoLogin === true);

  // 填画像（部分：只填学校）→ 保存 → 不登录，引流
  await evalIn('study', `
    document.getElementById('schoolInput').value = '青岛科技大学';
    document.getElementById('majorInput').value = '';
    document.querySelector('#gradeGroup .field-chip[data-v="大二"]').classList.add('on');
    doSaveProfile(); 'ok'
  `);
  await sleep(400);

  // 未登录填完 → 草稿已上报总壳 -> profileLevel 应非 none
  const draftLevel = await evalJs(`STATE.profileLevel`);
  check('未登录保存画像后 profileLevel 非none', draftLevel === 'partial' || draftLevel === 'done', `level=${draftLevel}`);

  // 引导登录 → 用户拒绝（点×关闭登录sheet）→ 草稿保留
  const reqLoginShown = await evalJs(`document.getElementById('loginSheet').classList.contains('show')`);
  check('保存画像后引导登录(弹Sheet)', reqLoginShown === true);
  await evalJs(`document.getElementById('loginClose').click()`);  // 拒绝登录
  await sleep(200);
  const draftAfterReject = await evalJs(`STATE.profileLevel`);
  check('拒绝登录后草稿保留(profileLevel不变)', draftAfterReject === draftLevel, `after=${draftAfterReject}`);

  // 场景 B：已登录未领 → 切功能tab仍弹权益(规则①)
  // 先登录（走系统登录，不领权益）
  await evalJs(`switchTab('quiz')`);      // 会触发权益（未登录未领）
  await sleep(300);
  await evalJs(`document.getElementById('benefitCta').click()`);  // 领取→弹登录
  await sleep(260);
  await evalJs(`loginAgree.checked=true; loginButton.click()`);  // 登录（benefitUsing→到账）
  await sleep(300);
  const loggedState = await evalJs(`JSON.stringify({ logged: STATE.logged, vip: STATE.vipClaimed })`);
  check('已登录且已领取(登录链路)', JSON.parse(loggedState).logged === true && JSON.parse(loggedState).vip === true, loggedState);

  // 关键：已登录+已领 → 再切tab 不再弹权益（benefitShown/Claimed 已置）
  await evalJs(`switchTab('flash')`);
  await sleep(300);
  const benefitAfterClaim = await evalJs(`document.getElementById('benefitMask').classList.contains('show')`);
  check('已领取后切tab不再弹权益', benefitAfterClaim === false);

  // 新建一个"已登录未领"会话：退出（保留草稿）→ 再登录（不领权益）→ 切功能tab 应弹权益
  await evalJs(`document.getElementById('appbarExit').click()`);  // 退出→清登录态但保留草稿
  await sleep(300);
  const afterExit2 = await evalJs(`JSON.stringify({ logged: STATE.logged, level: STATE.profileLevel })`);
  check('退出保留草稿+清登录态', JSON.parse(afterExit2).logged === false && ['partial','done'].includes(JSON.parse(afterExit2).level), afterExit2);

  // 重新登录但不领权益：切学习页 → 发 REQ_LOGIN → 总壳弹Sheet → 登录
  await evalJs(`switchTab('study')`);
  await sleep(200);
  await evalJs(`(function(){ window.parent.postMessage; })()`);  // no-op
  // 我的页发 REQ_LOGIN（或直接调总壳 openLoginSheet）
  await evalJs(`openLoginSheet(); 'ok'`);
  await sleep(200);
  await evalJs(`loginAgree.checked=true; loginButton.click()`);
  await sleep(300);
  const relogged = await evalJs(`JSON.stringify({ logged: STATE.logged, vip: STATE.vipClaimed })`);
  check('重新登录未领VIP(登录不上VIP)', JSON.parse(relogged).logged === true && JSON.parse(relogged).vip === false, relogged);

  // 已登录未领 → 切功能tab应弹权益(规则①)
  await evalJs(`switchTab('quiz')`);
  await sleep(300);
  const benefitLoggedUnclaimed = await evalJs(`(function(){
    return JSON.stringify({
      shown: document.getElementById('benefitMask').classList.contains('show'),
      vip: STATE.vipClaimed,
      benefitShown: benefitShown,
      benefitClosed: benefitClosed
    });
  })()`);
  const blu4 = JSON.parse(benefitLoggedUnclaimed);
  check('已登录未领→弹权益(规则①)', blu4.shown === true, benefitLoggedUnclaimed);

  // 已登录点领取 → 直跳到账 + toast「领取成功」(不弹登录)
  await evalJs(`document.getElementById('benefitCta').click()`);
  await sleep(400);
  const directClaim = await evalJs(`(function(){
    return JSON.stringify({
      vip: STATE.vipClaimed,
      sheetShown: document.getElementById('loginSheet').classList.contains('show'),
      toastText: document.querySelector('.vip-success-text').textContent
    });
  })()`);
  const dc4 = JSON.parse(directClaim);
  check('已登录领取→直接到账(不弹登录)', dc4.vip === true && dc4.sheetShown === false, directClaim);
  check('已登录领取→toast「领取成功」', dc4.toastText.includes('领取成功') && dc4.toastText.includes('VIP权益已到账'), dc4.toastText);

  console.log(`\n== 结果: ${FAILED === 0 ? '全部通过 ✅' : FAILED + ' 项失败 ❌'} ==`);
} catch (e) {
  console.error('测试中断:', e.message);
  FAILED++;
} finally {
  try { server.close(); } catch {}
  chrome.kill();
  process.exit(FAILED === 0 ? 0 : 1);
}