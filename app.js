/**
 * OpenModel Forge - Application Logic
 */

// Application State
const state = {
  activeTab: 'wizard', // 'wizard' | 'canirun' | 'leaderboard' | 'storage' | 'radar' | 'day16'
  
  // Wizard State
  wizard: {
    step: 1,
    answers: {
      workload: 'agent', // 'prefill' | 'decode' | 'agent'
      tcLang: 'yes',     // 'yes' | 'no'
      coexist: 'coexist',// 'dedicated' | 'coexist'
      license: 'commercial', // 'commercial' | 'any'
      ecosystem: 'production' // 'production' | 'experimental'
    },
    filterHistory: []
  },

  // CanIRun State
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
    filterTcGrade: 'all',
    filterDay16Only: false,
    sortBy: 'arenaCodeElo', // 'arenaCodeElo' | 'paramsTotal' | 'jsonDisciplineScore' | 'humanEval'
    sortDesc: true,
    viewMode: 'cards', // 'cards' | 'table'
    selectedCompareIds: ['qwen25-coder-32b', 'ornith-35b-a3b', 'gpt-oss-120b']
  },

  // Storage Advisor State
  storage: {
    selectedModelId: 'qwen25-coder-32b',
    selectedQuant: 'Q8_0',
    systemRamGB: 128,
    loaderType: 'gguf-mmap' // 'gguf-mmap' | 'vllm' | 'ollama'
  },

  // Radar State
  radar: {
    selectedModelIds: ['qwen25-coder-32b', 'ornith-35b-a3b', 'gpt-oss-120b', 'deepseek-r1-moe'],
    chartInstance: null
  }
};

// Utilities
function formatNumber(num) {
  return new Intl.NumberFormat('zh-TW').format(num);
}

function getHardware(id) {
  return window.HARDWARE_PROFILES.find(h => h.id === id) || window.HARDWARE_PROFILES[0];
}

function getModel(id) {
  return window.MODELS_DATABASE.find(m => m.id === id);
}

// ----------------------------------------------------
// WebGPU / WebGL Hardware Auto Detection
// ----------------------------------------------------
async function detectLocalHardware() {
  const detectBtn = document.getElementById('detect-hardware-btn');
  if (detectBtn) detectBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-1"></i> 偵測中...`;

  let info = {
    renderer: '未知 GPU',
    vendor: '未知',
    estimatedVramGB: 16,
    matchedId: 'mac-128'
  };

  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const adapterInfo = await (adapter.requestAdapterInfo ? adapter.requestAdapterInfo() : adapter.info);
        if (adapterInfo) {
          info.vendor = adapterInfo.vendor || 'WebGPU';
          info.renderer = `${adapterInfo.vendor || ''} ${adapterInfo.architecture || adapterInfo.device || 'GPU'}`.trim();
        }
        // Approximate VRAM via buffer limits
        const maxBufferSize = adapter.limits?.maxBufferSize || 0;
        const maxStorage = adapter.limits?.maxStorageBufferBindingSize || 0;
        const estimatedBytes = Math.max(maxBufferSize, maxStorage);
        if (estimatedBytes > 0) {
          // WebGPU buffers are typically 1/2 to 1/4 total VRAM in browsers
          const roughGB = Math.round((estimatedBytes * 2) / (1024 * 1024 * 1024));
          if (roughGB >= 4) info.estimatedVramGB = roughGB;
        }
      }
    } else {
      // WebGL Fallback
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          info.renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'WebGL GPU';
          info.vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'WebGL Vendor';
        }
      }
    }
  } catch (e) {
    console.warn('Hardware detection error:', e);
  }

  // Best match algorithm
  const rendererLow = info.renderer.toLowerCase();
  if (rendererLow.includes('gb10') || rendererLow.includes('grace blackwell') || rendererLow.includes('dgx spark')) {
    info.matchedId = 'nvidia-gb10';
  } else if (rendererLow.includes('gh200') || rendererLow.includes('grace hopper')) {
    info.matchedId = 'nvidia-gh200';
  } else if (rendererLow.includes('apple') || rendererLow.includes('m1') || rendererLow.includes('m2') || rendererLow.includes('m3') || rendererLow.includes('m4')) {
    if (rendererLow.includes('ultra') || rendererLow.includes('128')) info.matchedId = 'mac-128';
    else if (rendererLow.includes('max') || rendererLow.includes('64')) info.matchedId = 'mac-64';
    else if (rendererLow.includes('48')) info.matchedId = 'mac-48';
    else if (rendererLow.includes('36')) info.matchedId = 'mac-36';
    else if (rendererLow.includes('24')) info.matchedId = 'mac-24';
    else info.matchedId = 'mac-16';
  } else if (rendererLow.includes('5090')) {
    info.matchedId = 'rtx-5090-32';
  } else if (rendererLow.includes('5080')) {
    info.matchedId = 'rtx-5080-16';
  } else if (rendererLow.includes('4090') || rendererLow.includes('3090')) {
    info.matchedId = 'rtx-4090-24';
  } else if (rendererLow.includes('4080')) {
    info.matchedId = 'rtx-4080-16';
  } else if (rendererLow.includes('4070')) {
    info.matchedId = 'rtx-4070-12';
  } else if (rendererLow.includes('4060 ti') || rendererLow.includes('4060ti')) {
    info.matchedId = 'rtx-4060ti-16';
  } else if (rendererLow.includes('4060') || rendererLow.includes('3060')) {
    info.matchedId = 'rtx-3060-12';
  } else if (rendererLow.includes('7900')) {
    info.matchedId = 'amd-rx7900xtx';
  } else if (rendererLow.includes('arc') || rendererLow.includes('a770')) {
    info.matchedId = 'intel-arc-a770';
  }

  state.canirun.detectedGpu = info;
  state.canirun.selectedHardwareId = info.matchedId;

  // Show notification
  renderCanIRun();
  showToast(`已偵測硬體: ${info.renderer} (自動適配為 ${getHardware(info.matchedId).name})`);
}

function showToast(msg) {
  const toast = document.getElementById('app-toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
  }, 4000);
}

