/**
 * OpenModel Selector - Application Logic
 */

// Application State
const state = {
  activeTab: 'wizard', // 'wizard' | 'canirun' | 'leaderboard' | 'bench' | 'storage' | 'radar' | 'day16'

  // Wizard State
  wizard: {
    step: 1,
    answers: {
      workload: 'agent', // 'prefill' | 'decode' | 'agent'
      tcLang: 'yes',     // 'yes' | 'no'
      coexist: 'coexist',// 'dedicated' | 'coexist'
      license: 'commercial', // 'commercial' | 'any'
      ecosystem: 'production' // 'production' | 'experimental'
    }
  },

  // CanIRun State（硬體選擇全站共用）
  canirun: {
    selectedHardwareId: 'mac-128',
    contextLength: 16384, // 16k tokens
    reserveCoexistGB: 16, // reserve for ComfyUI/OS
    searchQuery: '',
    filterArchitecture: 'all', // 'all' | 'Dense' | 'MoE'
    detectedGpu: null
  },

  // Leaderboard State
  leaderboard: {
    searchQuery: '',
    filterArch: 'all',
    filterLicense: 'all',
    filterDay16Only: false,
    sortBy: 'arenaCodeElo', // 由高到低
    selectedCompareIds: ['qwen25-coder-32b', 'ornith-35b-a3b', 'gpt-oss-120b']
  },

  // GB10 實測分頁
  bench: {
    platform: 'all' // 'all' | 'dual-gb10' | 'nvidia-gb10'
  },

  // Storage Advisor State（系統記憶體跟著選定的硬體走）
  storage: {
    selectedModelId: 'qwen25-coder-32b',
    selectedQuant: 'Q8_0',
    loaderType: 'gguf-mmap' // 'gguf-mmap' | 'vllm'
  },

  // Radar State
  radar: {
    selectedModelIds: ['ornith-35b-a3b', 'qwen38-27b-dense', 'deepseek-v4-flash', 'muse-glimmer-30b'],
    chartInstance: null
  }
};

// CUDA / Metal 與框架執行期的基本餘裕
const RUNTIME_HEADROOM_GB = 2.0;
// GB10 上各引擎實測達到頻寬理論上限的比例（Day 11：vLLM 45.2%、llama-server 73.2%）
const ENGINE_EFFICIENCY_RANGE = [0.45, 0.73];

// Utilities
function formatNumber(num) {
  return new Intl.NumberFormat('zh-TW').format(num);
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getHardware(id) {
  return window.HARDWARE_PROFILES.find(h => h.id === id) || window.HARDWARE_PROFILES[0];
}

function getModel(id) {
  return window.MODELS_DATABASE.find(m => m.id === id);
}

// 沒有公開來源的數值在 data.js 裡是 null，顯示時一律寫「無資料」
function isKnown(v) {
  return v !== null && v !== undefined && !(typeof v === 'number' && isNaN(v));
}

function fmtContext(tokens) {
  if (!isKnown(tokens)) return '無資料';
  return tokens >= 1000000 ? `${+(tokens / 1048576).toFixed(1)}M` : `${(tokens / 1024).toFixed(0)}k`;
}

function fmt(v, suffix = '') {
  return isKnown(v) ? `${v}${suffix}` : '<span class="text-slate-500 font-normal">無資料</span>';
}

// 「啟用 / 總量」參數字串；任一未知時顯示無資料
function fmtParams(m, sep = ' / ') {
  if (!isKnown(m.paramsTotal)) return fmt(null);
  if (!isKnown(m.paramsActive) || m.paramsActive === m.paramsTotal) return `${m.paramsTotal}B`;
  return `${m.paramsActive}B${sep}${m.paramsTotal}B`;
}

function kvCacheGB(m, contextTokens) {
  return isKnown(m.kvPerTokKB) ? (m.kvPerTokKB * contextTokens) / (1024 * 1024) : null;
}

// 排序用：缺值以全體已知值的中位數代入，不加分也不扣分
const _medianCache = {};
function fieldMedian(field) {
  if (field in _medianCache) return _medianCache[field];
  const vals = window.MODELS_DATABASE.map(m => m[field]).filter(isKnown).sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  _medianCache[field] = vals.length === 0 ? 0 : (vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2);
  return _medianCache[field];
}

function scoreValue(m, field) {
  return isKnown(m[field]) ? m[field] : fieldMedian(field);
}

// 依體積由小到大排的量化檔位（體積未知的排最後）
function quantKeysBySize(m) {
  return Object.keys(m.quantProfiles).sort((a, b) => {
    const sa = m.quantProfiles[a].sizeGB, sb = m.quantProfiles[b].sizeGB;
    return (isKnown(sa) ? sa : Infinity) - (isKnown(sb) ? sb : Infinity);
  });
}

// 最小的量化檔體積（有些模型只有 EXL3 或 Q2 之類的檔）
function minQuantSizeGB(m) {
  const sizes = Object.values(m.quantProfiles).map(q => q.sizeGB).filter(isKnown);
  return sizes.length ? Math.min(...sizes) : Infinity;
}

// 依繁中需求挑量化檔：只在放得下的檔位裡挑，繁中優先 8-bit，否則 4-bit；都沒有就取放得下的最大檔
function pickQuantKey(m, tcLang, fits = () => true) {
  const keys = Object.keys(m.quantProfiles).filter(fits);
  const pool = keys.length ? keys : [quantKeysBySize(m)[0]];
  const prefs = tcLang === 'yes' ? ['Q8_0', 'FP8', 'Q6_K', 'Q4_K_M'] : ['Q4_K_M', 'MXFP4', 'NVFP4', 'Q8_0'];
  const sorted = quantKeysBySize(m).filter(k => pool.includes(k));
  return prefs.find(k => pool.includes(k)) || sorted[sorted.length - 1];
}

// 量化檔需要的總記憶體：權重 + KV(ctx) + 執行期
function requiredGB(m, quantKey, contextTokens) {
  const q = m.quantProfiles[quantKey];
  if (!q || !isKnown(q.sizeGB)) return Infinity;
  return q.sizeGB + (kvCacheGB(m, contextTokens) || 0) + RUNTIME_HEADROOM_GB;
}

// class 必須寫成完整字串，預建的 Tailwind 才掃得到
const BADGE_TONES = {
  amber: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  emerald: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  indigo: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  cyan: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
};

function badge(text, tone = 'amber') {
  return `<span class="inline-block align-middle whitespace-nowrap shrink-0 text-[11px] px-2 py-0.5 rounded-full border font-normal ${BADGE_TONES[tone]}">${text}</span>`;
}

// 沒考過繁中 Agent 考卷的模型，在推薦卡片上明確標示
function examBadge(m) {
  if (m.jsonRecheckPending) return badge('考卷待重測');
  if (!isKnown(m.jsonDisciplineScore)) return badge(isKnown(m.examScore) ? 'JSON 紀律未測' : '未經考卷驗證');
  return '';
}

function sourcesHtml(m) {
  const src = m.sources || {};
  const items = [
    ['Arena', src.arena],
    ['規格', src.specs],
    ['基準', src.benchmarks],
    ['量化檔', src.quant],
    ['作者實測', src.local],
    ['第三方實測', src.localThirdParty]
  ].filter(([, v]) => v);
  if (!items.length) return '<span class="text-slate-500">無來源紀錄</span>';
  return items.map(([k, v]) => {
    const html = String(v).split('；').map(part => /^https?:\/\//.test(part)
      ? `<a href="${escapeHtml(part.split('（')[0])}" target="_blank" rel="noopener" class="text-emerald-400 hover:underline break-all">${escapeHtml(part)}</a>`
      : escapeHtml(part)).join('；');
    return `<span class="block"><span class="text-slate-400">${k}：</span>${html}</span>`;
  }).join('');
}

// 共用的硬體下拉選單
const HARDWARE_GROUPS = [
  ['superchip', 'AI 超級晶片 / 工作站 (Grace Blackwell & Grace Hopper)'],
  ['apple', 'Apple Silicon (統一記憶體)'],
  ['nvidia', 'NVIDIA 獨立顯卡 (VRAM)'],
  ['amd|intel', 'AMD & Intel 獨立顯卡'],
  ['enterprise', '企業級加速卡 / 專業卡'],
  ['cpu', '純 CPU + 系統記憶體']
];

function hardwareSelectHtml(selectedId, onchange, extra = '') {
  return `
    <select ${extra} onchange="${onchange}(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-medium text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none">
      ${HARDWARE_GROUPS.map(([types, label]) => `
        <optgroup label="${label}">
          ${window.HARDWARE_PROFILES.filter(h => types.split('|').includes(h.type)).map(h => `
            <option value="${h.id}" ${h.id === selectedId ? 'selected' : ''}>${h.name}</option>
          `).join('')}
        </optgroup>
      `).join('')}
    </select>`;
}

// 作者實測紀錄：可依模型、平台、量化檔位篩選
function benchmarksFor(modelId, platform, quantKey) {
  return (window.LOCAL_BENCHMARKS || []).filter(b =>
    b.modelId === modelId &&
    (!platform || b.platform === platform) &&
    (quantKey === undefined || b.quantKey === quantKey));
}

// decode 的頻寬理論上限：每生成一個 token 要把啟用參數的權重讀一次
function decodeCeiling(m, quantKey, hw) {
  const q = m.quantProfiles[quantKey];
  if (!q || !isKnown(q.bpw) || !isKnown(m.paramsActive) || !isKnown(hw.memBandwidthGBs)) return null;
  const gbPerToken = m.paramsActive * q.bpw / 8;
  return gbPerToken > 0 ? hw.memBandwidthGBs / gbPerToken : null;
}

// 所有 render 結束後統一把 <i data-lucide> 換成 SVG
function renderIcons(root) {
  if (window.renderLucideIcons) window.renderLucideIcons(root);
}

// ----------------------------------------------------
// WebGPU / WebGL Hardware Auto Detection
// ----------------------------------------------------
// WebGPU 的 adapter info 只有廠牌與架構代號，沒有型號，所以型號一律從 WebGL 的 UNMASKED_RENDERER 取
function readGpuStrings() {
  const info = { renderer: '', vendor: '' };
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      info.renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
      info.vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '';
    }
  } catch (e) {
    console.warn('WebGL detection error:', e);
  }
  return info;
}

async function readWebGpuStrings() {
  try {
    if (!navigator.gpu) return '';
    const adapter = await navigator.gpu.requestAdapter();
    const ai = adapter && (adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null));
    return ai ? `${ai.vendor || ''} ${ai.architecture || ''} ${ai.device || ''} ${ai.description || ''}`.trim() : '';
  } catch (e) {
    console.warn('WebGPU detection error:', e);
    return '';
  }
}

// 依字串比對硬體設定檔；比對不到回傳 null，不覆寫使用者原本的選擇
function matchHardware(text) {
  const r = text.toLowerCase();
  const rules = [
    [['gb200'], 'nvidia-gb200'],
    [['gb10', 'grace blackwell', 'dgx spark'], 'nvidia-gb10'],
    [['gh200', 'grace hopper'], 'nvidia-gh200'],
    [['5090'], 'rtx-5090-32'],
    [['5080'], 'rtx-5080-16'],
    [['5070'], 'rtx-5070-12'],
    [['5060 ti', '5060ti'], 'rtx-5060ti-16'],
    [['4090', '3090'], 'rtx-4090-24'],
    [['4080'], 'rtx-4080-16'],
    [['4070 ti', '4070ti'], 'rtx-4070tis-16'],
    [['4070'], 'rtx-4070-12'],
    [['4060 ti', '4060ti'], 'rtx-4060ti-16'],
    [['4060'], 'rtx-4060-8'],
    [['3060'], 'rtx-3060-12'],
    [['7900 xtx', '7900xtx'], 'amd-rx7900xtx'],
    [['7900'], 'amd-rx7900xt'],
    [['7800'], 'amd-rx7800xt'],
    [['9070'], 'amd-rx9070xt'],
    [['b580'], 'intel-arc-b580'],
    [['a770', 'arc'], 'intel-arc-a770'],
    [['h100'], 'nvidia-h100-80'],
    [['a100'], 'nvidia-a100-80']
  ];
  for (const [keys, id] of rules) {
    if (keys.some(k => r.includes(k)) && window.HARDWARE_PROFILES.some(h => h.id === id)) return id;
  }
  // Apple 晶片的瀏覽器字串不含記憶體大小，只能先對到最常見的 16GB，交由使用者再調
  if (/apple|\bm[1-6]\b/.test(r)) return 'mac-16';
  return null;
}

async function detectLocalHardware() {
  document.querySelectorAll('.detect-hardware-btn').forEach(btn => {
    btn.disabled = true;
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-circle" class="w-4 h-4 animate-spin inline mr-1"></i> 偵測中...';
  });
  renderIcons();

  const gl = readGpuStrings();
  const webgpu = await readWebGpuStrings();
  const renderer = gl.renderer || webgpu || '未知 GPU';
  const matchedId = matchHardware(`${gl.renderer} ${gl.vendor} ${webgpu}`);

  state.canirun.detectedGpu = { renderer, vendor: gl.vendor, matchedId };
  if (matchedId) {
    state.canirun.selectedHardwareId = matchedId;
    showToast(`已偵測硬體：${renderer}（自動適配為 ${getHardware(matchedId).name}）`);
  } else {
    showToast(`偵測到 ${renderer}，但對不到預設硬體，請手動選擇`);
  }
  render();
}

