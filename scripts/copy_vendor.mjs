// 產生 vendor/ 底下的前端函式庫，網頁不再依賴第三方 CDN：
// - vendor/chart.umd.min.js：package.json 釘住版本的 Chart.js
// - vendor/icons.js：只收錄頁面用到的 lucide 圖示，加上一個小型 renderLucideIcons()，取代整包 lucide（約 350 KB）
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const version = pkg => JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;

mkdirSync(join(root, 'vendor'), { recursive: true });
copyFileSync(join(root, 'node_modules/chart.js/dist/chart.umd.js'), join(root, 'vendor/chart.umd.min.js'));
console.log(`vendor/chart.umd.min.js ← chart.js@${version('chart.js')}`);

// 用到的圖示：原始碼裡所有 data-lucide="..."，加上用字串組出來的（主題切換鈕）
const DYNAMIC = ['sun', 'moon'];
const source = ['index.html', 'app.js'].map(f => readFileSync(join(root, f), 'utf8')).join('\n');
const names = new Set([...source.matchAll(/data-lucide="([a-z0-9-]+)"/g)].map(m => m[1]).concat(DYNAMIC));

const { icons } = require(join(root, 'node_modules/lucide/dist/umd/lucide.js'));
const pascal = s => s.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const picked = {};
for (const name of [...names].sort()) {
  const node = icons[pascal(name)];
  if (!node) throw new Error(`lucide@${version('lucide')} 沒有圖示 ${name}`);
  picked[name] = node;
}

const runtime = `/* lucide@${version('lucide')}（ISC License）精簡版，由 scripts/copy_vendor.mjs 產生，請勿手改 */
window.LUCIDE_ICONS = ${JSON.stringify(picked)};
window.renderLucideIcons = function (root) {
  var NS = 'http://www.w3.org/2000/svg';
  var build = function (node) {
    var el = document.createElementNS(NS, node[0]);
    Object.keys(node[1] || {}).forEach(function (k) { el.setAttribute(k, node[1][k]); });
    (node[2] || []).forEach(function (c) { el.appendChild(build(c)); });
    return el;
  };
  (root || document).querySelectorAll('i[data-lucide]').forEach(function (i) {
    var name = i.getAttribute('data-lucide');
    var node = window.LUCIDE_ICONS[name];
    if (!node) return;
    var svg = build(node);
    svg.setAttribute('class', ('lucide lucide-' + name + ' ' + (i.getAttribute('class') || '')).trim());
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    i.replaceWith(svg);
  });
};
`;
writeFileSync(join(root, 'vendor/icons.js'), runtime);
console.log(`vendor/icons.js ← lucide@${version('lucide')}，${Object.keys(picked).length} 個圖示`);