// ----------------------------------------------------
// 5-Step Selection Wizard Engine (Day 16 Methodology)
// ----------------------------------------------------
function evaluateWizard() {
  const ans = state.wizard.answers;
  let remaining = [...window.MODELS_DATABASE];
  const discarded = [];

  // Step 1: Workload Shape Filter
  if (ans.workload === 'prefill') {
    // Prefill: Dense models (27B/32B/70B) shine; pure MoE without dense prefill are deprioritized
    remaining.forEach(m => {
      if (m.workloadFit.prefill < 4.0) {
        discarded.push({
          model: m,
          step: 1,
          reason: `長輸入短輸出 (Prefill 導向)：${m.name} 為 MoE/非密集架構，Prefill 吞吐效率低於 27B/32B 密集模型。`
        });
      }
    });
    remaining = remaining.filter(m => m.workloadFit.prefill >= 4.0);
  } else if (ans.workload === 'decode') {
    // Decode: MoE with low active params shine (e.g. Ornith 3B, gpt-oss 14B, DeepSeek 37B)
    remaining.forEach(m => {
      if (m.workloadFit.decode < 3.8 && m.architecture === 'Dense' && m.paramsTotal > 20) {
        discarded.push({
          model: m,
          step: 1,
          reason: `短輸入長輸出 (Decode 導向)：${m.name} 為 ${m.paramsTotal}B 密集模型，受頻寬天花板限制，解碼速度慢 (如 8-bit 僅 ~8 t/s)。應選啟用參數量小的 MoE。`
        });
      }
    });
    remaining = remaining.filter(m => !(m.workloadFit.decode < 3.8 && m.architecture === 'Dense' && m.paramsTotal > 20));
  } else if (ans.workload === 'agent') {
    // Agent: Demands Prefill + Decode + JSON Discipline + Low KV Cache
    remaining.forEach(m => {
      if (m.jsonDisciplineScore < 80) {
        discarded.push({
          model: m,
          step: 1,
          reason: `Agent 迴圈：${m.name} 的 JSON 格式遵循紀律評分僅 ${m.jsonDisciplineScore}/100，易在多輪 tool calling 產生格式廢話導致報錯。`
        });
      }
    });
    remaining = remaining.filter(m => m.jsonDisciplineScore >= 80);
  }

  // Step 2: Traditional Chinese Filter
  if (ans.tcLang === 'yes') {
    remaining.forEach(m => {
      if (m.tcGrade === 'B-' || m.tcGrade === 'C') {
        discarded.push({
          model: m,
          step: 2,
          reason: `繁體中文語感：${m.name} 繁中評級為 ${m.tcGrade}，量化後有明顯 1.6~2x 語義折損，未達繁中生產標準。`
        });
      }
    });
    remaining = remaining.filter(m => m.tcGrade !== 'B-' && m.tcGrade !== 'C');
  }

  // Step 3: Memory & Coexistence Filter (based on current hardware in CanIRun)
  const hw = getHardware(state.canirun.selectedHardwareId);
  const maxAllowableGB = ans.coexist === 'coexist' ? (hw.vramGB - state.canirun.reserveCoexistGB) : hw.vramGB;

  remaining.forEach(m => {
    const minQ4Size = m.quantProfiles['Q4_K_M']?.sizeGB || m.quantProfiles['Q8_0']?.sizeGB || 1000;
    if (minQ4Size > hw.vramGB) {
      discarded.push({
        model: m,
        step: 3,
        reason: `記憶體超限：${m.name} 最低實用量化檔需要約 ${minQ4Size} GB，目前配置 (${hw.name}) 無法載入。`
      });
    }
  });
  remaining = remaining.filter(m => {
    const minQ4Size = m.quantProfiles['Q4_K_M']?.sizeGB || m.quantProfiles['Q8_0']?.sizeGB || 1000;
    return minQ4Size <= hw.vramGB;
  });

  // Step 4: License Filter
  if (ans.license === 'commercial') {
    remaining.forEach(m => {
      if (!m.commercialAllowed) {
        discarded.push({
          model: m,
          step: 4,
          reason: `商用授權限制：${m.name} 授權條款 (${m.license}) 限制商業使用或需額外申請，無法直接作為商業交付物。`
        });
      }
    });
    remaining = remaining.filter(m => m.commercialAllowed);
  }

  // Step 5: Ecosystem & Production Readiness
  if (ans.ecosystem === 'production') {
    remaining.forEach(m => {
      if (m.engineSupport.includes('Experimental')) {
        discarded.push({
          model: m,
          step: 5,
          reason: `生態尚未合併：${m.name} 推理引擎支援仍在 PR 階段 (需自編分支)，Day 16 鐵律「實驗品不進生產」。`
        });
      }
    });
    remaining = remaining.filter(m => !m.engineSupport.includes('Experimental'));
  }

  // Score and Rank remaining models according to Day 16 empirical weights
  remaining.sort((a, b) => {
    let aScore = 0;
    let bScore = 0;

    // 1. Workload Alignment (Day 16 Question 1)
    if (ans.workload === 'prefill') {
      // Prefill: Dense 27B/32B/70B get massive boost (200x faster than decode)
      aScore += a.speedPrefillScore * 3.5;
      bScore += b.speedPrefillScore * 3.5;
      if (a.architecture === 'Dense') aScore += 120;
      if (b.architecture === 'Dense') bScore += 120;
    } else if (ans.workload === 'decode') {
      // Decode: MoE with low active params get massive boost (active param throughput)
      aScore += a.workloadFit.decode * 60;
      bScore += b.workloadFit.decode * 60;
      // High bonus for small active params (Ornith 3B, gpt-oss 14B)
      aScore += (100 / Math.max(1, a.paramsActive)) * 12;
      bScore += (100 / Math.max(1, b.paramsActive)) * 12;
      if (a.architecture === 'MoE') aScore += 150;
      if (b.architecture === 'MoE') bScore += 150;
    } else if (ans.workload === 'agent') {
      // Agent loops: JSON discipline + Low KV cache cost + MoE decode throughput
      aScore += a.jsonDisciplineScore * 3.0;
      bScore += b.jsonDisciplineScore * 3.0;
      // Lower KV cost is significantly better (e.g. Ornith 10.56 KB vs 27B 34.5 KB = 3.3x gap)
      aScore += Math.max(0, (40 - a.kvPerTokKB)) * 10;
      bScore += Math.max(0, (40 - b.kvPerTokKB)) * 10;
      aScore += a.workloadFit.agent * 45;
      bScore += b.workloadFit.agent * 45;
      if (a.architecture === 'MoE') aScore += 100;
      if (b.architecture === 'MoE') bScore += 100;
    }

    // 2. Hardware Memory Sizing Fit (Day 16 Question 3)
    // If dedicated on 128GB (GB10 / Mac 128), Ornith BF16 (120GB) is the textbook dedicated match
    if (hw.vramGB >= 120 && ans.coexist === 'dedicated') {
      if (a.id === 'ornith-35b-a3b') aScore += 200;
      if (b.id === 'ornith-35b-a3b') bScore += 200;
    } else if (hw.vramGB >= 120 && ans.coexist === 'coexist') {
      // Coexist on 128GB: Ornith Q8 (38G) or gpt-oss (68G) leave huge headroom
      if (a.id === 'ornith-35b-a3b' || a.id === 'gpt-oss-120b') aScore += 120;
      if (b.id === 'ornith-35b-a3b' || b.id === 'gpt-oss-120b') bScore += 120;
    }

    // 3. License Score (Day 16 Question 4: MIT > Apache > Community)
    if (a.license === 'MIT') aScore += 60;
    if (b.license === 'MIT') bScore += 60;
    if (a.license === 'Apache 2.0') aScore += 45;
    if (b.license === 'Apache 2.0') bScore += 45;

    // 4. Traditional Chinese Grade (Day 16 Question 2)
    if (ans.tcLang === 'yes') {
      const tcWeights = { 'S': 80, 'S-': 70, 'A': 60, 'A-': 55, 'B+': 30, 'B': 10 };
      aScore += (tcWeights[a.tcGrade] || 0);
      bScore += (tcWeights[b.tcGrade] || 0);
    }

    // 5. Day 16 empirical featured bonus
    if (a.isDay16Featured) aScore += 80;
    if (b.isDay16Featured) bScore += 80;

    // 6. Arena Elo (mild weight, preventing leaderboard bias from overruling Day 16 rules)
    aScore += (a.arenaCodeElo - 1200) * 0.3;
    bScore += (b.arenaCodeElo - 1200) * 0.3;

    return bScore - aScore;
  });

  return { remaining, discarded };
}