let _toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('app-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
  }, 4000);
}

// ----------------------------------------------------
// 5-Step Selection Wizard Engine (Day 16 Methodology)
// ----------------------------------------------------

// 每一步：符合 drop 條件的模型移到淘汰清單，其餘留下
function partition(models, step, drop, reason, discarded) {
  return models.filter(m => {
    if (!drop(m)) return true;
    discarded.push({ model: m, step, reason: reason(m) });
    return false;
  });
}

// 依 Day 16 經驗權重算出的排序分數（Agent 模式另外先比「是否考過考卷」）
function wizardScore(m, ans, hw) {
  let score = 0;
  const prefill = isKnown(m.speedPrefillScore) ? m.speedPrefillScore : fieldMedian('speedPrefillScore');

  // 1. Workload Alignment (Day 16 Question 1)
  if (ans.workload === 'prefill') {
    // Prefill：密集 27B/32B/70B 大幅加分（prefill 比 decode 快 200 倍）
    score += prefill * 3.5;
    if (m.architecture === 'Dense') score += 120;
  } else if (ans.workload === 'decode') {
    // Decode：啟用參數越小越快
    score += m.workloadFit.decode * 60;
    if (isKnown(m.paramsActive)) score += (100 / Math.max(1, m.paramsActive)) * 12;
    if (m.architecture === 'MoE') score += 150;
  } else if (ans.workload === 'agent') {
    // Agent：JSON 紀律 + 低 KV 成本 + MoE decode；未受測者同組比較，紀律分一律不計
    score += (isKnown(m.jsonDisciplineScore) ? m.jsonDisciplineScore : 0) * 3.0;
    // KV 越低越好（例：Ornith 20 KB 對 Qwen3.8-27B 64 KB）；未知不加分
    if (isKnown(m.kvPerTokKB)) score += Math.max(0, (40 - m.kvPerTokKB)) * 10;
    score += m.workloadFit.agent * 45;
    if (m.architecture === 'MoE') score += 100;
  }

  // 2. Hardware Memory Sizing Fit (Day 16 Question 3)
  // 128GB 獨佔：Ornith BF16（峰值 120.7 GB）是教科書範例；共存：Ornith Q8（38 GB）或 gpt-oss MXFP4（63 GB）
  if (hw.vramGB >= 120 && ans.coexist === 'dedicated') {
    if (m.id === 'ornith-35b-a3b') score += 200;
  } else if (hw.vramGB >= 120 && ans.coexist === 'coexist') {
    if (m.id === 'ornith-35b-a3b' || m.id === 'gpt-oss-120b') score += 120;
  }

  // 3. License Score (Day 16 Question 4: MIT > Apache > Community)
  if (m.license === 'MIT') score += 60;
  if (m.license === 'Apache 2.0') score += 45;

  // 4. Traditional Chinese Grade (Day 16 Question 2)
  if (ans.tcLang === 'yes') {
    const tcWeights = { 'S': 80, 'S-': 70, 'A': 60, 'A-': 55, 'B+': 30, 'B': 10 };
    score += (tcWeights[m.tcGrade] || 0);
  }

  // 5. Day 16 empirical featured bonus
  if (m.isDay16Featured) score += 80;

  // 6. Arena Elo：權重 0.2，讓 1300~1550 的全距影響維持在 50 分左右，不壓過 Day 16 規則
  score += (scoreValue(m, 'arenaCodeElo') - 1400) * 0.2;
  return score;
}

// 問題三的記憶體上限：共存時扣掉保留餘裕
function wizardMemoryBudgetGB(hw, ans) {
  return ans.coexist === 'coexist' ? hw.vramGB - state.canirun.reserveCoexistGB : hw.vramGB;
}

function evaluateWizard() {
  const ans = state.wizard.answers;
  const discarded = [];
  let remaining = [...window.MODELS_DATABASE];

  // Step 1: Workload Shape Filter
  if (ans.workload === 'prefill') {
    remaining = partition(remaining, 1, m => m.workloadFit.prefill < 4.0,
      m => `長輸入短輸出 (Prefill 導向)：${m.name} 為 MoE/非密集架構，Prefill 吞吐效率低於 27B/32B 密集模型。`, discarded);
  } else if (ans.workload === 'decode') {
    remaining = partition(remaining, 1, m => m.workloadFit.decode < 3.8 && m.architecture === 'Dense' && isKnown(m.paramsTotal) && m.paramsTotal > 20,
      m => `短輸入長輸出 (Decode 導向)：${m.name} 為 ${m.paramsTotal}B 密集模型，受頻寬天花板限制，解碼速度慢 (如 8-bit 僅 ~8 t/s)。應選啟用參數量小的 MoE。`, discarded);
  } else if (ans.workload === 'agent') {
    remaining = partition(remaining, 1, m => isKnown(m.jsonDisciplineScore) && m.jsonDisciplineScore < 80 && !m.jsonRecheckPending,
      m => `Agent 迴圈：${m.name} 的 JSON 格式遵循紀律評分僅 ${m.jsonDisciplineScore}/100，易在多輪 tool calling 產生格式廢話導致報錯。`, discarded);
  }

  // Step 2: Traditional Chinese Filter
  if (ans.tcLang === 'yes') {
    remaining = partition(remaining, 2, m => m.tcGrade === 'B-' || m.tcGrade === 'C',
      m => `繁體中文語感：${m.name} 繁中評級為 ${m.tcGrade}，量化後有明顯 1.6~2x 語義折損，未達繁中生產標準。`, discarded);
  }

  // Step 3: Memory & Coexistence Filter：最小量化檔 + KV(ctx) + 執行期 要放得進預算
  const hw = getHardware(state.canirun.selectedHardwareId);
  const budgetGB = wizardMemoryBudgetGB(hw, ans);
  const ctx = state.canirun.contextLength;
  const minNeed = m => requiredGB(m, quantKeysBySize(m)[0], ctx);
  remaining = partition(remaining, 3, m => minNeed(m) > budgetGB,
    m => `記憶體超限：${m.name} 最小量化檔加 ${fmtContext(ctx)} 上下文的 KV 與執行期，需要約 ${minNeed(m) === Infinity ? '（無資料）' : minNeed(m).toFixed(1)} GB，${ans.coexist === 'coexist' ? `共存模式下 ${hw.name} 只給 ${budgetGB} GB` : `${hw.name} 只有 ${hw.vramGB} GB`}。`, discarded);

  // Step 4: License Filter
  if (ans.license === 'commercial') {
    remaining = partition(remaining, 4, m => !m.commercialAllowed,
      m => `商用授權限制：${m.name} 授權條款 (${m.license}) 限制商業使用或需額外申請，無法直接作為商業交付物。`, discarded);
  }

  // Step 5: Ecosystem & Production Readiness
  if (ans.ecosystem === 'production') {
    remaining = partition(remaining, 5, m => m.engineSupport.includes('Experimental'),
      m => `生態尚未合併：${m.name} 推理引擎支援仍在 PR 或社群配方階段，Day 16 鐵律「實驗品不進生產」。`, discarded);
  }

  // 先算好分數再排序，避免比較函式裡反覆重算
  const scored = remaining.map(m => ({ m, tested: isKnown(m.jsonDisciplineScore), score: wizardScore(m, ans, hw) }));
  scored.sort((a, b) => {
    // Agent 模式：考過繁中 Agent 考卷的模型排在沒考過的前面，避免「沒受測」反而比「受測後分數普通」佔便宜
    if (ans.workload === 'agent' && a.tested !== b.tested) return a.tested ? -1 : 1;
    return b.score - a.score;
  });

  return { remaining: scored.map(x => x.m), discarded, budgetGB };
}

