// 通过 WebView2 的 CDP 端口抓主页帧（配合 shot_main.ps1：窗口已在屏幕外无激活显示）。
// 用 viewport override 固定 1000x660 CSS @1.25，输出 1250x825，和历史截图一致。
// 用法：node .tools/shot_cdp.mjs <out.png> [port]
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
const port = process.argv[3] || '9222';
if (!out) { console.log('usage: node shot_cdp.mjs <out.png> [port]'); process.exit(1); }

let list;
try {
  list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
} catch {
  console.log('cdp-unavailable');
  process.exit(2);
}
const page = list.find((t) => t.type === 'page' && !String(t.url).includes('panel.html'));
if (!page) { console.log('no main page'); process.exit(3); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (m, p) => new Promise((res) => {
  const my = ++id;
  const h = (ev) => { const d = JSON.parse(ev.data); if (d.id === my) { ws.removeEventListener('message', h); res(d); } };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id: my, method: m, params: p }));
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable', {});
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 660, deviceScaleFactor: 1.25, mobile: false });
await send('Runtime.evaluate', { expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))', awaitPromise: true });
await new Promise((r) => setTimeout(r, 1200));   // 等缩略图解码/懒加载补画
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
await send('Emulation.clearDeviceMetricsOverride', {});
if (!shot.result?.data) { console.log('capture failed'); process.exit(4); }
const buf = Buffer.from(shot.result.data, 'base64');
writeFileSync(out, buf);
console.log(`saved ${out} ${buf.length} bytes`);
ws.close();