// ----------------------------------------------------
// CanIRun VRAM & Speed Calculation Formula
// ----------------------------------------------------
function calculateModelRunnability(model, quantKey, hwProfile, contextTokens, reserveGB = 0) {
  const quant = model.quantProfiles[quantKey];
  if (!quant) return null;

  const weightsGB = quant.sizeGB;
  
  // KV Cache calculation:
  // KV cache GB = (2 * layers * kv_heads * head_dim * precision_bytes * contextTokens) / (1024^3)
  // Simplified using accurate model.kvPerTokKB
  const kvCacheGB = (model.kvPerTokKB * contextTokens) / (1024 * 1024);
  
  // CUDA / Metal & Framework Runtime Headroom (2GB base)
  const runtimeHeadroomGB = 2.0;

  const totalRequiredGB = weightsGB + kvCacheGB + runtimeHeadroomGB;
  const availableVramGB = hwProfile.vramGB - reserveGB;

  let status = 'smooth'; // 'smooth' | 'playable' | 'tight' | 'oom'
  let statusText = '🟢 完美暢跑';
  let badgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  let offloadLayers = 0;
  let estimatedDecodeSpeed = '30~50 t/s';

  if (totalRequiredGB <= availableVramGB * 0.85) {
    status = 'smooth';
    statusText = '完美暢跑 (滿載 GPU)';
    badgeColor = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
    estimatedDecodeSpeed = model.architecture === 'MoE' ? '45~75 t/s' : '22~38 t/s';
  } else if (totalRequiredGB <= availableVramGB) {
    status = 'playable';
    statusText = '良好運行 (顯存充裕)';
    badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    estimatedDecodeSpeed = model.architecture === 'MoE' ? '30~50 t/s' : '15~25 t/s';
  } else if (totalRequiredGB <= hwProfile.vramGB + 32) { // Can offload to CPU RAM
    status = 'tight';
    statusText = '部分卸載 CPU (速度變慢)';
    badgeColor = 'bg-orange-500/20 text-orange-300 border-orange-500/40';
    estimatedDecodeSpeed = '3~10 t/s (受限 PCIe/RAM 頻寬)';
  } else {
    status = 'oom';
    statusText = '無法運行 (OOM 顯存爆滿)';
    badgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    estimatedDecodeSpeed = '0 t/s (OOM)';
  }

  return {
    quantKey,
    weightsGB: weightsGB.toFixed(1),
    kvCacheGB: kvCacheGB.toFixed(2),
    totalRequiredGB: totalRequiredGB.toFixed(1),
    availableVramGB: availableVramGB.toFixed(1),
    status,
    statusText,
    badgeColor,
    estimatedDecodeSpeed
  };
}

// ----------------------------------------------------
// UI Rendering Functions
// ----------------------------------------------------

function setTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.className = 'nav-tab-btn px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-lg shadow-emerald-950/40 flex items-center gap-2';
    } else {
      btn.className = 'nav-tab-btn px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent flex items-center gap-2';
    }
  });

  document.querySelectorAll('.tab-content-panel').forEach(panel => {
    if (panel.id === `tab-content-${tabName}`) {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  });

  if (tabName === 'radar') renderRadarChart();
  if (tabName === 'canirun') renderCanIRun();
  if (tabName === 'wizard') renderWizard();
  if (tabName === 'leaderboard') renderLeaderboard();
  if (tabName === 'storage') renderStorageAdvisor();
  if (tabName === 'day16') renderDay16();

  if (window.lucide) lucide.createIcons();
}