// ----------------------------------------------------
// CanIRun VRAM & Speed Calculation Formula
// ----------------------------------------------------
const FIT_STATUS = {
  smooth: { text: '完美暢跑', badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' },
  playable: { text: '良好運行', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  tight: { text: '部分卸載 CPU', badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  oom: { text: '無法運行', badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
  unknown: { text: '無資料', badge: 'bg-slate-800 text-slate-400 border-slate-700' }
};

function calculateModelRunnability(model, quantKey, hwProfile, contextTokens, reserveGB = 0) {
  const quant = model.quantProfiles[quantKey];
  if (!quant) return null;

  const weightsGB = isKnown(quant.sizeGB) ? quant.sizeGB : null;
  const kvGB = kvCacheGB(model, contextTokens);
  const totalRequiredGB = isKnown(weightsGB) ? weightsGB + (kvGB || 0) + RUNTIME_HEADROOM_GB : null;
  const availableVramGB = Math.max(0, hwProfile.vramGB - reserveGB);

  let status;
  if (!isKnown(totalRequiredGB)) status = 'unknown';
  else if (totalRequiredGB <= availableVramGB * 0.85) status = 'smooth';
  else if (totalRequiredGB <= availableVramGB) status = 'playable';
  // 統一記憶體（Mac、GB10、Strix Halo、純 CPU）沒有「卸載到系統記憶體」這條路
  else if (!hwProfile.unified && totalRequiredGB <= hwProfile.vramGB + 32) status = 'tight';
  else status = 'oom';

  return {
    quantKey,
    weightsGB,
    kvCacheGB: kvGB,
    totalRequiredGB,
    availableVramGB,
    status,
    statusText: FIT_STATUS[status].text,
    badgeColor: FIT_STATUS[status].badge,
    speed: decodeSpeed(model, quantKey, hwProfile, status)
  };
}

// 速度欄：有作者實測就用實測（只認同一平台、同一檔位），否則給頻寬理論上限
function decodeSpeed(model, quantKey, hw, status) {
  if (status === 'oom') return { kind: 'oom', html: '<span class="text-rose-300">放不下</span>' };
  const measured = benchmarksFor(model.id, hw.id, quantKey).filter(b => isKnown(b.decode));
  if (measured.length) {
    const b = measured[measured.length - 1];
    return { kind: 'measured', value: b.decode, html: `<span class="text-emerald-300 font-bold">${b.decode} t/s</span> <span class="text-[11px] text-emerald-400">實測</span>` };
  }
  if (status === 'tight') return { kind: 'offload', html: '<span class="text-orange-300">受 PCIe／系統記憶體頻寬限制</span>' };
  const ceiling = decodeCeiling(model, quantKey, hw);
  if (!isKnown(ceiling)) return { kind: 'unknown', html: fmt(null) };
  return { kind: 'ceiling', value: ceiling, html: `<span class="text-amber-300">≤ ${ceiling.toFixed(0)} t/s</span> <span class="text-[11px] text-slate-500">理論上限</span>` };
}

// ----------------------------------------------------
// UI Rendering Functions
// ----------------------------------------------------
const TAB_CLASSES = {
  desktop: {
    base: 'nav-tab-btn px-3 py-2 rounded-xl text-sm whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 border',
    on: 'font-semibold bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-lg shadow-emerald-950/40',
    off: 'font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-transparent'
  },
  mobile: {
    base: 'nav-tab-btn px-3 py-1.5 rounded-lg text-xs whitespace-nowrap',
    on: 'font-semibold bg-emerald-500/20 text-emerald-400',
    off: 'font-medium text-slate-400'
  }
};

const TAB_RENDERERS = {
  wizard: () => renderWizard(),
  canirun: () => renderCanIRun(),
  leaderboard: () => renderLeaderboard(),
  bench: () => renderBenchmarks(),
  storage: () => renderStorageAdvisor(),
  radar: () => renderRadarChart(),
  day16: () => renderDay16()
};

// 重繪目前分頁（硬體或主題改變時呼叫）
function render() {
  const fn = TAB_RENDERERS[state.activeTab];
  if (fn) fn();
  renderIcons();
}

function setTab(tabName) {
  if (!TAB_RENDERERS[tabName]) tabName = 'wizard';
  state.activeTab = tabName;
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    const set = TAB_CLASSES[btn.dataset.variant] || TAB_CLASSES.desktop;
    const active = btn.dataset.tab === tabName;
    btn.className = `${set.base} ${active ? set.on : set.off}`;
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.tabIndex = active ? 0 : -1;
  });

  document.querySelectorAll('.tab-content-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tab-content-${tabName}`);
  });

  try { history.replaceState(null, '', tabName === 'wizard' ? location.pathname : `#${tabName}`); } catch (e) {}
  render();
}

// Render 5-Step Wizard
function renderWizard() {
  const container = document.getElementById('wizard-container');
  if (!container) return;

  const hw = getHardware(state.canirun.selectedHardwareId);
  const { remaining, discarded, budgetGB } = evaluateWizard();
  const ans = state.wizard.answers;
  const currentStep = state.wizard.step;

  container.innerHTML = `
    <!-- Upfront Hardware Configuration Hub (Step 0) -->
    <div class="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-emerald-500/40 rounded-2xl p-5 mb-6 shadow-xl backdrop-blur-md">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2">
            <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
              步驟 0：確認硬體平台 (Hardware Platform)
            </span>
            <span class="text-xs text-slate-400">目前生效：<strong class="text-white">${hw.name}</strong>${ans.coexist === 'coexist' ? `（共存預算 ${wizardMemoryBudgetGB(hw, ans)} GB、上下文 ${fmtContext(state.canirun.contextLength)}）` : `（獨佔、上下文 ${fmtContext(state.canirun.contextLength)}）`}</span>
          </div>
          <p class="text-xs text-slate-300 mt-1">
            進入後請先選取您的目標硬體規格。所有模型淘汰規則、顯存佔用、KV Cache 算力與首選推薦皆以此即時運算。
          </p>
        </div>

        <button onclick="detectLocalHardware()" class="detect-hardware-btn px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 font-bold text-xs flex items-center gap-1.5 transition shrink-0 self-start md:self-auto">
          <i data-lucide="cpu" class="w-4 h-4"></i> 自動偵測硬體 (WebGPU)
        </button>
      </div>

      <!-- Quick Select Chips & Dropdown -->
      <div class="pt-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <!-- Quick Chips -->
        <div class="flex items-center gap-1.5 flex-wrap text-xs">
          <span class="text-slate-400 text-xs font-semibold mr-1">常用快捷選取：</span>
          ${[
            { id: 'nvidia-gb10', label: 'NVIDIA GB10 (128GB)' },
            { id: 'dual-gb10', label: '雙機 GB10 (256GB)' },
            { id: 'mac-128', label: 'Apple M5 Max (128GB)' },
            { id: 'rtx-5090-32', label: 'RTX 5090 (32GB)' },
            { id: 'rtx-4090-24', label: 'RTX 4090 (24GB)' },
            { id: 'rtx-5060ti-16', label: 'RTX 5060 Ti (16GB)' },
            { id: 'mac-64', label: 'Apple M5 Max (64GB)' }
          ].map(chip => `
            <button onclick="setGlobalHardware('${chip.id}')" class="px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition ${
              hw.id === chip.id
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700/60'
            }">
              ${chip.label}
            </button>
          `).join('')}
        </div>

        <!-- Full Select Dropdown -->
        <div class="w-full lg:w-72">
          ${hardwareSelectHtml(hw.id, 'setGlobalHardware', 'aria-label="目標硬體平台"')}
        </div>
      </div>
    </div>

    <!-- Top Step Progress Bar -->
    <div class="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-6 mb-8 backdrop-blur-md">
      <div class="flex items-center justify-between mb-4">
        <div>
          <span class="text-xs font-semibold uppercase tracking-wider text-emerald-400">Day 16 模型選型方法論</span>
          <h2 class="text-xl font-bold text-white mt-0.5">五個問題，比排行榜有用：互動決策樹</h2>
        </div>
        <div class="text-right">
          <span class="text-xs text-slate-400">存活候選模型</span>
          <div class="text-2xl font-black text-emerald-400 font-mono">${remaining.length} <span class="text-xs text-slate-400 font-normal">/ ${window.MODELS_DATABASE.length} 款</span></div>
        </div>
      </div>

      <!-- Step Indicator Pills -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        ${[
          { num: 1, title: '任務形狀', sub: '長短輸入輸出' },
          { num: 2, title: '繁體中文', sub: '8-bit & imatrix' },
          { num: 3, title: '記憶體分配', sub: '獨佔 vs 共存' },
          { num: 4, title: '授權條款', sub: '商用 / MIT / Apache' },
          { num: 5, title: '生態成熟度', sub: '主線 vs PR白老鼠' }
        ].map(s => `
          <button onclick="setWizardStep(${s.num})" class="p-3 rounded-xl text-left border transition-all ${
            currentStep === s.num
              ? 'bg-emerald-950/60 border-emerald-500 text-white shadow-md shadow-emerald-950/50'
              : currentStep > s.num
                ? 'bg-slate-800/50 border-emerald-500/30 text-slate-300'
                : 'bg-slate-900/40 border-slate-800 text-slate-500'
          }">
            <div class="flex items-center justify-between text-xs font-bold font-mono mb-1">
              <span>Q${s.num}</span>
              ${currentStep > s.num ? '<i data-lucide="circle-check" class="w-3.5 h-3.5 text-emerald-400"></i>' : ''}
            </div>
            <div class="font-bold text-sm leading-tight">${s.title}</div>
            <div class="text-[11px] text-slate-400 truncate mt-0.5">${s.sub}</div>
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Active Step Content & Live Results Split View -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      
      <!-- Left Column: Active Step Interactive Question (5 cols) -->
      <div class="lg:col-span-6 space-y-6">
        <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
          ${renderWizardStepQuestion(currentStep, ans)}
          
          <div class="flex items-center justify-between mt-8 pt-6 border-t border-slate-800">
            <button onclick="setWizardStep(Math.max(1, state.wizard.step - 1))" ${currentStep === 1 ? 'disabled' : ''} class="px-4 py-2 text-sm font-medium rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none transition">
              <i data-lucide="arrow-left" class="w-4 h-4 inline mr-1"></i> 上一題
            </button>
            <div class="text-xs text-slate-400 font-mono">
              步驟 ${currentStep} / 5
            </div>
            <button onclick="setWizardStep(Math.min(5, state.wizard.step + 1))" ${currentStep === 5 ? 'disabled' : ''} class="px-5 py-2 text-sm font-semibold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20 disabled:opacity-40 disabled:pointer-events-none transition">
              下一題 <i data-lucide="arrow-right" class="w-4 h-4 inline ml-1"></i>
            </button>
          </div>
        </div>

        <!-- Discarded Candidate Log -->
        ${discarded.length > 0 ? `
          <div class="bg-slate-900/60 border border-rose-950/60 rounded-2xl p-5">
            <div class="flex items-center justify-between text-xs font-semibold text-rose-400 mb-3">
              <span class="flex items-center gap-1.5"><i data-lucide="filter-x" class="w-4 h-4"></i> 已被淘汰的模型 (${discarded.length} 款)</span>
              <span class="text-slate-500">五問刪去法</span>
            </div>
            <div class="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
              ${discarded.map(d => `
                <div class="p-2.5 rounded-lg bg-slate-950/80 border border-rose-900/20 flex flex-col gap-1">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-200">${d.model.name}</span>
                    <span class="font-mono text-rose-400 text-[11px] px-1.5 py-0.5 rounded bg-rose-950/40 border border-rose-900/50">淘汰於 Q${d.step}</span>
                  </div>
                  <div class="text-slate-400">${d.reason}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Right Column: Final / Live Recommendation Card (6 cols) -->
      <div class="lg:col-span-6 space-y-6">
        <div class="bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
          <div class="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

          <div class="flex items-center justify-between mb-4">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
              <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> 決策診斷結果
            </span>
            <span class="text-xs text-slate-400">目前硬體：<span class="text-emerald-300 font-bold">${hw.name}</span></span>
          </div>

          ${remaining.length === 0 ? `
            <div class="py-12 text-center text-slate-400">
              <i data-lucide="triangle-alert" class="w-12 h-12 mx-auto text-amber-400 mb-3"></i>
              <h3 class="text-lg font-bold text-white mb-1">條件過於嚴苛，無存活模型</h3>
              <p class="text-xs max-w-sm mx-auto text-slate-400">建議放寬硬體顯存限制（選擇更高規格顯卡）或允許非商用/實驗性生態。</p>
            </div>
          ` : `
            <!-- Top Pick Champion -->
            ${(() => {
              const champion = remaining[0];
              const quantKey = wizardQuantKey(champion, budgetGB);
              const quant = champion.quantProfiles[quantKey];
              const measured = benchmarksFor(champion.id, hw.id).filter(b => isKnown(b.decode));

              return `
                <div class="mb-6">
                  <div class="text-xs font-mono text-emerald-400 uppercase tracking-wider mb-1">首選推薦 CHAMPION PICK</div>
                  <h3 class="text-2xl font-black text-white flex items-center gap-2">
                    ${champion.name}
                    ${champion.isDay16Featured ? '<span class="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-normal">Day 16 實測標竿</span>' : ''}
                    ${examBadge(champion)}
                  </h3>
                  <p class="text-xs text-slate-300 mt-1.5 leading-relaxed">${champion.day16Role || champion.engineNotes}</p>
                </div>

                <!-- Specs Grid -->
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6 text-xs">
                  <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <span class="text-slate-400 block text-[11px]">架構類型</span>
                    <span class="font-bold text-white text-sm">${champion.architecture}</span>
                    <span class="text-[11px] text-slate-400 block">啟用 / 總量：${fmtParams(champion)}</span>
                  </div>
                  <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <span class="text-slate-400 block text-[11px]">Arena Coding Elo</span>
                    <span class="font-bold text-emerald-400 text-sm font-mono">${fmt(champion.arenaCodeElo)}</span>
                    <span class="text-[11px] text-slate-400 block">HumanEval: ${fmt(champion.humanEval, '%')}</span>
                  </div>
                  <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <span class="text-slate-400 block text-[11px]">繁中評級 / 量化底線</span>
                    <span class="font-bold text-amber-300 text-sm">${champion.tcGrade} 級</span>
                    <span class="text-[11px] text-slate-400 block">${champion.tcQuantMinBit}</span>
                  </div>
                  <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <span class="text-slate-400 block text-[11px]">KV 每 Token 成本</span>
                    <span class="font-bold text-cyan-300 text-sm font-mono">${fmt(champion.kvPerTokKB, ' KB')}</span>
                    <span class="text-[11px] text-slate-400 block">${fmtContext(state.canirun.contextLength)} Cache: ${isKnown(champion.kvPerTokKB) ? `~${kvCacheGB(champion, state.canirun.contextLength).toFixed(1)} GB` : '無資料'}</span>
                  </div>
                </div>

                <!-- Deployment & Startup Command Generator -->
                <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs mb-6">
                  <div class="flex items-center justify-between text-slate-400 mb-2 font-sans font-semibold">
                    <span class="flex items-center gap-1.5 text-emerald-400"><i data-lucide="terminal" class="w-3.5 h-3.5"></i> 推薦啟動指令 (${startupCommand(champion, quantKey).engine})</span>
                    <button onclick="copyStartupCmd('${champion.id}')" class="hover:text-white transition text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                      複製指令
                    </button>
                  </div>
                  <div class="text-slate-300 overflow-x-auto p-2 rounded bg-slate-900/90 select-all leading-relaxed whitespace-pre" id="startup-cmd-box">${escapeHtml(startupCommand(champion, quantKey).cmd)}</div>
                  <div class="text-[11px] text-slate-400 mt-2 font-sans">
                    <span class="text-slate-300">建議量化檔：</span><strong class="text-emerald-400">${quantKey}</strong> (${fmt(quant && quant.sizeGB, ' GB')})
                    ${measured.length ? ` ｜ <span class="text-emerald-300">本平台實測 ${measured.map(b => `${b.decode} t/s（${escapeHtml(b.weights)}）`).join('、')}</span>` : ''}
                    ｜ ${champion.tcQuantNote}
                  </div>
                </div>

                <!-- Other Alternate Options -->
                ${remaining.length > 1 ? `
                  <div>
                    <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">其他備選方案 (${remaining.length - 1} 款)</span>
                    <div class="space-y-2">
                      ${remaining.slice(1, 4).map(alt => `
                        <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs hover:border-slate-700 transition">
                          <div>
                            <span class="font-bold text-white text-sm">${alt.name}</span> ${examBadge(alt)}
                            <span class="text-slate-400 block text-[11px]">${alt.architecture} (${fmtParams(alt)}) ｜ 授權: ${alt.license} ｜ JSON 紀律: ${fmt(alt.jsonDisciplineScore, '/100')}</span>
                          </div>
                          <div class="text-right">
                            <span class="text-emerald-400 font-mono font-bold">${fmt(alt.arenaCodeElo, ' Elo')}</span>
                            <span class="text-[11px] text-slate-400 block">繁中 ${alt.tcGrade}</span>
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}
              `;
            })()}
          `}
        </div>

        <!-- Agent Exam Reference Box -->
        <div class="bg-indigo-950/30 border border-indigo-500/30 rounded-2xl p-5 text-xs text-slate-300 flex items-start gap-3.5">
          <i data-lucide="file-check-2" class="w-6 h-6 text-indigo-400 shrink-0 mt-0.5"></i>
          <div>
            <h4 class="font-bold text-white text-sm mb-1">剩下模型分不出高下？用考卷分勝負！</h4>
            <p class="text-slate-300 leading-relaxed">
              Day 16 指出：「任何 OpenAI 相容端點半小時考完。」針對繁體中文語境、JSON 格式無聊多話、Tool Calling 紀律設計的開源測試套件。
            </p>
            <a href="${DAY16_METHODOLOGY.examRepo}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 mt-2.5 text-indigo-300 font-semibold hover:underline">
              前往開源考卷專案 (ivanusto/llm-zhtw-agent-exam) <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
            </a>
          </div>
        </div>

      </div>
    </div>
  `;
}

function renderWizardStepQuestion(step, ans) {
  if (step === 1) {
    return `
      <div>
        <div class="text-xs font-mono text-emerald-400 uppercase tracking-wider mb-1">問題一 (Question 1)</div>
        <h3 class="text-xl font-bold text-white mb-2">你的任務是什麼形狀？</h3>
        <p class="text-xs text-slate-400 mb-6 leading-relaxed">
          先量你自己，不是量模型。把你的典型任務攤開看輸入與輸出比例（Prefill 密集 vs Decode MoE）。
        </p>

        <div class="space-y-3">
          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.workload === 'prefill' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="workload" value="prefill" ${ans.workload === 'prefill' ? 'checked' : ''} onchange="setWizardAnswer('workload', 'prefill')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm flex items-center gap-2">
                  長輸入、短輸出 (Prefill 型用戶)
                  <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">首選密集 27B/32B</span>
                </div>
                <div class="text-xs text-slate-400 mt-1">
                  文件摘要、RAG 問答、大型程式碼庫分析。密集模型 prefill 效率極高（比 decode 快 200 倍），decode 慢無所謂因為很少用。
                </div>
              </div>
            </div>
          </label>

          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.workload === 'decode' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="workload" value="decode" ${ans.workload === 'decode' ? 'checked' : ''} onchange="setWizardAnswer('workload', 'decode')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm flex items-center gap-2">
                  短輸入、長輸出 (Decode 型用戶)
                  <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">首選小啟用量 MoE</span>
                </div>
                <div class="text-xs text-slate-400 mt-1">
                  創意寫作、長文翻譯、即時對話。頻寬是你的天花板，看啟用參數量（如 Ornith 3B、gpt-oss 14B 可達 30~60 t/s）。
                </div>
              </div>
            </div>
          </label>

          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.workload === 'agent' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="workload" value="agent" ${ans.workload === 'agent' ? 'checked' : ''} onchange="setWizardAnswer('workload', 'agent')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm flex items-center gap-2">
                  Agent 迴圈 (多輪 Tool Calling & 多 Session)
                  <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">全能要求型</span>
                </div>
                <div class="text-xs text-slate-400 mt-1">
                  幾百輪工具呼叫。既要 Prefill、又要 Decode，更嚴格要求 KV Cache 成本與「只輸出純 JSON」格式紀律。
                </div>
              </div>
            </div>
          </label>
        </div>
      </div>
    `;
  }

  if (step === 2) {
    return `
      <div>
        <div class="text-xs font-mono text-emerald-400 uppercase tracking-wider mb-1">問題二 (Question 2)</div>
        <h3 class="text-xl font-bold text-white mb-2">你的主要語言是繁體中文嗎？</h3>
        <p class="text-xs text-slate-400 mb-6 leading-relaxed">
          繁中的量化劣化是英文的 1.6 到 2 倍。英文榜上的名次到了繁中會重新洗牌！
        </p>

        <div class="space-y-3">
          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.tcLang === 'yes' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="tcLang" value="yes" ${ans.tcLang === 'yes' ? 'checked' : ''} onchange="setWizardAnswer('tcLang', 'yes')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm">是（必須維持道地繁體中文語感與高精準度）</div>
                <div class="text-xs text-slate-400 mt-1">
                  觸發三條鐵律：<strong>量化從 8-bit 起步</strong>、<strong>低位元認明 imatrix 系</strong>（q4_k_m imatrix 遠勝 NVFP4 5~10 倍）、排除量化易劣化的純歐美特化模型。
                </div>
              </div>
            </div>
          </label>

          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.tcLang === 'no' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="tcLang" value="no" ${ans.tcLang === 'no' ? 'checked' : ''} onchange="setWizardAnswer('tcLang', 'no')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm">否（以英文或多語言程式碼為主）</div>
                <div class="text-xs text-slate-400 mt-1">
                  可接受標準 4-bit 量化，納入更多 Codestral / Llama 等歐美特化程式碼基座。
                </div>
              </div>
            </div>
          </label>
        </div>
      </div>
    `;
  }

  if (step === 3) {
    return `
      <div>
        <div class="text-xs font-mono text-emerald-400 uppercase tracking-wider mb-1">問題三 (Question 3)</div>
        <h3 class="text-xl font-bold text-white mb-2">它要跟誰分這台機器的記憶體？</h3>
        <p class="text-xs text-slate-400 mb-6 leading-relaxed">
          一款模型的真實佔用是<strong>權重 + KV 快取 + 留給別人的餘裕</strong>。KV 每 token 成本差距可達 3.3 倍。
        </p>

        <div class="space-y-3">
          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.coexist === 'coexist' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="coexist" value="coexist" ${ans.coexist === 'coexist' ? 'checked' : ''} onchange="setWizardAnswer('coexist', 'coexist')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm flex items-center gap-2">
                  共存型 (多功能工作站 / 生產集群)
                  <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">推薦</span>
                </div>
                <div class="text-xs text-slate-400 mt-1">
                  模型只是機器上的服務之一。保留餘裕給 ComfyUI 繪圖、第二款小模型或日常開發。選 27B/32B 量化檔或 gpt-oss MXFP4。
                </div>
              </div>
            </div>
          </label>

          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.coexist === 'dedicated' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="coexist" value="dedicated" ${ans.coexist === 'dedicated' ? 'checked' : ''} onchange="setWizardAnswer('coexist', 'dedicated')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm">獨佔型 (Dedicated 專用推理機)</div>
                <div class="text-xs text-slate-400 mt-1">
                  整台機器只為這一款模型服務（如 Ornith BF16 120GB 峰值），效能與上下文拉滿，其他服務讓路。
                </div>
              </div>
            </div>
          </label>
        </div>
      </div>
    `;
  }

  if (step === 4) {
    return `
      <div>
        <div class="text-xs font-mono text-emerald-400 uppercase tracking-wider mb-1">問題四 (Question 4)</div>
        <h3 class="text-xl font-bold text-white mb-2">授權條款允許你的用途嗎？</h3>
        <p class="text-xs text-slate-400 mb-6 leading-relaxed">
          地端部署不代表授權問題消失。尤其 MSP 與接案場景，模型的授權是你交付物的一部分。
        </p>

        <div class="space-y-3">
          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.license === 'commercial' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="license" value="commercial" ${ans.license === 'commercial' ? 'checked' : ''} onchange="setWizardAnswer('license', 'commercial')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm">商業生產 / 客戶交付 (無爭議開放商用)</div>
                <div class="text-xs text-slate-400 mt-1">
                  認明 <strong>Apache 2.0</strong> (Qwen, gpt-oss) 或 <strong>MIT</strong> (Ornith, DeepSeek)，放心商業授權。過濾掉非商業條款。
                </div>
              </div>
            </div>
          </label>

          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.license === 'any' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="license" value="any" ${ans.license === 'any' ? 'checked' : ''} onchange="setWizardAnswer('license', 'any')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm">內部研究 / 個人實驗 (寬鬆)</div>
                <div class="text-xs text-slate-400 mt-1">
                  允許社群授權 (如 qwen-community-1.0, MNCL, Gemma License)。
                </div>
              </div>
            </div>
          </label>
        </div>
      </div>
    `;
  }

  if (step === 5) {
    return `
      <div>
        <div class="text-xs font-mono text-emerald-400 uppercase tracking-wider mb-1">問題五 (Question 5)</div>
        <h3 class="text-xl font-bold text-white mb-2">推理生態接得住它嗎？</h3>
        <p class="text-xs text-slate-400 mb-6 leading-relaxed">
          新模型的紙面規格再漂亮，引擎支援沒合併進主線就是實驗品。願不願意當白老鼠是個人選擇，把白老鼠環境放進生產服務是專業錯誤。
        </p>

        <div class="space-y-3">
          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.ecosystem === 'production' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="ecosystem" value="production" ${ans.ecosystem === 'production' ? 'checked' : ''} onchange="setWizardAnswer('ecosystem', 'production')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm flex items-center gap-2">
                  生產服務標準 (已合併進 vLLM / llama.cpp / Ollama 正式版)
                  <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">穩定首選</span>
                </div>
                <div class="text-xs text-slate-400 mt-1">
                  量化生態完整（豐富 GGUF/AWQ）、硬體平台有穩定實測。排除仍需自編 PR 分支的實驗性模型。
                </div>
              </div>
            </div>
          </label>

          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.ecosystem === 'experimental' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="ecosystem" value="experimental" ${ans.ecosystem === 'experimental' ? 'checked' : ''} onchange="setWizardAnswer('ecosystem', 'experimental')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm">願意踩坑 / 自編分支 (探索最尖端架構)</div>
                <div class="text-xs text-slate-400 mt-1">
                  包含 Flash-Next 等紙面領先但仍在 PR 階段的新模型。
                </div>
              </div>
            </div>
          </label>
        </div>
      </div>
    `;
  }
}

function setWizardStep(step) {
  state.wizard.step = step;
  render();
}

function setWizardAnswer(key, val) {
  state.wizard.answers[key] = val;
  render();
}

// 精靈推薦的量化檔：只在共存／獨佔預算放得下的檔位裡挑
function wizardQuantKey(m, budgetGB) {
  const ctx = state.canirun.contextLength;
  return pickQuantKey(m, state.wizard.answers.tcLang, k => requiredGB(m, k, ctx) <= budgetGB);
}

// 依量化檔類型產生啟動指令：GGUF 走 llama.cpp，EXL3 與 ds4 走各自的社群引擎，其餘（BF16、FP8、NVFP4…）走 vLLM
function startupCommand(m, quantKey) {
  const ctx = state.canirun.contextLength;
  const src = m.sources || {};
  if (/EXL3/.test(quantKey)) {
    return { engine: '社群配方', cmd: `# ${quantKey} 需要 EXL3 專用引擎（例如 TensorFold），請依量化檔 repo 的部署說明啟動\n# 量化檔：${src.quant || '見模型詳情'}` };
  }
  if (/\(ds4\)/.test(quantKey)) {
    return { engine: 'ds4', cmd: `# ${quantKey} 由 ds4 引擎載入\n# 量化檔：${src.quant || '見模型詳情'}` };
  }
  if (/^(UD-)?(I?Q\d)/.test(quantKey)) {
    return { engine: 'llama.cpp', cmd: `./llama-server -m "models/${m.id}-${quantKey}.gguf" -c ${ctx} -ngl 99 --jinja --port 8080 --host 0.0.0.0` };
  }
  const repo = String(src.specs || '').replace('https://huggingface.co/', '') || m.id;
  return { engine: 'vLLM', cmd: `vllm serve ${repo} --max-model-len ${ctx} --port 8080 --host 0.0.0.0` };
}

