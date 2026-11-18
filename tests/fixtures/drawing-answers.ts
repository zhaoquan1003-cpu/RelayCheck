const scene = `<svg id="scene" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 380" role="img" aria-label="鹈鹕骑自行车动画">
<rect width="640" height="380" fill="#edf6f8"/><circle cx="545" cy="65" r="28" fill="#f9dd98"/>
<path d="M0 285 Q170 245 320 285 T640 285 V380 H0Z" fill="#d5e7df"/><path d="M0 330H640" stroke="#9cbcb0" stroke-width="3"/>
<g fill="none" stroke="#315a65" stroke-width="5"><circle cx="205" cy="270" r="58"/><circle cx="435" cy="270" r="58"/>
<g id="wheel" class="wheel"><path d="M205 212V328M147 270H263M164 229L246 311M164 311L246 229" stroke-width="2"/></g>
<path d="M205 270L280 185L325 270ZM280 185H390L325 270L435 270L390 160M375 160H410" stroke="#5b9d8d"/>
<path d="M260 180H294" stroke="#315a65"/><circle cx="325" cy="270" r="13"/>
<g id="crank"><path d="M310 270H340"/><path d="M302 270H316M334 270H348" stroke-width="3"/></g></g>
<path d="M266 169Q222 160 232 115Q250 86 292 108L321 125Q332 120 338 94Q335 62 356 59Q386 64 380 95L368 141Q355 185 305 190Z" fill="#fffdfa" stroke="#57716d" stroke-width="3"/>
<path d="M378 79L477 95L378 111Z" fill="#efba5d" stroke="#b28d4d" stroke-width="2"/><path d="M378 90Q430 133 477 95" fill="#f1cb78" stroke="#b28d4d" stroke-width="2"/>
<circle cx="368" cy="77" r="4" fill="#203e46"/><path d="M255 133Q286 112 318 145L381 164" fill="none" stroke="#57716d" stroke-width="5"/>
<path id="leg" d="M295 180L294 229L325 270" fill="none" stroke="#d99e4d" stroke-width="7" stroke-linejoin="round"/>
</svg>`

const style = `<style>html,body{margin:0;background:#f7faf9;color:#24464e;font-family:system-ui,sans-serif}main{padding:22px}h1{margin:0 0 6px;font-size:24px}p{font-size:13px;color:#648187;margin:0 0 18px}svg{display:block;width:100%;height:auto;border-radius:16px}button{border:0;border-radius:20px;padding:10px 18px;background:#315a65;color:white;margin-top:14px}pre{white-space:pre-wrap;font-size:12px}</style>`

export const HTML_ANIMATION = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${style}</head><body><main><h1>沿着海风，慢慢骑。</h1><p>鹈鹕的海岸骑行 · HTML + SVG 动画</p>${scene}<button id="pause" onclick="window.paused = !window.paused">暂停 / 继续</button></main><script>
document.documentElement.dataset.started = String(Date.now());
let tick = 0;
function ride() {
  if (!window.paused) {
    tick += 1;
    document.documentElement.dataset.tick = String(tick);
    document.getElementById('crank').setAttribute('transform', 'rotate(' + tick * 2 + ' 325 270)');
    document.getElementById('wheel').setAttribute('transform', 'rotate(' + tick + ' 205 270)');
  }
  requestAnimationFrame(ride);
}
requestAnimationFrame(ride);
</script></body></html>`

export const HTML_CSS_ANIMATION = `<!doctype html><html><head>${style}<style>@keyframes spin{to{transform:rotate(360deg)}}.wheel{transform-origin:205px 270px;animation:spin 2s linear infinite}</style></head><body><main><h1>海岸小骑行</h1><p>纯 CSS 动画</p>${scene}</main></body></html>`

export const HTML_DYNAMIC_SVG = `<!doctype html><html><head>${style}</head><body><main><h1>脚本生成的画布</h1><div id="canvas"></div></main><script>
const ns = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(ns, 'svg');
svg.id = 'dynamic-scene'; svg.setAttribute('viewBox', '0 0 200 100');
const wheel = document.createElementNS(ns, 'circle');
wheel.setAttribute('cx','60'); wheel.setAttribute('cy','50'); wheel.setAttribute('r','25'); wheel.setAttribute('fill','#315a65');
svg.appendChild(wheel); document.getElementById('canvas').appendChild(svg);
</script></body></html>`

export const HTML_HOSTILE = `<!doctype html><html><head>${style}</head><body><main><h1>隔离边界测试</h1><pre id="security-report">running</pre></main><script>
(async () => {
  const result = {};
  const blocked = (action) => { try { action(); return false; } catch { return true; } };
  result.parentDom = blocked(() => parent.document.body.setAttribute('data-escaped','yes'));
  result.parentStorage = blocked(() => parent.localStorage.getItem('drawing-sentinel'));
  result.ownStorage = blocked(() => localStorage.setItem('drawing-escaped','yes'));
  result.popup = window.open('https://example.com/drawing-popup') === null;
  result.topNavigation = blocked(() => { top.location.href = 'https://example.com/drawing-navigation'; });
  result.api = await fetch('/api/v1/config?drawing-security-probe=1').then(() => false, () => true);
  result.external = await fetch('https://example.com/drawing-security-probe').then(() => false, () => true);
  const img = new Image();
  result.externalImage = await new Promise((resolve) => { img.onerror = () => resolve(true); img.onload = () => resolve(false); img.src = 'https://example.com/drawing-security-image.png'; document.body.appendChild(img); });
  document.getElementById('security-report').textContent = JSON.stringify(result);
})();
</script></body></html>`

export const HTML_TRUNCATED = '<!doctype html><html><head><style>body{color:blue}</style></head><body><svg><circle cx="20" cy="20" r="10"/></svg><script>requestAnimationFrame('

export const DRAWING_ANSWERS: Record<string, string> = {
  'mock-html-animation': `这是动画：\n\n\`\`\`html\n${HTML_ANIMATION}\n\`\`\``,
  'mock-html-css': HTML_CSS_ANIMATION,
  'mock-html-dynamic': HTML_DYNAMIC_SVG,
  'mock-html-hostile': HTML_HOSTILE,
  'mock-html-truncated': HTML_TRUNCATED,
}