// Render 5-Step Wizard
function renderWizard() {
  const container = document.getElementById('wizard-container');
  if (!container) return;

  const hw = getHardware(state.canirun.selectedHardwareId);
  const { remaining, discarded } = evaluateWizard();
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
            <span class="text-xs text-slate-400">目前生效：<strong class="text-white">${hw.name}</strong></span>
          </div>
          <p class="text-xs text-slate-300 mt-1">
            進入後請先選取您的目標硬體規格。所有模型淘汰規則、顯存佔用、KV Cache 算力與首選推薦皆以此即時運算。
          </p>
        </div>

        <button onclick="detectLocalHardware()" class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 font-bold text-xs flex items-center gap-1.5 transition shrink-0 self-start md:self-auto">
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
            { id: 'mac-128', label: 'Apple M4/M2 (128GB)' },
            { id: 'rtx-4090-24', label: 'RTX 4090 (24GB)' },
            { id: 'rtx-5090-32', label: 'RTX 5090 (32GB)' },
            { id: 'rtx-4070-12', label: 'RTX 4070 (12GB)' },
            { id: 'mac-64', label: 'Apple Mac (64GB)' }
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
          <select onchange="setGlobalHardware(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs font-medium focus:ring-1 focus:ring-emerald-500 focus:outline-none">
            <optgroup label="AI 超級晶片 / 工作站 (Grace Blackwell & Grace Hopper)">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'superchip').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
            <optgroup label="Apple Silicon (統一記憶體)">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'apple').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name} (${h.vramGB}GB Unified)</option>
              `).join('')}
            </optgroup>
            <optgroup label="NVIDIA 獨立顯卡 (VRAM)">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'nvidia').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
            <optgroup label="AMD & Intel 獨立顯卡">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'amd' || h.type === 'intel').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
            <optgroup label="企業級加速卡 / 專業卡">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'enterprise').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
            <optgroup label="純 CPU + 系統記憶體">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'cpu').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
          </select>
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
          <div class="text-2xl font-black text-emerald-400 font-mono">${remaining.length} <span class="text-xs text-slate-400 font-normal">/ ${window.MODELS_DATABASE.length} 顆</span></div>
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
              ${currentStep > s.num ? '<i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-400"></i>' : ''}
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
              <span class="flex items-center gap-1.5"><i data-lucide="filter-x" class="w-4 h-4"></i> 已被淘汰的模型 (${discarded.length} 顆)</span>
              <span class="text-slate-500">五問刪去法</span>
            </div>
            <div class="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
              ${discarded.map(d => `
                <div class="p-2.5 rounded-lg bg-slate-950/80 border border-rose-900/20 flex flex-col gap-1">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-slate-200">${d.model.name}</span>
                    <span class="font-mono text-rose-400 text-[10px] px-1.5 py-0.5 rounded bg-rose-950/40 border border-rose-900/50">淘汰於 Q${d.step}</span>
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
            <span class="text-xs text-slate-400">目前硬體：<span class="text-emerald-300 font-bold">${getHardware(state.canirun.selectedHardwareId).name}</span></span>
          </div>

          ${remaining.length === 0 ? `
            <div class="py-12 text-center text-slate-400">
              <i data-lucide="alert-triangle" class="w-12 h-12 mx-auto text-amber-400 mb-3"></i>
              <h3 class="text-lg font-bold text-white mb-1">條件過於嚴苛，無存活模型</h3>
              <p class="text-xs max-w-sm mx-auto text-slate-400">建議放寬硬體顯存限制（選擇更高規格顯卡）或允許非商用/實驗性生態。</p>
            </div>
          ` : `
            <!-- Top Pick Champion -->
            ${(() => {
              const champion = remaining[0];
              const quantKey = ans.tcLang === 'yes' ? (champion.quantProfiles['Q8_0'] ? 'Q8_0' : 'Q4_K_M') : 'Q4_K_M';
              const quant = champion.quantProfiles[quantKey] || Object.values(champion.quantProfiles)[0];

              return `
                <div class="mb-6">
                  <div class="text-xs font-mono text-emerald-400 uppercase tracking-wider mb-1">首選推薦 CHAMPION PICK</div>
                  <h3 class="text-2xl font-black text-white flex items-center gap-2">
                    ${champion.name}
                    ${champion.isDay16Featured ? '<span class="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-normal">Day 16 實測標竿</span>' : ''}
                  </h3>
                  <p class="text-xs text-slate-300 mt-1.5 leading-relaxed">${champion.day16Role || champion.engineNotes}</p>
                </div>

                <!-- Specs Grid -->
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6 text-xs">
                  <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <span class="text-slate-400 block text-[11px]">架構類型</span>
                    <span class="font-bold text-white text-sm">${champion.architecture}</span>
                    <span class="text-[10px] text-slate-400 block">啟用 ${champion.paramsActive}B / 總 ${champion.paramsTotal}B</span>
                  </div>
                  <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <span class="text-slate-400 block text-[11px]">Arena Coding Elo</span>
                    <span class="font-bold text-emerald-400 text-sm font-mono">${champion.arenaCodeElo}</span>
                    <span class="text-[10px] text-slate-400 block">HumanEval: ${champion.humanEval}%</span>
                  </div>
                  <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <span class="text-slate-400 block text-[11px]">繁中評級 / 量化底線</span>
                    <span class="font-bold text-amber-300 text-sm">${champion.tcGrade} 級</span>
                    <span class="text-[10px] text-slate-400 block">${champion.tcQuantMinBit}</span>
                  </div>
                  <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <span class="text-slate-400 block text-[11px]">KV 每 Token 成本</span>
                    <span class="font-bold text-cyan-300 text-sm font-mono">${champion.kvPerTokKB} KB</span>
                    <span class="text-[10px] text-slate-400 block">16k Cache: ~${((champion.kvPerTokKB * 16384)/1048576).toFixed(1)} GB</span>
                  </div>
                </div>

                <!-- Deployment & Startup Command Generator -->
                <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs mb-6">
                  <div class="flex items-center justify-between text-slate-400 mb-2 font-sans font-semibold">
                    <span class="flex items-center gap-1.5 text-emerald-400"><i data-lucide="terminal" class="w-3.5 h-3.5"></i> 推薦啟動指令 (llama.cpp / Ollama)</span>
                    <button onclick="copyStartupCmd('${champion.id}')" class="hover:text-white transition text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                      複製指令
                    </button>
                  </div>
                  <div class="text-slate-300 overflow-x-auto p-2 rounded bg-slate-900/90 select-all leading-relaxed" id="startup-cmd-box">
                    ./llama-server -m models/${champion.id}.${quantKey}.gguf -c 16384 -ngl 99 --port 8080 --host 0.0.0.0
                  </div>
                  <div class="text-[11px] text-slate-400 mt-2 font-sans">
                    <span class="text-slate-300">建議量化檔：</span><strong class="text-emerald-400">${quantKey}</strong> (${quant.sizeGB} GB) ｜ ${champion.tcQuantNote}
                  </div>
                </div>

                <!-- Other Alternate Options -->
                ${remaining.length > 1 ? `
                  <div>
                    <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">其他備選方案 (${remaining.length - 1} 顆)</span>
                    <div class="space-y-2">
                      ${remaining.slice(1, 4).map(alt => `
                        <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs hover:border-slate-700 transition">
                          <div>
                            <span class="font-bold text-white text-sm">${alt.name}</span>
                            <span class="text-slate-400 block text-[11px]">${alt.architecture} (${alt.paramsTotal}B) ｜ 授權: ${alt.license} ｜ JSON 紀律: ${alt.jsonDisciplineScore}/100</span>
                          </div>
                          <div class="text-right">
                            <span class="text-emerald-400 font-mono font-bold">${alt.arenaCodeElo} Elo</span>
                            <span class="text-[10px] text-slate-400 block">繁中 ${alt.tcGrade}</span>
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
            <a href="${DAY16_METHODOLOGY.examRepo}" target="_blank" class="inline-flex items-center gap-1.5 mt-2.5 text-indigo-300 font-semibold hover:underline">
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
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">首選密集 27B/32B</span>
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
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">首選小啟用量 MoE</span>
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
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">全能要求型</span>
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
          一顆模型的真實佔用是<strong>權重 + KV 快取 + 留給別人的餘裕</strong>。KV 每 token 成本差距可達 3.3 倍。
        </p>

        <div class="space-y-3">
          <label class="block p-4 rounded-xl border cursor-pointer transition ${ans.coexist === 'coexist' ? 'bg-emerald-950/40 border-emerald-500 text-white' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800'}">
            <div class="flex items-start gap-3">
              <input type="radio" name="coexist" value="coexist" ${ans.coexist === 'coexist' ? 'checked' : ''} onchange="setWizardAnswer('coexist', 'coexist')" class="mt-1 text-emerald-500 focus:ring-emerald-500">
              <div>
                <div class="font-bold text-sm flex items-center gap-2">
                  共存型 (多功能工作站 / 生產集群)
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">推薦</span>
                </div>
                <div class="text-xs text-slate-400 mt-1">
                  模型只是機器上的服務之一。保留餘裕給 ComfyUI 繪圖、第二顆小模型或日常開發。選 27B/32B 量化檔或 gpt-oss MXFP4。
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
                  整台機器只為這一顆模型服務（如 Ornith BF16 120GB 峰值），效能與上下文拉滿，其他服務讓路。
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
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">穩定首選</span>
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
  renderWizard();
  if (window.lucide) lucide.createIcons();
}

function setWizardAnswer(key, val) {
  state.wizard.answers[key] = val;
  renderWizard();
  if (window.lucide) lucide.createIcons();
}

function copyStartupCmd(modelId) {
  const model = getModel(modelId);
  const quantKey = state.wizard.answers.tcLang === 'yes' ? (model.quantProfiles['Q8_0'] ? 'Q8_0' : 'Q4_K_M') : 'Q4_K_M';
  const cmd = `./llama-server -m models/${model.id}.${quantKey}.gguf -c 16384 -ngl 99 --port 8080 --host 0.0.0.0`;
  navigator.clipboard.writeText(cmd);
  showToast('已複製啟動指令至剪貼簿！');
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
  const query = state.canirun.searchQuery.toLowerCase();

  let models = window.MODELS_DATABASE.filter(m => {
    if (filterArch !== 'all' && m.architecture !== filterArch) return false;
    if (query && !m.name.toLowerCase().includes(query) && !m.family.toLowerCase().includes(query)) return false;
    return true;
  });

  container.innerHTML = `
    <!-- Top Hardware Selector & Config Card -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 mb-8 backdrop-blur-md shadow-xl">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-emerald-400">CanIRun.ai 算力與顯存模擬</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300 border border-slate-700">Client-side WebGPU Ready</span>
          </div>
          <h2 class="text-xl font-bold text-white mt-1">硬體相容度與推理速度實測試算</h2>
        </div>

        <button id="detect-hardware-btn" onclick="detectLocalHardware()" class="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-950/50 flex items-center gap-2 transition self-start lg:self-auto">
          <i data-lucide="cpu" class="w-4 h-4"></i> 自動偵測本機硬體 (WebGPU)
        </button>
      </div>

      <!-- Controls Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 text-xs">
        
        <!-- 1. Hardware Select -->
        <div>
          <label class="block font-semibold text-slate-300 mb-2">選擇測試硬體平台：</label>
          <select onchange="setCanIRunHardware(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-medium text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none">
            <optgroup label="AI 超級晶片 / 工作站 (Grace Blackwell & Grace Hopper)">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'superchip').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
            <optgroup label="Apple Silicon (統一記憶體)">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'apple').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name} (${h.vramGB}GB Unified)</option>
              `).join('')}
            </optgroup>
            <optgroup label="NVIDIA 獨立顯卡 (VRAM)">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'nvidia').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
            <optgroup label="AMD & Intel 獨立顯卡">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'amd' || h.type === 'intel').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
            <optgroup label="企業級加速卡 / 專業卡">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'enterprise').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
            <optgroup label="純 CPU + 系統記憶體">
              ${window.HARDWARE_PROFILES.filter(h => h.type === 'cpu').map(h => `
                <option value="${h.id}" ${h.id === hw.id ? 'selected' : ''}>${h.name}</option>
              `).join('')}
            </optgroup>
          </select>
          <span class="text-[11px] text-slate-400 mt-1.5 block">${hw.description}</span>
        </div>

        <!-- 2. Context Length Slider -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="font-semibold text-slate-300">上下文長度 (Context Length)：</label>
            <span class="font-mono font-bold text-emerald-400">${(ctx / 1024).toFixed(0)}k (${formatNumber(ctx)} tok)</span>
          </div>
          <input type="range" min="2048" max="131072" step="2048" value="${ctx}" oninput="setCanIRunContext(this.value)" class="w-full accent-emerald-400 cursor-pointer">
          <div class="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
            <span>2k</span>
            <span>16k (標準)</span>
            <span>64k</span>
            <span>128k (極限)</span>
          </div>
        </div>

        <!-- 3. Coexistence Headroom -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="font-semibold text-slate-300">保留餘裕 (ComfyUI / 系統)：</label>
            <span class="font-mono font-bold text-cyan-400">${reserveGB} GB</span>
          </div>
          <input type="range" min="0" max="48" step="4" value="${reserveGB}" oninput="setCanIRunReserve(this.value)" class="w-full accent-cyan-400 cursor-pointer">
          <div class="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
            <span>0G (獨佔)</span>
            <span>16G (共存標準)</span>
            <span>32G</span>
            <span>48G</span>
          </div>
        </div>

      </div>

      <!-- Quick Summary Status Bar -->
      <div class="mt-6 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div class="flex items-center gap-4 text-slate-300">
          <span>總記憶體/顯存: <strong class="text-white">${hw.vramGB} GB</strong></span>
          <span>可用淨顯存: <strong class="text-emerald-400">${Math.max(0, hw.vramGB - reserveGB)} GB</strong></span>
          <span>記憶體頻寬: <strong class="text-cyan-400">${hw.memBandwidthGBs} GB/s</strong></span>
        </div>
        <div class="flex items-center gap-3 text-[11px] font-sans">
          <span class="inline-flex items-center gap-1 text-emerald-400"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> 完美暢跑</span>
          <span class="inline-flex items-center gap-1 text-amber-400"><span class="w-2 h-2 rounded-full bg-amber-400"></span> 良好運行</span>
          <span class="inline-flex items-center gap-1 text-orange-400"><span class="w-2 h-2 rounded-full bg-orange-400"></span> CPU卸載/慢</span>
          <span class="inline-flex items-center gap-1 text-rose-400"><span class="w-2 h-2 rounded-full bg-rose-400"></span> OOM爆顯存</span>
        </div>
      </div>
    </div>

    <!-- Filter & Search Bar -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
      <div class="relative w-full sm:w-72">
        <i data-lucide="search" class="w-4 h-4 absolute left-3 top-3 text-slate-500"></i>
        <input type="text" placeholder="搜尋模型 (如 Qwen, Ornith, DeepSeek)..." value="${state.canirun.searchQuery}" oninput="setCanIRunSearch(this.value)" class="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500">
      </div>

      <div class="flex items-center gap-2 self-end sm:self-auto text-xs">
        <span class="text-slate-400">架構篩選:</span>
        ${['all', 'Dense', 'MoE'].map(arch => `
          <button onclick="setCanIRunArchFilter('${arch}')" class="px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
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
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      ${models.map(model => renderCanIRunModelCard(model, hw, ctx, reserveGB)).join('')}
    </div>
  `;
}

function renderCanIRunModelCard(model, hw, ctx, reserveGB) {
  // Best recommended quant for this hardware
  const quantKeys = Object.keys(model.quantProfiles);
  
  // Find best quant that fits
  let bestFitQuantKey = quantKeys[0];
  for (let k of quantKeys) {
    const res = calculateModelRunnability(model, k, hw, ctx, reserveGB);
    if (res.status === 'smooth' || res.status === 'playable') {
      bestFitQuantKey = k;
      break;
    }
  }

  const primaryResult = calculateModelRunnability(model, bestFitQuantKey, hw, ctx, reserveGB);

  return `
    <div class="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 shadow-lg transition duration-200 flex flex-col justify-between backdrop-blur-sm">
      <div>
        <!-- Header -->
        <div class="flex items-start justify-between gap-2 mb-3">
          <div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold ${model.architecture === 'MoE' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800 text-slate-300 border border-slate-700'}">
                ${model.architecture} ${model.paramsActive !== model.paramsTotal ? `(${model.paramsActive}B 啟用 / ${model.paramsTotal}B 總量)` : `${model.paramsTotal}B`}
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700 font-mono">${model.license}</span>
            </div>
            <h3 class="text-base font-bold text-white mt-1.5">${model.name}</h3>
          </div>
          <span class="px-2.5 py-1 rounded-lg text-xs font-bold font-mono border shrink-0 ${primaryResult.badgeColor}">
            ${primaryResult.statusText.split(' ')[0]} ${bestFitQuantKey}
          </span>
        </div>

        <!-- Status Summary Banner -->
        <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 mb-4">
          <div class="flex items-center justify-between text-xs mb-1.5">
            <span class="text-slate-400">推薦量化檔位：<strong class="text-emerald-400 font-mono">${bestFitQuantKey}</strong></span>
            <span class="text-slate-300 font-mono font-bold">${primaryResult.totalRequiredGB} GB <span class="text-slate-500 font-normal">/ ${hw.vramGB} GB</span></span>
          </div>
          
          <!-- Memory Progress Bar -->
          <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex mb-2">
            <div class="bg-emerald-500 h-full" style="width: ${Math.min(100, (primaryResult.weightsGB / hw.vramGB) * 100)}%" title="模型權重: ${primaryResult.weightsGB} GB"></div>
            <div class="bg-cyan-400 h-full" style="width: ${Math.min(100, (primaryResult.kvCacheGB / hw.vramGB) * 100)}%" title="KV 快取: ${primaryResult.kvCacheGB} GB"></div>
            <div class="bg-purple-500 h-full" style="width: ${Math.min(100, (2.0 / hw.vramGB) * 100)}%" title="CUDA 執行期: 2.0 GB"></div>
          </div>

          <div class="grid grid-cols-3 gap-1 text-[10px] text-slate-400 font-mono">
            <div>權重: <span class="text-emerald-400">${primaryResult.weightsGB}G</span></div>
            <div>KV 快取: <span class="text-cyan-400">${primaryResult.kvCacheGB}G</span></div>
            <div>預估速度: <span class="text-amber-300">${primaryResult.estimatedDecodeSpeed}</span></div>
          </div>
        </div>

        <!-- All Quant Profiles Comparison -->
        <div class="space-y-1.5 mb-4">
          <span class="text-[11px] font-semibold text-slate-400 block">各量化版本佔用與速度：</span>
          <div class="grid grid-cols-3 gap-1.5 text-xs">
            ${quantKeys.map(k => {
              const res = calculateModelRunnability(model, k, hw, ctx, reserveGB);
              return `
                <div class="p-2 rounded-lg border text-center font-mono ${res.badgeColor}">
                  <div class="font-bold text-[11px]">${k}</div>
                  <div class="text-[10px] opacity-80">${res.weightsGB} GB</div>
                </div>
              `;
            }).join('')}
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

function setGlobalHardware(hwId) {
  state.canirun.selectedHardwareId = hwId;
  const hw = getHardware(hwId);
  renderWizard();
  if (state.activeTab === 'canirun') renderCanIRun();
  showToast(`已切換目標硬體為：${hw.name}`);
}

function setCanIRunHardware(hwId) {
  state.canirun.selectedHardwareId = hwId;
  renderCanIRun();
  if (state.activeTab === 'wizard') renderWizard();
}

function setCanIRunContext(val) {
  state.canirun.contextLength = parseInt(val, 10);
  renderCanIRun();
}

function setCanIRunReserve(val) {
  state.canirun.reserveCoexistGB = parseInt(val, 10);
  renderCanIRun();
}

function setCanIRunSearch(val) {
  state.canirun.searchQuery = val;
  renderCanIRun();
}

function setCanIRunArchFilter(val) {
  state.canirun.filterArchitecture = val;
  renderCanIRun();
}

// ----------------------------------------------------
// Arena.ai Coding Leaderboard & Matrix
// ----------------------------------------------------
function renderLeaderboard() {
  const container = document.getElementById('leaderboard-container');
  if (!container) return;

  const lb = state.leaderboard;
  let models = [...window.MODELS_DATABASE];

  // Filters
  if (lb.filterArch !== 'all') models = models.filter(m => m.architecture === lb.filterArch);
  if (lb.filterLicense !== 'all') {
    if (lb.filterLicense === 'commercial') models = models.filter(m => m.commercialAllowed);
    else if (lb.filterLicense === 'apache-mit') models = models.filter(m => m.license === 'Apache 2.0' || m.license === 'MIT');
  }
  if (lb.filterTcGrade !== 'all') models = models.filter(m => m.tcGrade.startsWith(lb.filterTcGrade));
  if (lb.filterDay16Only) models = models.filter(m => m.isDay16Featured);
  if (lb.searchQuery) {
    const q = lb.searchQuery.toLowerCase();
    models = models.filter(m => m.name.toLowerCase().includes(q) || m.family.toLowerCase().includes(q));
  }

  // Sort
  models.sort((a, b) => {
    let valA = a[lb.sortBy];
    let valB = b[lb.sortBy];
    return lb.sortDesc ? (valB - valA) : (valA - valB);
  });

  container.innerHTML = `
    <!-- Top Filter Bar -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 mb-8 backdrop-blur-md shadow-xl">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-emerald-400">Arena.ai Coding 天梯榜</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">Coding Elo & 實測維度整合</span>
          </div>
          <h2 class="text-xl font-bold text-white mt-1">開放權重程式碼模型競技場排行榜</h2>
        </div>

        <!-- Compare Action Button -->
        <button onclick="openCompareModal()" class="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-950/50 flex items-center gap-2 transition self-start lg:self-auto">
          <i data-lucide="columns-3" class="w-4 h-4"></i> 橫向對比矩陣 (<span id="compare-count">${lb.selectedCompareIds.length}</span> 顆)
        </button>
      </div>

      <!-- Filter Controls Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-6 text-xs">
        
        <!-- Search -->
        <div>
          <label class="block font-semibold text-slate-300 mb-1.5">搜尋模型名稱：</label>
          <input type="text" placeholder="關鍵字搜尋..." value="${lb.searchQuery}" oninput="setLeaderboardSearch(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500">
        </div>

        <!-- Architecture -->
        <div>
          <label class="block font-semibold text-slate-300 mb-1.5">架構 (Architecture)：</label>
          <select onchange="setLeaderboardFilter('filterArch', this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
            <option value="all" ${lb.filterArch === 'all' ? 'selected' : ''}>全部架構 (Dense + MoE)</option>
            <option value="Dense" ${lb.filterArch === 'Dense' ? 'selected' : ''}>密集模型 (Dense)</option>
            <option value="MoE" ${lb.filterArch === 'MoE' ? 'selected' : ''}>混合專家 (MoE)</option>
          </select>
        </div>

        <!-- License Filter -->
        <div>
          <label class="block font-semibold text-slate-300 mb-1.5">授權要求 (License)：</label>
          <select onchange="setLeaderboardFilter('filterLicense', this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
            <option value="all" ${lb.filterLicense === 'all' ? 'selected' : ''}>全部授權</option>
            <option value="commercial" ${lb.filterLicense === 'commercial' ? 'selected' : ''}>允許商用 (Commercial Ready)</option>
            <option value="apache-mit" ${lb.filterLicense === 'apache-mit' ? 'selected' : ''}>Apache 2.0 / MIT 寬鬆授權</option>
          </select>
        </div>

        <!-- Sort By -->
        <div>
          <label class="block font-semibold text-slate-300 mb-1.5">排序依據 (Sort By)：</label>
          <select onchange="setLeaderboardSort(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500">
            <option value="arenaCodeElo" ${lb.sortBy === 'arenaCodeElo' ? 'selected' : ''}>Arena Coding Elo (高到低)</option>
            <option value="humanEval" ${lb.sortBy === 'humanEval' ? 'selected' : ''}>HumanEval 正確率</option>
            <option value="jsonDisciplineScore" ${lb.sortBy === 'jsonDisciplineScore' ? 'selected' : ''}>JSON 格式禮儀評分</option>
            <option value="paramsTotal" ${lb.sortBy === 'paramsTotal' ? 'selected' : ''}>總參數量 (Params)</option>
          </select>
        </div>

      </div>

      <!-- Quick Toggles -->
      <div class="mt-4 flex items-center gap-4 text-xs">
        <label class="flex items-center gap-2 cursor-pointer text-slate-300 select-none">
          <input type="checkbox" ${lb.filterDay16Only ? 'checked' : ''} onchange="toggleLeaderboardDay16Only(this.checked)" class="rounded text-emerald-500 focus:ring-emerald-500 bg-slate-950 border-slate-700">
          <span>只顯示 Day 16 系列實測標竿模型</span>
        </label>
      </div>
    </div>

    <!-- Leaderboard Table -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-950 text-slate-400 uppercase font-mono text-[11px] border-b border-slate-800">
            <tr>
              <th class="py-3.5 px-4">對比</th>
              <th class="py-3.5 px-4">排名 / 模型名稱</th>
              <th class="py-3.5 px-4 text-center">Arena Coding Elo</th>
              <th class="py-3.5 px-4 text-center">架構 / 參數</th>
              <th class="py-3.5 px-4 text-center">繁中評級</th>
              <th class="py-3.5 px-4 text-center">JSON 紀律</th>
              <th class="py-3.5 px-4 text-center">KV 每 Token</th>
              <th class="py-3.5 px-4">授權 (License)</th>
              <th class="py-3.5 px-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60 font-sans">
            ${models.map((model, idx) => {
              const isChecked = lb.selectedCompareIds.includes(model.id);
              return `
                <tr class="hover:bg-slate-800/40 transition">
                  <td class="py-3.5 px-4">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleCompareSelection('${model.id}')" class="rounded text-indigo-500 focus:ring-indigo-500 bg-slate-950 border-slate-700 cursor-pointer">
                  </td>
                  <td class="py-3.5 px-4">
                    <div class="flex items-center gap-2">
                      <span class="font-mono font-bold text-slate-500 text-xs w-5">#${idx + 1}</span>
                      <div>
                        <div class="font-bold text-white flex items-center gap-1.5">
                          ${model.name}
                          ${model.isDay16Featured ? '<span class="px-1.5 py-0.5 rounded text-[9px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Day 16</span>' : ''}
                        </div>
                        <div class="text-[11px] text-slate-400 font-mono">${model.family} ｜ 上下文: ${(model.contextWindow / 1024).toFixed(0)}k</div>
                      </div>
                    </div>
                  </td>
                  <td class="py-3.5 px-4 text-center font-mono">
                    <span class="font-black text-emerald-400 text-sm">${model.arenaCodeElo}</span>
                    <span class="block text-[10px] text-slate-400">HumanEval: ${model.humanEval}%</span>
                  </td>
                  <td class="py-3.5 px-4 text-center font-mono">
                    <span class="px-2 py-0.5 rounded text-[11px] font-bold ${model.architecture === 'MoE' ? 'bg-purple-500/20 text-purple-300' : 'bg-slate-800 text-slate-300'}">
                      ${model.architecture}
                    </span>
                    <span class="block text-[10px] text-slate-400 mt-0.5">${model.paramsActive !== model.paramsTotal ? `${model.paramsActive}B / ${model.paramsTotal}B` : `${model.paramsTotal}B`}</span>
                  </td>
                  <td class="py-3.5 px-4 text-center">
                    <span class="font-bold text-amber-300 text-xs">${model.tcGrade}</span>
                    <span class="block text-[10px] text-slate-400">${model.tcQuantMinBit}</span>
                  </td>
                  <td class="py-3.5 px-4 text-center font-mono">
                    <div class="inline-flex items-center gap-1">
                      <span class="font-bold text-slate-200">${model.jsonDisciplineScore}</span>
                      <span class="text-[10px] text-slate-500">/100</span>
                    </div>
                  </td>
                  <td class="py-3.5 px-4 text-center font-mono text-cyan-300">
                    ${model.kvPerTokKB} KB
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
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function setLeaderboardSearch(val) {
  state.leaderboard.searchQuery = val;
  renderLeaderboard();
}

function setLeaderboardFilter(key, val) {
  state.leaderboard[key] = val;
  renderLeaderboard();
}

function setLeaderboardSort(val) {
  state.leaderboard.sortBy = val;
  renderLeaderboard();
}

function toggleLeaderboardDay16Only(val) {
  state.leaderboard.filterDay16Only = val;
  renderLeaderboard();
}

function toggleCompareSelection(id) {
  const arr = state.leaderboard.selectedCompareIds;
  const idx = arr.indexOf(id);
  if (idx >= 0) {
    arr.splice(idx, 1);
  } else {
    if (arr.length >= 4) {
      showToast('最多同時對比 4 顆模型');
      return;
    }
    arr.push(id);
  }
  renderLeaderboard();
}

// ----------------------------------------------------
// Storage & I/O Advisor (SSD vs NAS)
// ----------------------------------------------------
function renderStorageAdvisor() {
  const container = document.getElementById('storage-container');
  if (!container) return;

  const model = getModel(state.storage.selectedModelId);
  const quantKey = state.storage.selectedQuant;
  const quant = model.quantProfiles[quantKey] || Object.values(model.quantProfiles)[0];
  const ramGB = state.storage.systemRamGB;
  const loader = state.storage.loaderType;

  const modelSizeGB = quant.sizeGB;
  const fitsInRam = modelSizeGB <= ramGB * 0.8; // 留 20% 給系統

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
          <label class="block font-semibold text-slate-300 mb-2">選擇欲評估模型：</label>
          <select onchange="setStorageModel(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500">
            ${window.MODELS_DATABASE.map(m => `
              <option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>${m.name}</option>
            `).join('')}
          </select>
        </div>

        <div>
          <label class="block font-semibold text-slate-300 mb-2">選擇量化規格：</label>
          <select onchange="setStorageQuant(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500">
            ${Object.keys(model.quantProfiles).map(k => `
              <option value="${k}" ${k === quantKey ? 'selected' : ''}>${k} (${model.quantProfiles[k].sizeGB} GB)</option>
            `).join('')}
          </select>
        </div>

        <div>
          <label class="block font-semibold text-slate-300 mb-2">推理 Loader 類型：</label>
          <select onchange="setStorageLoader(this.value)" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500">
            <option value="gguf-mmap" ${loader === 'gguf-mmap' ? 'selected' : ''}>llama.cpp / Ollama (GGUF mmap 磁碟依賴 73%)</option>
            <option value="vllm" ${loader === 'vllm' ? 'selected' : ''}>vLLM / HuggingFace Safetensors (磁碟依賴 3%)</option>
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
            <strong>放得進記憶體：</strong> 模型檔 (${modelSizeGB} GB) 完全可由實體記憶體容量容納。放置於 <strong>NAS 網路集中庫</strong> 的代價僅為冷啟動時多花 10~20 秒的一次回傳成本，載入後推論零效能損失。
          ` : `
            <strong>放不進記憶體：</strong> 絕不要放 NAS！執行中每一次頁面回收 (Page Reclaim) 再讀取都走網路 I/O，實測總載入慢 <strong>3.8 倍</strong>，連純 CPU 階段都被拖垮。<strong>必須存放於本機高速 NVMe SSD！</strong>
          `}
        </div>

        <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400">
          模型大小: <span class="text-white">${modelSizeGB} GB</span> ｜ 系統可用 RAM: <span class="text-emerald-400">${(ramGB * 0.8).toFixed(1)} GB</span>
        </div>
      </div>

      <!-- Question 2: Loader Disk Dependency -->
      <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs font-bold font-mono text-cyan-400">第二問：你的 loader 吃儲存速度嗎？</span>
          <span class="text-xs px-2.5 py-1 rounded-full font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            ${loader === 'gguf-mmap' ? 'mmap 實力 73%' : 'vLLM 實力 3%'}
          </span>
        </div>

        <div class="text-xs text-slate-300 leading-relaxed mb-4">
          ${loader === 'gguf-mmap' ? `
            <strong>GGUF mmap 機制：</strong> 磁碟實力與載入速度同數量級（高達 73% 相關）。升級至 PCIe 4.0/5.0 NVMe SSD 將直接體現在模型秒開啟動上！
          ` : `
            <strong>vLLM / Safetensors 重構：</strong> 權重位元組除以載入秒數與磁碟差一個數量級（僅 3% 相關）。搬去更貴的高速碟不會有感，運算主要瓶頸在權重反量化與 GPU 傳輸。
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
          <button onclick="copyText('sudo blockdev --setra 4096 /dev/nvme0n1')" class="px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:text-white text-xs font-sans">複製</button>
        </div>
      </div>
    </div>
  `;
}

function setStorageModel(val) {
  state.storage.selectedModelId = val;
  renderStorageAdvisor();
}

function setStorageQuant(val) {
  state.storage.selectedQuant = val;
  renderStorageAdvisor();
}

function setStorageLoader(val) {
  state.storage.loaderType = val;
  renderStorageAdvisor();
}

// ----------------------------------------------------
// Radar Chart & Multi-metric Comparison
// ----------------------------------------------------
function renderRadarChart() {
  const canvas = document.getElementById('radar-chart-canvas');
  if (!canvas) return;

  const selectedModels = state.radar.selectedModelIds.map(id => getModel(id)).filter(Boolean);

  if (state.radar.chartInstance) {
    state.radar.chartInstance.destroy();
  }

  const colors = [
    { border: '#10b981', bg: 'rgba(16, 185, 129, 0.2)' },
    { border: '#6366f1', bg: 'rgba(99, 102, 241, 0.2)' },
    { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)' },
    { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)' }
  ];

  const datasets = selectedModels.map((m, idx) => {
    const c = colors[idx % colors.length];
    
    // Normalize metrics 0~100
    const prefillScore = m.speedPrefillScore;
    const decodeScore = m.workloadFit.decode * 20;
    const tcScore = m.tcGrade === 'S' ? 98 : m.tcGrade === 'S-' ? 92 : m.tcGrade === 'A' ? 88 : m.tcGrade === 'A-' ? 82 : m.tcGrade === 'B+' ? 75 : 65;
    const jsonScore = m.jsonDisciplineScore;
    const kvEfficiency = Math.max(10, 100 - (m.kvPerTokKB * 2.2)); // Lower KB is better
    const licenseScore = m.license === 'MIT' ? 100 : m.license === 'Apache 2.0' ? 95 : m.commercialAllowed ? 80 : 50;
    const ecosystemScore = m.engineSupport.includes('Experimental') ? 40 : 95;

    return {
      label: m.name,
      data: [prefillScore, decodeScore, tcScore, jsonScore, kvEfficiency, licenseScore, ecosystemScore],
      borderColor: c.border,
      backgroundColor: c.bg,
      borderWidth: 2,
      pointBackgroundColor: c.border,
      pointRadius: 4
    };
  });

  const ctx = canvas.getContext('2d');
  state.radar.chartInstance = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: [
        '長輸入 Prefill 效能',
        '長輸出 Decode 速度',
        '繁體中文語感與耐受度',
        'JSON 格式禮儀與紀律',
        'KV 快取省電度 (低佔用)',
        '商用授權自由度',
        '推理引擎主線成熟度'
      ],
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          pointLabels: {
            color: '#94a3b8',
            font: { size: 11, weight: 'bold' }
          },
          ticks: {
            display: false,
            max: 100,
            min: 0
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#f8fafc',
            font: { size: 12, weight: 'bold' }
          }
        }
      }
    }
  });

  // Render checkboxes
  const togglesContainer = document.getElementById('radar-model-toggles');
  if (togglesContainer) {
    togglesContainer.innerHTML = window.MODELS_DATABASE.map(m => {
      const isChecked = state.radar.selectedModelIds.includes(m.id);
      return `
        <label class="p-2.5 rounded-xl border text-xs cursor-pointer flex items-center justify-between transition ${
          isChecked ? 'bg-slate-800 border-emerald-500/50 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-900'
        }">
          <div class="flex items-center gap-2 truncate">
            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleRadarModel('${m.id}')" class="rounded text-emerald-500 focus:ring-emerald-500 bg-slate-900 border-slate-700">
            <span class="font-bold truncate">${m.name}</span>
          </div>
          <span class="text-[10px] font-mono text-slate-500">${m.architecture}</span>
        </label>
      `;
    }).join('');
  }
}