async function copyToClipboard(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMsg);
  } catch (e) {
    showToast('瀏覽器不允許寫入剪貼簿，請手動選取複製');
  }
}

function copyStartupCmd(modelId) {
  const model = getModel(modelId);
  const { budgetGB } = evaluateWizard();
  copyToClipboard(startupCommand(model, wizardQuantKey(model, budgetGB)).cmd, '已複製啟動指令至剪貼簿！');
}

// ----------------------------------------------------
// CanIRun.ai Hardware Simulator
// ----------------------------------------------------
function renderCanIRun() {
  const container = document.getElementById('canirun-container');
  if (!container) return;

  const hw = getHardware(state.canirun.selectedHardwareId);
  const ctx = state.canirun.contextLength;
  const reserveGB = state.canirun.reserveCoexistGB;
  const filterArch = state.canirun.filterArchitecture;

  // 控制項只在這裡畫一次；滑桿與搜尋框之後只更新結果區，輸入中的元素不會被換掉
  container.innerHTML = `
    <!-- Top Hardware Selector & Config Card -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 mb-8 backdrop-blur-md shadow-xl">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-emerald-400">CanIRun.ai 算力與顯存模擬</span>
            <span class="px-2 py-0.5 rounded-full text-[11px] bg-slate-800 text-slate-300 border border-slate-700">瀏覽器端試算</span>
          </div>
          <h2 class="text-xl font-bold text-white mt-1">硬體相容度與推理速度試算</h2>
          <p class="text-[11px] text-slate-400 mt-1">速度欄：有作者 GB10 實測就顯示實測值；否則顯示頻寬理論上限（頻寬 ÷ 每 token 讀取的啟用權重），GB10 上各引擎實測約達上限的 ${ENGINE_EFFICIENCY_RANGE.map(x => `${Math.round(x * 100)}%`).join(' 到 ')}（Day 11）。</p>
        </div>

        <button onclick="detectLocalHardware()" class="detect-hardware-btn px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-950/50 flex items-center gap-2 transition self-start lg:self-auto">
          <i data-lucide="cpu" class="w-4 h-4"></i> 自動偵測本機硬體
        </button>
      </div>

      <!-- Controls Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 text-xs">

        <!-- 1. Hardware Select -->
        <div>
          <label for="canirun-hw" class="block font-semibold text-slate-300 mb-2">選擇測試硬體平台：</label>
          ${hardwareSelectHtml(hw.id, 'setCanIRunHardware', 'id="canirun-hw"')}
          <span class="text-[11px] text-slate-400 mt-1.5 block">${hw.description}</span>
        </div>

        <!-- 2. Context Length Slider -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label for="canirun-ctx" class="font-semibold text-slate-300">上下文長度 (Context Length)：</label>
            <span id="canirun-ctx-label" class="font-mono font-bold text-emerald-400"></span>
          </div>
          <input id="canirun-ctx" type="range" min="2048" max="131072" step="2048" value="${ctx}" oninput="setCanIRunContext(this.value)" class="w-full accent-emerald-400 cursor-pointer">
          <div class="flex justify-between text-[11px] text-slate-500 font-mono mt-1" aria-hidden="true">
            <span>2k</span>
            <span>16k (標準)</span>
            <span>64k</span>
            <span>128k (極限)</span>
          </div>
        </div>

        <!-- 3. Coexistence Headroom -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label for="canirun-reserve" class="font-semibold text-slate-300">保留餘裕 (ComfyUI / 系統)：</label>
            <span id="canirun-reserve-label" class="font-mono font-bold text-cyan-400"></span>
          </div>
          <input id="canirun-reserve" type="range" min="0" max="48" step="4" value="${reserveGB}" oninput="setCanIRunReserve(this.value)" class="w-full accent-cyan-400 cursor-pointer">
          <div class="flex justify-between text-[11px] text-slate-500 font-mono mt-1" aria-hidden="true">
            <span>0G (獨佔)</span>
            <span>16G (共存標準)</span>
            <span>32G</span>
            <span>48G</span>
          </div>
        </div>

      </div>

      <!-- Quick Summary Status Bar -->
      <div class="mt-6 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div class="flex flex-wrap items-center gap-4 text-slate-300">
          <span>總記憶體/顯存: <strong class="text-white">${hw.vramGB} GB</strong></span>
          <span>可用淨顯存: <strong id="canirun-available" class="text-emerald-400"></strong></span>
          <span>記憶體頻寬: <strong class="text-cyan-400">${fmt(hw.memBandwidthGBs, ' GB/s')}</strong></span>
        </div>
        <div class="flex flex-wrap items-center gap-3 text-[11px] font-sans">
          <span class="inline-flex items-center gap-1 text-emerald-400"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> 完美暢跑</span>
          <span class="inline-flex items-center gap-1 text-amber-400"><span class="w-2 h-2 rounded-full bg-amber-400"></span> 良好運行</span>
          ${hw.unified ? '' : '<span class="inline-flex items-center gap-1 text-orange-400"><span class="w-2 h-2 rounded-full bg-orange-400"></span> CPU卸載/慢</span>'}
          <span class="inline-flex items-center gap-1 text-rose-400"><span class="w-2 h-2 rounded-full bg-rose-400"></span> 放不下</span>
        </div>
      </div>
    </div>

    <!-- Filter & Search Bar -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
      <div class="relative w-full sm:w-72">
        <i data-lucide="search" class="w-4 h-4 absolute left-3 top-3 text-slate-500"></i>
        <input type="search" aria-label="搜尋模型" placeholder="搜尋模型 (如 Qwen, Ornith, DeepSeek)..." value="${escapeHtml(state.canirun.searchQuery)}" oninput="setCanIRunSearch(this.value)" class="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500">
      </div>

      <div class="flex items-center gap-2 self-end sm:self-auto text-xs" role="group" aria-label="架構篩選">
        <span class="text-slate-400">架構篩選:</span>
        ${['all', 'Dense', 'MoE'].map(arch => `
          <button onclick="setCanIRunArchFilter('${arch}')" aria-pressed="${filterArch === arch}" class="px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
            filterArch === arch
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
          }">
            ${arch === 'all' ? '全部架構' : arch}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Models Hardware Compatibility Matrix (Cards Grid) -->
    <div id="canirun-results" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6" aria-live="polite"></div>
  `;
  updateCanIRunResults();
}

function updateCanIRunResults() {
  const grid = document.getElementById('canirun-results');
  if (!grid) return;
  const hw = getHardware(state.canirun.selectedHardwareId);
  const ctx = state.canirun.contextLength;
  const reserveGB = state.canirun.reserveCoexistGB;
  const filterArch = state.canirun.filterArchitecture;
  const query = state.canirun.searchQuery.trim().toLowerCase();

  const ctxLabel = document.getElementById('canirun-ctx-label');
  if (ctxLabel) ctxLabel.textContent = `${(ctx / 1024).toFixed(0)}k (${formatNumber(ctx)} tok)`;
  const reserveLabel = document.getElementById('canirun-reserve-label');
  if (reserveLabel) reserveLabel.textContent = `${reserveGB} GB`;
  const avail = document.getElementById('canirun-available');
  if (avail) avail.textContent = `${Math.max(0, hw.vramGB - reserveGB)} GB`;

  const models = window.MODELS_DATABASE.filter(m => {
    if (filterArch !== 'all' && m.architecture !== filterArch) return false;
    if (query && !m.name.toLowerCase().includes(query) && !m.family.toLowerCase().includes(query)) return false;
    return true;
  });

  grid.innerHTML = models.length
    ? models.map(model => renderCanIRunModelCard(model, hw, ctx, reserveGB)).join('')
    : '<div class="col-span-full py-10 text-center text-xs text-slate-400">沒有符合條件的模型</div>';
  renderIcons(grid);
}

function renderCanIRunModelCard(model, hw, ctx, reserveGB) {
  // 每個量化檔只算一次
  const results = quantKeysBySize(model).map(k => calculateModelRunnability(model, k, hw, ctx, reserveGB));
  // 推薦檔位：放得下（暢跑或良好）的最大檔；都放不下就取最小檔
  const fitting = results.filter(r => r.status === 'smooth' || r.status === 'playable');
  const primary = fitting.length ? fitting[fitting.length - 1] : results[0];
  const pct = v => isKnown(v) ? Math.min(100, (v / hw.vramGB) * 100) : 0;

  return `
    <div class="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 shadow-lg transition duration-200 flex flex-col justify-between backdrop-blur-sm">
      <div>
        <!-- Header -->
        <div class="flex items-start justify-between gap-2 mb-3">
          <div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="px-2 py-0.5 rounded text-[11px] font-mono font-bold ${model.architecture === 'MoE' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800 text-slate-300 border border-slate-700'}">
                ${model.architecture} ${fmtParams(model, ' 啟用 / ')}
              </span>
              <span class="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-400 border border-slate-700 font-mono">${model.license}</span>
            </div>
            <h3 class="text-base font-bold text-white mt-1.5">${model.name}</h3>
          </div>
          <span class="px-2.5 py-1 rounded-lg text-xs font-bold font-mono border shrink-0 ${primary.badgeColor}">
            ${primary.statusText} ${primary.quantKey}
          </span>
        </div>

        <!-- Status Summary Banner -->
        <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 mb-4">
          <div class="flex items-center justify-between text-xs mb-1.5">
            <span class="text-slate-400">推薦量化檔位：<strong class="text-emerald-400 font-mono">${primary.quantKey}</strong></span>
            <span class="text-slate-300 font-mono font-bold">${isKnown(primary.totalRequiredGB) ? primary.totalRequiredGB.toFixed(1) : '?'} GB <span class="text-slate-500 font-normal">/ ${hw.vramGB} GB</span></span>
          </div>

          <!-- Memory Progress Bar -->
          <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex mb-2" aria-hidden="true">
            <div class="bg-emerald-500 h-full" style="width: ${pct(primary.weightsGB)}%"></div>
            <div class="bg-cyan-400 h-full" style="width: ${pct(primary.kvCacheGB)}%"></div>
            <div class="bg-purple-500 h-full" style="width: ${pct(RUNTIME_HEADROOM_GB)}%"></div>
          </div>

          <div class="grid grid-cols-3 gap-1 text-[11px] text-slate-400 font-mono">
            <div>權重: <span class="text-emerald-400">${isKnown(primary.weightsGB) ? `${primary.weightsGB.toFixed(1)}G` : '無資料'}</span></div>
            <div>KV 快取: <span class="text-cyan-400">${isKnown(primary.kvCacheGB) ? `${primary.kvCacheGB.toFixed(2)}G` : '無資料'}</span></div>
            <div>執行期: <span class="text-purple-300">${RUNTIME_HEADROOM_GB.toFixed(1)}G</span></div>
          </div>
          <div class="mt-2 text-[11px] text-slate-400">Decode 速度：${primary.speed.html}</div>
        </div>

        <!-- All Quant Profiles Comparison -->
        <div class="space-y-1.5 mb-4">
          <span class="text-[11px] font-semibold text-slate-400 block">各量化版本佔用：</span>
          <div class="grid grid-cols-3 gap-1.5 text-xs">
            ${results.map(res => `
              <div class="p-2 rounded-lg border text-center font-mono ${res.badgeColor}" title="${res.statusText}">
                <div class="font-bold text-[11px] truncate">${res.quantKey}</div>
                <div class="text-[11px] opacity-80">${isKnown(res.weightsGB) ? `${res.weightsGB.toFixed(1)} GB` : '無資料'}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Footer Notes -->
      <div class="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
        <span class="truncate">繁中建議：<strong class="text-slate-300">${model.tcQuantMinBit}</strong></span>
        <button onclick="openModelDetailModal('${model.id}')" class="text-emerald-400 hover:underline font-medium shrink-0 ml-2">
          詳細參數 &rarr;
        </button>
      </div>
    </div>
  `;
}

// 硬體是全站共用設定：換了就重繪目前分頁
function setGlobalHardware(hwId) {
  state.canirun.selectedHardwareId = hwId;
  render();
  showToast(`已切換目標硬體為：${getHardware(hwId).name}`);
}

function setCanIRunHardware(hwId) {
  state.canirun.selectedHardwareId = hwId;
  render();
}

function setCanIRunContext(val) {
  state.canirun.contextLength = parseInt(val, 10);
  updateCanIRunResults();
}

function setCanIRunReserve(val) {
  state.canirun.reserveCoexistGB = parseInt(val, 10);
  updateCanIRunResults();
}

function setCanIRunSearch(val) {
  state.canirun.searchQuery = val;
  updateCanIRunResults();
}

function setCanIRunArchFilter(val) {
  state.canirun.filterArchitecture = val;
  render();
}

// ----------------------------------------------------
// Arena.ai Coding Leaderboard & Matrix
// ----------------------------------------------------
const LEADERBOARD_SORTS = [
  ['arenaCodeElo', 'Arena Coding Elo (高到低)'],
  ['arenaWebdevElo', 'Arena WebDev 分數'],
  ['sweBench', 'SWE-bench Verified'],
  ['liveCodeBench', 'LiveCodeBench'],
  ['humanEval', 'HumanEval 正確率'],
  ['jsonDisciplineScore', 'JSON 格式禮儀評分'],
  ['paramsTotal', '總參數量 (Params)']
];

function renderLeaderboard() {
  const container = document.getElementById('leaderboard-container');
  if (!container) return;
  const lb = state.leaderboard;
  const asof = window.DATA_ASOF || {};

  container.innerHTML = `
    <!-- Top Filter Bar -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 mb-8 backdrop-blur-md shadow-xl">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-emerald-400">Arena.ai Coding 天梯榜</span>
            <span class="px-2 py-0.5 rounded-full text-[11px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">Coding Elo & 實測維度整合</span>
          </div>
          <h2 class="text-xl font-bold text-white mt-1">開放權重程式碼模型競技場排行榜</h2>
          <p class="text-[11px] text-slate-400 mt-1">Arena 快照：${asof.arena || '無資料'} ｜ 規格核對：${asof.specs || '無資料'} ｜ 查不到來源的數字顯示「無資料」</p>
        </div>

        <!-- Compare Action Button -->
        <button onclick="openCompareModal()" class="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-950/50 flex items-center gap-2 transition self-start lg:self-auto">
          <i data-lucide="columns-3" class="w-4 h-4"></i> 橫向對比矩陣 (<span id="compare-count">${lb.selectedCompareIds.length}</span> 款)
        </button>
      </div>

      <!-- Filter Controls Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-6 text-xs">
        <div>
          <label for="lb-search" class="block font-semibold text-slate-300 mb-1.5">搜尋模型名稱：</label>
          <input id="lb-search" type="search" placeholder="關鍵字搜尋..." value="${escapeHtml(lb.searchQuery)}" oninput="setLeaderboardSearch(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500">
        </div>

        <div>
          <label for="lb-arch" class="block font-semibold text-slate-300 mb-1.5">架構 (Architecture)：</label>
          <select id="lb-arch" onchange="setLeaderboardFilter('filterArch', this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
            <option value="all" ${lb.filterArch === 'all' ? 'selected' : ''}>全部架構 (Dense + MoE)</option>
            <option value="Dense" ${lb.filterArch === 'Dense' ? 'selected' : ''}>密集模型 (Dense)</option>
            <option value="MoE" ${lb.filterArch === 'MoE' ? 'selected' : ''}>混合專家 (MoE)</option>
          </select>
        </div>

        <div>
          <label for="lb-license" class="block font-semibold text-slate-300 mb-1.5">授權要求 (License)：</label>
          <select id="lb-license" onchange="setLeaderboardFilter('filterLicense', this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
            <option value="all" ${lb.filterLicense === 'all' ? 'selected' : ''}>全部授權</option>
            <option value="commercial" ${lb.filterLicense === 'commercial' ? 'selected' : ''}>允許商用 (Commercial Ready)</option>
            <option value="apache-mit" ${lb.filterLicense === 'apache-mit' ? 'selected' : ''}>Apache 2.0 / MIT 寬鬆授權</option>
          </select>
        </div>

        <div>
          <label for="lb-sort" class="block font-semibold text-slate-300 mb-1.5">排序依據 (Sort By)：</label>
          <select id="lb-sort" onchange="setLeaderboardFilter('sortBy', this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
            ${LEADERBOARD_SORTS.map(([k, label]) => `<option value="${k}" ${lb.sortBy === k ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Quick Toggles -->
      <div class="mt-4 flex items-center gap-4 text-xs">
        <label class="flex items-center gap-2 cursor-pointer text-slate-300 select-none">
          <input type="checkbox" ${lb.filterDay16Only ? 'checked' : ''} onchange="setLeaderboardFilter('filterDay16Only', this.checked)" class="rounded text-emerald-500 focus:ring-emerald-500 bg-slate-950 border-slate-700">
          <span>只顯示 Day 16 系列實測標竿模型</span>
        </label>
      </div>
    </div>

    <!-- Leaderboard Table -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <caption class="sr-only">開放權重模型排行榜</caption>
          <thead class="bg-slate-950 text-slate-400 uppercase font-mono text-[11px] border-b border-slate-800">
            <tr>
              <th scope="col" class="py-3.5 px-4">對比</th>
              <th scope="col" class="py-3.5 px-4">排名 / 模型名稱</th>
              <th scope="col" class="py-3.5 px-4 text-center">Arena Coding Elo</th>
              <th scope="col" class="py-3.5 px-4 text-center">架構 / 參數</th>
              <th scope="col" class="py-3.5 px-4 text-center">繁中評級</th>
              <th scope="col" class="py-3.5 px-4 text-center">JSON 紀律</th>
              <th scope="col" class="py-3.5 px-4 text-center">KV 每 Token</th>
              <th scope="col" class="py-3.5 px-4">授權 (License)</th>
              <th scope="col" class="py-3.5 px-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody id="leaderboard-rows" class="divide-y divide-slate-800/60 font-sans"></tbody>
        </table>
      </div>
    </div>
  `;
  updateLeaderboardRows();
}

function filteredLeaderboardModels() {
  const lb = state.leaderboard;
  let models = [...window.MODELS_DATABASE];
  if (lb.filterArch !== 'all') models = models.filter(m => m.architecture === lb.filterArch);
  if (lb.filterLicense === 'commercial') models = models.filter(m => m.commercialAllowed);
  else if (lb.filterLicense === 'apache-mit') models = models.filter(m => m.license === 'Apache 2.0' || m.license === 'MIT');
  if (lb.filterDay16Only) models = models.filter(m => m.isDay16Featured);
  const q = lb.searchQuery.trim().toLowerCase();
  if (q) models = models.filter(m => m.name.toLowerCase().includes(q) || m.family.toLowerCase().includes(q));

  // 由高到低；無資料的排最後
  models.sort((a, b) => {
    const valA = a[lb.sortBy], valB = b[lb.sortBy];
    if (!isKnown(valA) && !isKnown(valB)) return 0;
    if (!isKnown(valA)) return 1;
    if (!isKnown(valB)) return -1;
    return valB - valA;
  });
  return models;
}

function updateLeaderboardRows() {
  const tbody = document.getElementById('leaderboard-rows');
  if (!tbody) return;
  const lb = state.leaderboard;
  const models = filteredLeaderboardModels();
  let known = 0;

  tbody.innerHTML = models.length ? models.map(model => {
    const isChecked = lb.selectedCompareIds.includes(model.id);
    // 名次只給排序欄位有資料的模型，而且是篩選後清單內的順位
    const rank = isKnown(model[lb.sortBy]) ? `#${++known}` : '無';
    return `
                <tr class="hover:bg-slate-800/40 transition">
                  <td class="py-3.5 px-4">
                    <input type="checkbox" aria-label="加入對比：${escapeHtml(model.name)}" ${isChecked ? 'checked' : ''} onchange="toggleCompareSelection('${model.id}', this)" class="rounded text-indigo-500 focus:ring-indigo-500 bg-slate-950 border-slate-700 cursor-pointer">
                  </td>
                  <td class="py-3.5 px-4">
                    <div class="flex items-center gap-2">
                      <span class="font-mono font-bold text-slate-500 text-xs w-6">${rank}</span>
                      <div>
                        <div class="font-bold text-white flex items-center gap-1.5">
                          ${model.name}
                          ${benchmarksFor(model.id).length ? '<span class="px-1.5 py-0.5 rounded text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">GB10 實測</span>' : ''}
                          ${model.isDay16Featured ? '<span class="px-1.5 py-0.5 rounded text-[11px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Day 16</span>' : ''}
                        </div>
                        <div class="text-[11px] text-slate-400 font-mono">${model.family} ｜ 上下文: ${fmtContext(model.contextWindow)}</div>
                      </div>
                    </div>
                  </td>
                  <td class="py-3.5 px-4 text-center font-mono">
                    <span class="font-black text-emerald-400 text-sm">${fmt(model.arenaCodeElo)}</span>
                    <span class="block text-[11px] text-slate-400">WebDev: ${fmt(model.arenaWebdevElo)}</span>
                    <span class="block text-[11px] text-slate-400">SWE-V: ${fmt(model.sweBench, '%')}</span>
                  </td>
                  <td class="py-3.5 px-4 text-center font-mono">
                    <span class="px-2 py-0.5 rounded text-[11px] font-bold ${model.architecture === 'MoE' ? 'bg-purple-500/20 text-purple-300' : 'bg-slate-800 text-slate-300'}">
                      ${model.architecture}
                    </span>
                    <span class="block text-[11px] text-slate-400 mt-0.5">${fmtParams(model)}</span>
                  </td>
                  <td class="py-3.5 px-4 text-center">
                    <span class="font-bold text-amber-300 text-xs">${model.tcGrade}</span>
                    <span class="block text-[11px] text-slate-400">${model.tcQuantMinBit}</span>
                  </td>
                  <td class="py-3.5 px-4 text-center font-mono">
                    <div class="inline-flex items-center gap-1">
                      <span class="font-bold text-slate-200">${fmt(model.jsonDisciplineScore)}</span>
                      ${isKnown(model.jsonDisciplineScore) ? '<span class="text-[11px] text-slate-500">/100</span>' : ''}
                    </div>
                  </td>
                  <td class="py-3.5 px-4 text-center font-mono text-cyan-300">
                    ${fmt(model.kvPerTokKB, ' KB')}
                  </td>
                  <td class="py-3.5 px-4 font-mono text-[11px]">
                    <span class="${model.commercialAllowed ? 'text-emerald-400' : 'text-amber-400'}">${model.license}</span>
                  </td>
                  <td class="py-3.5 px-4 text-right">
                    <button onclick="openModelDetailModal('${model.id}')" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition">
                      詳情
                    </button>
                  </td>
                </tr>
    `;
  }).join('') : '<tr><td colspan="9" class="py-10 text-center text-slate-400">沒有符合條件的模型</td></tr>';
  renderIcons(tbody);
}