function toggleRadarModel(id) {
  const arr = state.radar.selectedModelIds;
  const idx = arr.indexOf(id);
  if (idx >= 0) {
    if (arr.length <= 1) {
      showToast('請至少保留一顆模型進行展示');
      return;
    }
    arr.splice(idx, 1);
  } else {
    if (arr.length >= 4) {
      showToast('雷達圖最多同時繪製 4 顆模型');
      return;
    }
    arr.push(id);
  }
  renderRadarChart();
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
            <a href="${data.articleUrl}" target="_blank" class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1 hover:bg-emerald-500/30 transition">
              <i data-lucide="newspaper" class="w-3.5 h-3.5"></i> iThome 鐵人賽原文專欄 <i data-lucide="external-link" class="w-3 h-3"></i>
            </a>
          </div>
          <h1 class="text-2xl sm:text-3xl font-black text-white leading-tight mb-3">
            ${data.title}
          </h1>
          <p class="text-sm text-slate-300 leading-relaxed">
            「如果排行榜能回答『我該用哪顆』，這個系列可以少寫十天。它不能，原因有三個，而且每一個都在我們自己的數據裡現形過。」
          </p>
        </div>

        <a href="${data.articleUrl}" target="_blank" class="px-5 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-xl shadow-emerald-950/50 flex items-center justify-center gap-2 transition shrink-0 self-start md:self-center">
          <i data-lucide="book-open" class="w-4 h-4"></i> 前往 iThome 閱讀全文 <i data-lucide="arrow-up-right" class="w-4 h-4"></i>
        </a>
      </div>
    </div>

    <!-- Three Big Myths Grid -->
    <h2 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
      <i data-lucide="alert-circle" class="w-5 h-5 text-amber-400"></i> 為什麼不能只看排行榜？三大迷思現形
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
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">${model.family}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">${model.license}</span>
        </div>
        <h2 class="text-xl font-bold text-white">${model.name}</h2>
      </div>
      <button onclick="closeModal('model-detail-modal')" class="text-slate-400 hover:text-white text-lg p-1">
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
          <span class="font-bold text-white text-sm">${model.paramsTotal}B</span>
          <span class="text-[10px] text-slate-400 block">啟用: ${model.paramsActive}B</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <span class="text-slate-500 block text-[11px]">Arena Coding Elo</span>
          <span class="font-bold text-emerald-400 text-sm font-mono">${model.arenaCodeElo}</span>
          <span class="text-[10px] text-slate-400 block">HumanEval: ${model.humanEval}%</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <span class="text-slate-500 block text-[11px]">繁中評級 / 最低位元</span>
          <span class="font-bold text-amber-300 text-sm">${model.tcGrade}</span>
          <span class="text-[10px] text-slate-400 block">${model.tcQuantMinBit}</span>
        </div>
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800">
          <span class="text-slate-500 block text-[11px]">KV Cache 每 Token</span>
          <span class="font-bold text-cyan-300 text-sm font-mono">${model.kvPerTokKB} KB</span>
          <span class="text-[10px] text-slate-400 block">考卷: ${model.examScore}</span>
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
          <p class="text-slate-300 leading-relaxed">${model.jsonNote} (評分: ${model.jsonDisciplineScore}/100)</p>
        </div>
        <div>
          <h4 class="font-bold text-white mb-1">推理引擎與生態支援狀態：</h4>
          <p class="text-slate-300 leading-relaxed">${model.engineNotes}</p>
        </div>
        <div>
          <h4 class="font-bold text-white mb-1">儲存建議：</h4>
          <p class="text-slate-300 leading-relaxed">${model.storageAdvise}</p>
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
                <th class="p-2.5">預估運行速度</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800 font-sans">
              ${Object.entries(model.quantProfiles).map(([k, v]) => `
                <tr>
                  <td class="p-2.5 font-bold text-emerald-400 font-mono">${k}</td>
                  <td class="p-2.5 text-slate-400 font-mono">${v.bpw}</td>
                  <td class="p-2.5 text-white font-mono">${v.sizeGB} GB</td>
                  <td class="p-2.5 text-slate-300">${v.recSpeedGpu}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
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
        <h2 class="text-xl font-bold text-white">模型全維度 PK (${models.length} 顆)</h2>
      </div>
      <button onclick="closeModal('compare-modal')" class="text-slate-400 hover:text-white text-lg p-1">
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
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono">${m.architecture} (${m.paramsActive}B / ${m.paramsTotal}B)</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">Arena Coding Elo</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono font-bold text-emerald-400 text-sm">${m.arenaCodeElo}</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">繁中評級 / 量化底線</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-bold text-amber-300">${m.tcGrade} (${m.tcQuantMinBit})</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">JSON 紀律評分</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono font-bold">${m.jsonDisciplineScore}/100</td>`).join('')}
          </tr>
          <tr>
            <td class="p-3 font-semibold text-slate-400 bg-slate-950">KV 成本 (每 Token)</td>
            ${models.map(m => `<td class="p-3 border-l border-slate-800 font-mono text-cyan-300 font-bold">${m.kvPerTokKB} KB</td>`).join('')}
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

  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
}

function copyText(txt) {
  navigator.clipboard.writeText(txt);
  showToast('已複製至剪貼簿！');
}

// ----------------------------------------------------
// Global Initialization
// ----------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  setTab('wizard');
  if (window.lucide) lucide.createIcons();
});