function setLeaderboardSearch(val) {
  state.leaderboard.searchQuery = val;
  updateLeaderboardRows();
}

function setLeaderboardFilter(key, val) {
  state.leaderboard[key] = val;
  updateLeaderboardRows();
}

function toggleCompareSelection(id, el) {
  const arr = state.leaderboard.selectedCompareIds;
  const idx = arr.indexOf(id);
  if (idx >= 0) {
    arr.splice(idx, 1);
  } else if (arr.length >= 4) {
    if (el) el.checked = false;
    showToast('最多同時對比 4 款模型');
    return;
  } else {
    arr.push(id);
  }
  const counter = document.getElementById('compare-count');
  if (counter) counter.textContent = arr.length;
}

// ----------------------------------------------------
// Storage & I/O Advisor (SSD vs NAS)
// ----------------------------------------------------
function renderStorageAdvisor() {
  const container = document.getElementById('storage-container');
  if (!container) return;

  const model = getModel(state.storage.selectedModelId) || window.MODELS_DATABASE[0];
  const quantKey = model.quantProfiles[state.storage.selectedQuant] ? state.storage.selectedQuant : quantKeysBySize(model)[0];
  const quant = model.quantProfiles[quantKey];
  // 系統記憶體跟著全站選定的硬體走（獨立顯卡以顯存計，作為下限的保守估計）
  const hw = getHardware(state.canirun.selectedHardwareId);
  const ramGB = hw.vramGB;
  const loader = state.storage.loaderType;

  const modelSizeGB = quant.sizeGB;
  const fitsInRam = isKnown(modelSizeGB) && modelSizeGB <= ramGB * 0.8; // 留 20% 給系統

  container.innerHTML = `
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 mb-8 backdrop-blur-md shadow-xl">
      <div class="pb-6 border-b border-slate-800">
        <span class="text-xs font-semibold uppercase tracking-wider text-emerald-400">Day 16 附篇：模型住哪裡</span>
        <h2 class="text-xl font-bold text-white mt-1">SSD 還是 NAS 儲存與 Loader 效能決策樹</h2>
        <p class="text-xs text-slate-400 mt-1">
          選完模型，順手把儲存分配也定了！兩個判斷問題搞定冷啟動與執行期分層。
        </p>
      </div>

      <!-- Controls Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 text-xs">
        <div>
          <label for="storage-model" class="block font-semibold text-slate-300 mb-2">選擇欲評估模型：</label>
          <select id="storage-model" onchange="setStorageModel(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500">
            ${window.MODELS_DATABASE.map(m => `
              <option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>${m.name}</option>
            `).join('')}
          </select>
        </div>

        <div>
          <label for="storage-quant" class="block font-semibold text-slate-300 mb-2">選擇量化規格：</label>
          <select id="storage-quant" onchange="setStorageQuant(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500">
            ${Object.keys(model.quantProfiles).map(k => `
              <option value="${k}" ${k === quantKey ? 'selected' : ''}>${k} (${isKnown(model.quantProfiles[k].sizeGB) ? `${model.quantProfiles[k].sizeGB} GB` : '無資料'})</option>
            `).join('')}
          </select>
        </div>

        <div>
          <label for="storage-loader" class="block font-semibold text-slate-300 mb-2">推理 Loader 類型：</label>
          <select id="storage-loader" onchange="setStorageLoader(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500">
            <option value="gguf-mmap" ${loader === 'gguf-mmap' ? 'selected' : ''}>llama.cpp / Ollama (GGUF mmap 吃掉磁碟能力 81%)</option>
            <option value="vllm" ${loader === 'vllm' ? 'selected' : ''}>vLLM / HuggingFace Safetensors (只用到磁碟能力 3%)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Storage Decision Result Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
      
      <!-- Question 1: Memory Fit -->
      <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs font-bold font-mono text-emerald-400">第一問：它放得進記憶體嗎？</span>
          <span class="text-xs px-2.5 py-1 rounded-full font-bold ${fitsInRam ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'}">
            ${fitsInRam ? '放得進記憶體' : '放不進記憶體 (超限)'}
          </span>
        </div>

        <div class="text-xs text-slate-300 leading-relaxed mb-4">
          ${fitsInRam ? `
            <strong>放得進記憶體：</strong> 模型檔 (${modelSizeGB} GB) 完全可由 ${hw.name} 的記憶體容納。放置於 <strong>NAS 網路集中庫</strong> 的代價僅為冷啟動時多花 10~20 秒的一次回傳成本，載入後推論零效能損失。
          ` : `
            <strong>放不進記憶體：</strong> 別放 NAS。實測模型大小逼近可用記憶體時，走 NFS 的總載入慢了 <strong>3.8 倍</strong>，而且慢的不只是讀檔，連名義上純 CPU 的階段都被拖慢，因為記憶體裝不下模型加上載入過程的中間副本，頁面回收後再讀都走網路。<strong>請放本機 NVMe SSD。</strong>
          `}
        </div>

        <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400">
          模型大小: <span class="text-white">${fmt(modelSizeGB, ' GB')}</span> ｜ ${hw.name} 可用記憶體（扣 20% 給系統）: <span class="text-emerald-400">${(ramGB * 0.8).toFixed(1)} GB</span>
        </div>
      </div>

      <!-- Question 2: Loader Disk Dependency -->
      <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs font-bold font-mono text-cyan-400">第二問：你的 loader 吃儲存速度嗎？</span>
          <span class="text-xs px-2.5 py-1 rounded-full font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            ${loader === 'gguf-mmap' ? 'mmap 吃掉 81%' : 'vLLM 只用 3%'}
          </span>
        </div>

        <div class="text-xs text-slate-300 leading-relaxed mb-4">
          ${loader === 'gguf-mmap' ? `
            <strong>GGUF mmap 機制：</strong> 同一顆碟、同一個 readahead 設定下，mmap 載入跑到 4,351 MB/s，吃掉磁碟能力的 81%，載入速度與磁碟同數量級。換更快的 NVMe 會直接反映在啟動時間上。
          ` : `
            <strong>vLLM / Safetensors 重構：</strong> 同一顆碟上 vLLM 載入只跑到 161 MB/s，用掉磁碟能力的 3%，與磁碟差一個數量級。瓶頸在它自己的反序列化，搬去更貴的高速碟不會有感。
          `}
        </div>

        <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-sans text-slate-300">
          <strong>實務金句：</strong>「常駐主力住本機 NVMe，實驗品與冷門檔住 NAS 集中庫。」
        </div>
      </div>
    </div>

    <!-- Readahead Optimization Command Generator -->
    <div class="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-6 shadow-xl">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <i data-lucide="zap" class="w-5 h-5 text-emerald-400"></i>
          <h3 class="text-base font-bold text-white">Readahead 預讀免費加速調優指令 (Linux / macOS)</h3>
        </div>
        <span class="text-xs text-emerald-400 font-bold">唯一人人該做的免費加速</span>
      </div>
      <p class="text-xs text-slate-300 mb-4 leading-relaxed">
        Day 16 指出：預設 readahead (128 KB) 太小，調高至 2048 KB 或 4096 KB 可顯著加速大型 GGUF 檔案 mmap 載入時間。
      </p>

      <div class="space-y-3 font-mono text-xs">
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
          <code class="text-emerald-300"># Linux 查看與調高 NVMe readahead (由 128KB 升至 2MB)<br>sudo blockdev --getra /dev/nvme0n1<br>sudo blockdev --setra 4096 /dev/nvme0n1</code>
          <button onclick="copyText('sudo blockdev --setra 4096 /dev/nvme0n1')" aria-label="複製 readahead 指令" class="px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:text-white text-xs font-sans">複製</button>
        </div>
      </div>
    </div>
  `;
}

function setStorageModel(val) {
  state.storage.selectedModelId = val;
  // 換模型時重設量化檔，避免沿用上一款模型才有的檔位
  state.storage.selectedQuant = quantKeysBySize(getModel(val))[0];
  render();
}

function setStorageQuant(val) {
  state.storage.selectedQuant = val;
  render();
}

function setStorageLoader(val) {
  state.storage.loaderType = val;
  render();
}

// ----------------------------------------------------
// Radar Chart & Multi-metric Comparison
// ----------------------------------------------------
// Chart.js 只有雷達分頁用得到，第一次打開時才載入
let _chartJsPromise = null;
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (!_chartJsPromise) {
    _chartJsPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'vendor/chart.umd.min.js';
      el.onload = resolve;
      el.onerror = () => { _chartJsPromise = null; reject(new Error('Chart.js 載入失敗')); };
      document.head.appendChild(el);
    });
  }
  return _chartJsPromise;
}

const RADAR_LABELS = [
  '長輸入 Prefill 效能',
  '長輸出 Decode 速度',
  '繁體中文語感與耐受度',
  'JSON 格式禮儀與紀律',
  'KV 快取省電度 (低佔用)',
  '商用授權自由度',
  '推理引擎主線成熟度'
];

function radarDatasets() {
  const colors = ['emerald-500', 'indigo-500', 'cyan-500', 'amber-500'];
  const tcScores = { 'S': 98, 'S-': 92, 'A': 88, 'A-': 82, 'B+': 75 };
  return state.radar.selectedModelIds.map(id => getModel(id)).filter(Boolean).map((m, idx) => {
    const c = colors[idx % colors.length];
    // 各軸正規化到 0~100；無資料的軸留空，不畫成 0
    const tcScore = m.tcGrade === '未評' ? null : (tcScores[m.tcGrade] || 65);
    const kvEfficiency = isKnown(m.kvPerTokKB) ? Math.max(10, 100 - (m.kvPerTokKB * 2.2)) : null; // KB 越低越好
    const licenseScore = m.license === 'MIT' ? 100 : m.license === 'Apache 2.0' ? 95 : m.commercialAllowed ? 80 : 50;
    const ecosystemScore = m.engineSupport.includes('Experimental') ? 40 : 95;
    return {
      label: [m.name, !isKnown(m.jsonDisciplineScore) && 'JSON 紀律無資料', m.tcGrade === '未評' && '繁中未評'].filter(Boolean).join('｜'),
      data: [m.speedPrefillScore, m.workloadFit.decode * 20, tcScore, m.jsonDisciplineScore, kvEfficiency, licenseScore, ecosystemScore],
      borderColor: themeColor(c),
      backgroundColor: themeColor(c, 0.22),
      borderWidth: 2,
      pointBackgroundColor: themeColor(c),
      pointRadius: 4,
      spanGaps: true
    };
  });
}

function radarOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: {
        min: 0,
        max: 100,
        angleLines: { color: themeColor('slate-500', 0.28) },
        grid: { color: themeColor('slate-500', 0.28) },
        pointLabels: { color: themeColor('slate-400'), font: { size: 11, weight: 'bold' } },
        ticks: { display: false, stepSize: 20 }
      }
    },
    plugins: {
      legend: { labels: { color: themeColor('slate-100'), font: { size: 12, weight: 'bold' } } }
    }
  };
}

// 圖表只建立一次，之後換模型或換主題都用 update()
async function renderRadarChart() {
  renderRadarToggles();
  const canvas = document.getElementById('radar-chart-canvas');
  if (!canvas) return;
  try {
    await loadChartJs();
  } catch (e) {
    showToast('雷達圖元件載入失敗，請重新整理頁面');
    return;
  }
  const chart = state.radar.chartInstance;
  if (chart) {
    chart.data.datasets = radarDatasets();
    chart.options = radarOptions();
    chart.update();
  } else {
    state.radar.chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: { labels: RADAR_LABELS, datasets: radarDatasets() },
      options: radarOptions()
    });
  }
}

function renderRadarToggles() {
  const togglesContainer = document.getElementById('radar-model-toggles');
  if (!togglesContainer) return;
  togglesContainer.innerHTML = window.MODELS_DATABASE.map(m => {
    const isChecked = state.radar.selectedModelIds.includes(m.id);
    return `
      <label class="p-2.5 rounded-xl border text-xs cursor-pointer flex items-center justify-between transition ${
        isChecked ? 'bg-slate-800 border-emerald-500/50 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-900'
      }">
        <div class="flex items-center gap-2 truncate">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleRadarModel('${m.id}', this)" class="rounded text-emerald-500 focus:ring-emerald-500 bg-slate-900 border-slate-700">
          <span class="font-bold truncate">${m.name}</span>
        </div>
        <span class="text-[11px] font-mono text-slate-500">${m.architecture}</span>
      </label>
    `;
  }).join('');
}

function toggleRadarModel(id, el) {
  const arr = state.radar.selectedModelIds;
  const idx = arr.indexOf(id);
  if (idx >= 0) {
    if (arr.length <= 1) {
      if (el) el.checked = true;
      showToast('請至少保留一款模型進行展示');
      return;
    }
    arr.splice(idx, 1);
  } else {
    if (arr.length >= 4) {
      if (el) el.checked = false;
      showToast('雷達圖最多同時繪製 4 款模型');
      return;
    }
    arr.push(id);
  }
  renderRadarChart();
}

// ----------------------------------------------------
// GB10 實測紀錄（作者單機與雙機）
// ----------------------------------------------------
const BENCH_PLATFORMS = [
  ['all', '全部'],
  ['dual-gb10', '雙機 GB10（TP=2）'],
  ['nvidia-gb10', '單機 GB10']
];

function renderBenchmarks() {
  const container = document.getElementById('bench-container');
  if (!container) return;
  const platform = state.bench.platform;
  const rows = (window.LOCAL_BENCHMARKS || []).filter(b => platform === 'all' || b.platform === platform);
  const asof = (window.DATA_ASOF || {}).local;

  // 依模型分組，模型順序照第一次出現
  const groups = [];
  rows.forEach(b => {
    let g = groups.find(x => x.modelId === b.modelId);
    if (!g) groups.push(g = { modelId: b.modelId, rows: [] });
    g.rows.push(b);
  });

  const aggHtml = b => b.aggregate
    ? Object.entries(b.aggregate).map(([n, v]) => `<span class="whitespace-nowrap">${n} 路 <strong class="text-slate-200">${v}</strong></span>`).join('<br>')
    : fmt(null);

  container.innerHTML = `
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 mb-8 shadow-xl">
      <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <span class="text-xs font-semibold uppercase tracking-wider text-emerald-400">GB10 實測紀錄</span>
          <h2 class="text-xl font-bold text-white mt-1">作者單機與雙機 GB10 的實測成績</h2>
          <p class="text-xs text-slate-400 mt-2 leading-relaxed max-w-3xl">
            雙機是兩台 GB10（DGX Spark 同級）以 ConnectX-7 直連、跨機張量並行（TP=2）。Decode 是單一請求的生成速度，併發欄是 N 路同時請求的合計吞吐，Prefill 是提示處理速度，單位都是 tok/s。
            同一列的數字出自同一套腳本；不同引擎的 token 切法不同，跨引擎只看量級，不要直接相減。${asof ? `最新一筆 ${asof}。` : ''}
          </p>
        </div>
        <div class="flex items-center gap-2 text-xs" role="group" aria-label="平台篩選">
          ${BENCH_PLATFORMS.map(([id, label]) => `
            <button onclick="setBenchPlatform('${id}')" aria-pressed="${platform === id}" class="px-3 py-1.5 rounded-lg border font-medium transition ${
              platform === id ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }">${label}</button>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="space-y-6">
      ${groups.map(g => {
        const m = getModel(g.modelId);
        return `
          <section class="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden" aria-labelledby="bench-${g.modelId}">
            <div class="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h3 id="bench-${g.modelId}" class="text-base font-bold text-white">${m ? m.name : g.modelId}</h3>
              ${m ? `<button onclick="openModelDetailModal('${m.id}')" class="text-xs text-emerald-400 hover:underline">模型詳情 &rarr;</button>` : ''}
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-950 text-slate-400 text-[11px]">
                  <tr>
                    <th scope="col" class="py-2.5 px-4">日期／平台</th>
                    <th scope="col" class="py-2.5 px-4">引擎與權重</th>
                    <th scope="col" class="py-2.5 px-4 text-right">Decode</th>
                    <th scope="col" class="py-2.5 px-4 text-right">併發合計</th>
                    <th scope="col" class="py-2.5 px-4 text-right">Prefill</th>
                    <th scope="col" class="py-2.5 px-4">品質檢查與備註</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/60 align-top">
                  ${g.rows.map(b => `
                    <tr>
                      <td class="py-3 px-4 font-mono whitespace-nowrap">
                        <span class="text-slate-200">${b.date}</span>
                        <span class="block text-[11px] ${b.platform === 'dual-gb10' ? 'text-indigo-300' : 'text-slate-400'}">${b.platform === 'dual-gb10' ? '雙機' : '單機'}・${b.topology}</span>
                      </td>
                      <td class="py-3 px-4">
                        <span class="text-slate-200">${escapeHtml(b.engine)}</span>
                        <span class="block text-[11px] text-slate-400 break-all">${escapeHtml(b.weights)}${b.quantKey ? `（${escapeHtml(b.quantKey)}）` : ''}</span>
                      </td>
                      <td class="py-3 px-4 text-right font-mono text-sm font-bold text-emerald-400 whitespace-nowrap">${fmt(b.decode)}</td>
                      <td class="py-3 px-4 text-right font-mono text-[11px] text-slate-400">${aggHtml(b)}</td>
                      <td class="py-3 px-4 text-right font-mono whitespace-nowrap">${b.prefill ? `<span class="text-cyan-300">${formatNumber(b.prefill.tokPerSec)}</span><span class="block text-[11px] text-slate-500">${formatNumber(b.prefill.promptTokens)} tok 提示</span>` : fmt(null)}</td>
                      <td class="py-3 px-4 text-slate-300 leading-relaxed min-w-[260px]">
                        ${b.quality && b.quality.length ? `<ul class="list-disc pl-4 space-y-0.5">${b.quality.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>` : ''}
                        ${b.notes ? `<p class="text-[11px] text-slate-400 mt-1">${escapeHtml(b.notes)}</p>` : ''}
                        <p class="text-[11px] text-slate-500 mt-1">來源：${/^https?:\/\//.test(b.source) ? `<a href="${escapeHtml(b.source)}" target="_blank" rel="noopener" class="text-emerald-400 hover:underline break-all">${escapeHtml(b.source)}</a>` : escapeHtml(b.source)}</p>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function setBenchPlatform(val) {
  state.bench.platform = val;
  render();
}

// ----------------------------------------------------
// Day 16 Knowledge Base Notes
// ----------------------------------------------------
function renderDay16() {
  const container = document.getElementById('day16-container');
  if (!container) return;

  const data = window.DAY16_METHODOLOGY;

  container.innerHTML = `
    <!-- Hero Banner -->
    <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 rounded-3xl p-8 mb-8 shadow-2xl relative overflow-hidden">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div class="max-w-3xl">
          <div class="flex items-center gap-2 mb-3">
            <span class="px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 inline-block">
              Day 16 核心精華筆記
            </span>
            <a href="${data.articleUrl}" target="_blank" rel="noopener" class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1 hover:bg-emerald-500/30 transition">
              <i data-lucide="newspaper" class="w-3.5 h-3.5"></i> iThome 鐵人賽原文專欄 <i data-lucide="external-link" class="w-3 h-3"></i>
            </a>
          </div>
          <h1 class="text-2xl sm:text-3xl font-black text-white leading-tight mb-3">
            ${data.title}
          </h1>
          <p class="text-sm text-slate-300 leading-relaxed">
            「如果排行榜能回答『我該用哪款』，這個系列可以少寫十天。它不能，原因有三個，而且每一個都在我們自己的數據裡現形過。」
          </p>
        </div>

        <a href="${data.articleUrl}" target="_blank" rel="noopener" class="px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-xl shadow-emerald-950/50 flex items-center justify-center gap-2 transition shrink-0 self-start md:self-center">
          <i data-lucide="book-open" class="w-4 h-4"></i> 前往 iThome 閱讀全文 <i data-lucide="arrow-up-right" class="w-4 h-4"></i>
        </a>
      </div>
    </div>

    <!-- Three Big Myths Grid -->
    <h2 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
      <i data-lucide="circle-alert" class="w-5 h-5 text-amber-400"></i> 為什麼不能只看排行榜？三大迷思現形
    </h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
      ${data.threeMyths.map(m => `
        <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-lg">
          <div>
            <div class="text-xs font-mono font-bold text-amber-400 mb-2 uppercase">迷思 ${m.id}</div>
            <h3 class="text-base font-bold text-white mb-2.5">${m.title}</h3>
            <p class="text-xs text-slate-300 leading-relaxed mb-4">${m.summary}</p>
          </div>
          <div class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs italic text-emerald-300">
            "${m.quote}"
          </div>
        </div>
      `).join('')}
    </div>

    <!-- One-Page Rules Checklist -->
    <div class="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-6 shadow-xl mb-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-white flex items-center gap-2">
          <i data-lucide="clipboard-check" class="w-5 h-5 text-emerald-400"></i> 一頁貼牆清單 (Five-Step Rule)
        </h2>
        <span class="text-xs text-slate-400 font-mono">濃縮貼牆版本</span>
      </div>

      <div class="space-y-3">
        ${data.onePageRules.map(r => `
          <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-3">
            <span class="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-mono font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
              ${r.num}
            </span>
            <div>
              <span class="font-bold text-white text-sm mr-2">${r.topic}：</span>
              <span class="text-xs text-slate-300 leading-relaxed">${r.rule}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ----------------------------------------------------
// Modal Handlers (Detail & Compare Matrix)
// ----------------------------------------------------
function openModelDetailModal(modelId) {
  const model = getModel(modelId);
  if (!model) return;

  const modal = document.getElementById('model-detail-modal');
  const body = document.getElementById('model-detail-body');

  body.innerHTML = `
    <div class="flex items-start justify-between pb-4 border-b border-slate-800">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">${model.family}</span>
          <span class="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300">${model.license}</span>
        </div>
        <h2 id="model-detail-title" class="text-xl font-bold text-white">${model.name}</h2>
      </div>
      <button onclick="closeModal('model-detail-modal')" aria-label="關閉" class="text-slate-400 hover:text-white text-lg p-1">
        <i data-lucide="x" class="w-5 h-5"></i>
      </button>
    </div>

    <div class="py-6 space-y-6 text-xs text-slate-300">
      <!-- Highlight -->
      ${model.day16Role ? `
        <div class="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/40 text-indigo-200 leading-relaxed">
          <strong>Day 16 實測註記：</strong> ${model.day16Role}
        </div>
      ` : ''}

      <!-- Detailed Specs -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <span class="text-slate-500 block text-[11px]">參數量級</span>
          <span class="font-bold text-white text-sm">${fmt(model.paramsTotal, 'B')}</span>
          <span class="text-[11px] text-slate-400 block">啟用: ${fmt(model.paramsActive, 'B')}</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <span class="text-slate-500 block text-[11px]">Arena Coding Elo</span>
          <span class="font-bold text-emerald-400 text-sm font-mono">${fmt(model.arenaCodeElo)}</span>
          <span class="text-[11px] text-slate-400 block">WebDev: ${fmt(model.arenaWebdevElo)}</span>
          <span class="text-[11px] text-slate-400 block">SWE-bench V: ${fmt(model.sweBench, '%')}｜LCB: ${fmt(model.liveCodeBench)}｜HumanEval: ${fmt(model.humanEval, '%')}</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <span class="text-slate-500 block text-[11px]">繁中評級 / 最低位元</span>
          <span class="font-bold text-amber-300 text-sm">${model.tcGrade}</span>
          <span class="text-[11px] text-slate-400 block">${model.tcQuantMinBit}</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <span class="text-slate-500 block text-[11px]">KV Cache 每 Token</span>
          <span class="font-bold text-cyan-300 text-sm font-mono">${fmt(model.kvPerTokKB, ' KB')}</span>
          <span class="text-[11px] text-slate-400 block">考卷: ${fmt(model.examScore)}</span>
        </div>
      </div>

      <!-- Notes Section -->
      <div class="space-y-3">
        <div>
          <h4 class="font-bold text-white mb-1">繁體中文語感與量化特性：</h4>
          <p class="text-slate-300 leading-relaxed">${model.tcQuantNote}</p>
        </div>
        <div>
          <h4 class="font-bold text-white mb-1">JSON 格式遵循與 Agent 紀律：</h4>
          <p class="text-slate-300 leading-relaxed">${model.jsonNote} (評分: ${fmt(model.jsonDisciplineScore, '/100')})</p>
          ${model.jsonRecheckPending ? `<p class="text-amber-300 leading-relaxed mt-1">待重測：${model.jsonRecheckPending}</p>` : ''}
        </div>
        <div>
          <h4 class="font-bold text-white mb-1">解碼速度：</h4>
          <p class="text-slate-300 leading-relaxed">${escapeHtml(model.speedDecodeRating || '無資料')}</p>
          ${benchmarksFor(model.id).length ? `<button onclick="closeModal('model-detail-modal'); setTab('bench')" class="mt-1 text-emerald-400 hover:underline">查看 ${benchmarksFor(model.id).length} 筆 GB10 實測紀錄 &rarr;</button>` : ''}
        </div>
        <div>
          <h4 class="font-bold text-white mb-1">推理引擎與生態支援狀態：</h4>
          <p class="text-slate-300 leading-relaxed">${model.engineNotes}</p>
        </div>
        <div>
          <h4 class="font-bold text-white mb-1">儲存建議：</h4>
          <p class="text-slate-300 leading-relaxed">${model.storageAdvise}</p>
        </div>
        <div>
          <h4 class="font-bold text-white mb-1">資料來源：</h4>
          <div class="text-[11px] leading-relaxed space-y-0.5">${sourcesHtml(model)}</div>
          <p class="text-[11px] text-slate-500 mt-1">${model.editorial || '繁中評級、工作負載適配與 Prefill 分數為編輯評分'}，不是量測值。KV 為 BF16、只計全注意力層，依 config 推導。</p>
        </div>
      </div>

      <!-- Quant profiles table -->
      <div>
        <h4 class="font-bold text-white mb-2">量化規格佔用清單：</h4>
        <div class="overflow-x-auto">
          <table class="w-full text-left font-mono text-xs">
            <thead class="bg-slate-950 text-slate-400">
              <tr>
                <th class="p-2.5">量化版本</th>
                <th class="p-2.5">位元 (bpw)</th>
                <th class="p-2.5">權重體積</th>
                <th class="p-2.5">速度（實測或建議硬體）</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800 font-sans">
              ${Object.entries(model.quantProfiles).map(([k, v]) => `
                <tr>
                  <td class="p-2.5 font-bold text-emerald-400 font-mono">${k}</td>
                  <td class="p-2.5 text-slate-400 font-mono">${fmt(v.bpw)}</td>
                  <td class="p-2.5 text-white font-mono">${fmt(v.sizeGB, ' GB')}</td>
                  <td class="p-2.5 text-slate-300">${fmt(v.recSpeedGpu)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  openModal('model-detail-modal');
}

function openCompareModal() {
  const modal = document.getElementById('compare-modal');
  const body = document.getElementById('compare-modal-body');
  const models = state.leaderboard.selectedCompareIds.map(id => getModel(id)).filter(Boolean);

  if (models.length === 0) {
    showToast('請先在排行榜勾選欲比較的模型');
    return;
  }

  body.innerHTML = `
    <div class="flex items-start justify-between pb-4 border-b border-slate-800">
      <div>
        <span class="text-xs font-semibold text-indigo-400 uppercase">橫向對比矩陣</span>
        <h2 id="compare-modal-title" class="text-xl font-bold text-white">模型全維度 PK (${models.length} 款)</h2>
      </div>
      <button onclick="closeModal('compare-modal')" aria-label="關閉" class="text-slate-400 hover:text-white text-lg p-1">
        <i data-lucide="x" class="w-5 h-5"></i>
      </button>
    </div>

    <div class="py-6 overflow-x-auto">
      <table class="w-full text-left text-xs border-collapse">
        <thead>
          <tr class="border-b border-slate-800">
            <th class="p-3 text-slate-400 font-mono uppercase bg-slate-950 w-36">評比維度</th>
            ${models.map(m => `
              <th class="p-3 text-white font-bold text-sm bg-slate-900 border-l border-slate-800 min-w-[200px]">
                ${m.name}
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800 text-slate-300 font-sans">
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">架構 / 參數量</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono">${m.architecture} (${fmtParams(m)})</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">Arena Coding Elo</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono font-bold text-emerald-400 text-sm">${fmt(m.arenaCodeElo)}</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">Arena WebDev</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono font-bold text-emerald-400">${fmt(m.arenaWebdevElo)}</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">SWE-bench V / LiveCodeBench</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono">${fmt(m.sweBench, '%')} / ${fmt(m.liveCodeBench)}</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">繁中評級 / 量化底線</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-bold text-amber-300">${m.tcGrade} (${m.tcQuantMinBit})</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">JSON 紀律評分</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono font-bold">${fmt(m.jsonDisciplineScore, '/100')}</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">KV 成本 (每 Token)</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono text-cyan-300 font-bold">${fmt(m.kvPerTokKB, ' KB')}</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">解碼速度</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 text-[11px]">${escapeHtml(m.speedDecodeRating || '無資料')}</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">商用授權條款</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono ${m.commercialAllowed ? 'text-emerald-400' : 'text-amber-400'}">${m.license}</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">生態成熟度</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 text-[11px]">${m.engineSupport}</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">Day 16 角色定義</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 text-[11px] text-slate-400 leading-relaxed">${m.day16Role || m.engineNotes}</td>`).join('')}
          </tr>
        </tbody>
      </table>
    </div>
  `;

  openModal('compare-modal');
}

// ----------------------------------------------------
// Modal：Esc 與點背景關閉、焦點鎖在對話框內、關閉後焦點回到原按鈕
// ----------------------------------------------------
let _modalReturnFocus = null;

function focusableIn(el) {
  return [...el.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(x => x.offsetParent !== null);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (!modal.classList.contains('hidden')) {
    renderIcons(modal);
    return;
  }
  _modalReturnFocus = document.activeElement;
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  renderIcons(modal);
  const first = focusableIn(modal)[0];
  if (first) first.focus();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
  if (_modalReturnFocus && document.contains(_modalReturnFocus)) _modalReturnFocus.focus();
  _modalReturnFocus = null;
}

function openModalId() {
  const open = document.querySelector('.app-modal:not(.hidden)');
  return open ? open.id : null;
}

document.addEventListener('keydown', e => {
  const id = openModalId();
  if (!id) return;
  if (e.key === 'Escape') {
    closeModal(id);
    return;
  }
  if (e.key === 'Tab') {
    const items = focusableIn(document.getElementById(id));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

// 點對話框外的背景關閉
document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('app-modal')) closeModal(e.target.id);
});

function copyText(txt) {
  copyToClipboard(txt, '已複製至剪貼簿！');
}

// ----------------------------------------------------
// 莫蘭迪主題（深色／淺色切換）
// ----------------------------------------------------
function themeRGB(token) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--c-${token}`).trim();
  return v || '124 123 114';
}

function themeColor(token, alpha = 1) {
  return `rgba(${themeRGB(token).split(/\s+/).join(', ')}, ${alpha})`;
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme !== 'light');

  try { localStorage.setItem('oms-theme', theme); } catch (e) {}

  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.innerHTML = `<i data-lucide="${theme === 'light' ? 'moon' : 'sun'}" class="w-4 h-4"></i>`;
    const label = theme === 'light' ? '切換為深色莫蘭迪' : '切換為淺色莫蘭迪';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    renderIcons(btn);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', `rgb(${themeRGB('slate-950')})`);

  // 雷達圖的顏色是畫進 canvas 的，換主題要更新
  if (state.radar.chartInstance && state.activeTab === 'radar') renderRadarChart();
}

function toggleTheme() {
  applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
}

// ----------------------------------------------------
// Global Initialization
// ----------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  applyTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  renderIcons();
  // 網址帶 #bench 之類的錨點時直接打開該分頁
  setTab(location.hash.replace('#', '') || 'wizard');
});
