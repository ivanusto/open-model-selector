/**
 * OpenModel Forge - Dataset
 * Integrates:
 * 1. Day 16 Selection Methodology (Ivan Usto / llm-zhtw-agent-exam)
 * 2. Arena.ai Coding Leaderboard (LMSYS Chatbot Arena Code Elo & Benchmarks)
 * 3. CanIRun.ai Hardware Profiles & VRAM/KV Cache footprint formulas
 */

const HARDWARE_PROFILES = [
  // AI Superchips & Workstations (Grace Blackwell & Grace Hopper)
  { id: 'nvidia-gb10', name: 'NVIDIA GB10 (Grace Blackwell 128GB Unified)', type: 'superchip', vramGB: 128, unified: true, memBandwidthGBs: 1000, description: 'NVIDIA 最新個人 AI 超級晶片！20核 Grace CPU + Blackwell GPU，128GB 統一記憶體，1 PFLOPS FP4 算力 (DGX Spark 主力)' },
  { id: 'nvidia-gh200', name: 'NVIDIA GH200 (Grace Hopper 96GB/144GB HBM3)', type: 'superchip', vramGB: 144, unified: true, memBandwidthGBs: 4000, description: '企業級超級晶片，96G/144G 超高速 HBM3 統一記憶體，跑 70B FP16 或 120B MoE 極速首選' },

  // Apple Silicon Unified Memory
  { id: 'mac-16', name: 'Apple M4 / M3 (16GB Unified)', type: 'apple', vramGB: 16, unified: true, memBandwidthGBs: 150, description: '入門級統一記憶體，適合 7B~9B Q8 或 14B Q4' },
  { id: 'mac-24', name: 'Apple M4 / M3 (24GB Unified)', type: 'apple', vramGB: 24, unified: true, memBandwidthGBs: 150, description: '單卡 24G 等級，可跑 27B/32B Q4_K_M' },
  { id: 'mac-36', name: 'Apple M3/M4 Pro (36GB Unified)', type: 'apple', vramGB: 36, unified: true, memBandwidthGBs: 150, description: '寬裕支援 32B Q8 或 70B Q3/Q4 邊緣' },
  { id: 'mac-48', name: 'Apple M3/M4 Max (48GB Unified)', type: 'apple', vramGB: 48, unified: true, memBandwidthGBs: 300, description: '中高階工作站，可順暢運行 32B 8-bit 或 70B Q4_K_M' },
  { id: 'mac-64', name: 'Apple M2/M3/M4 Max (64GB Unified)', type: 'apple', vramGB: 64, unified: true, memBandwidthGBs: 400, description: '70B 密集模型 Q6/Q8 舒適區，MoE 輕量版' },
  { id: 'mac-96', name: 'Apple M3/M4 Max (96GB Unified)', type: 'apple', vramGB: 96, unified: true, memBandwidthGBs: 400, description: '70B 8-bit + 巨大 KV 快取，或 gpt-oss-120b Q4' },
  { id: 'mac-128', name: 'Apple M2/M4 Ultra / Max (128GB Unified)', type: 'apple', vramGB: 128, unified: true, memBandwidthGBs: 800, description: 'Day 16 經典測試機型！可跑 Ornith BF16 (120GB) 或 70B FP16' },
  { id: 'mac-192', name: 'Apple M2 Ultra (192GB Unified)', type: 'apple', vramGB: 192, unified: true, memBandwidthGBs: 800, description: '支援 DeepSeek-V3/R1 Q2/Q3 或全量 120B+ 服務' },
  { id: 'mac-512', name: 'Apple Mac Studio / Pro (512GB Unified)', type: 'apple', vramGB: 512, unified: true, memBandwidthGBs: 800, description: '極致大記憶體，支援 DeepSeek-V3/R1 671B Q4_K_M (404GB) 本地推論' },

  // NVIDIA Consumer & Next-Gen GPUs
  { id: 'rtx-3060-12', name: 'NVIDIA RTX 3060 (12GB VRAM)', type: 'nvidia', vramGB: 12, unified: false, memBandwidthGBs: 360, description: '平民裝機神器，適合 7B/8B Q8 或 14B Q4' },
  { id: 'rtx-4060-8', name: 'NVIDIA RTX 4060 (8GB VRAM)', type: 'nvidia', vramGB: 8, unified: false, memBandwidthGBs: 272, description: '入門顯卡，適合 7B Q4_K_M / 3B FP16' },
  { id: 'rtx-4060ti-16', name: 'NVIDIA RTX 4060 Ti (16GB VRAM)', type: 'nvidia', vramGB: 16, unified: false, memBandwidthGBs: 288, description: '高 CP 值 16G 顯存，可滿載 7B FP16 或 14B Q8 / 32B Q3' },
  { id: 'rtx-4070-12', name: 'NVIDIA RTX 4070 / Super (12GB VRAM)', type: 'nvidia', vramGB: 12, unified: false, memBandwidthGBs: 504, description: '高頻寬 12G，適合 7B/8B 8-bit 高速推論' },
  { id: 'rtx-4070tis-16', name: 'NVIDIA RTX 4070 Ti Super (16GB VRAM)', type: 'nvidia', vramGB: 16, unified: false, memBandwidthGBs: 672, description: '256-bit 16GB，適合 14B 8-bit 或 32B Q3_K_M' },
  { id: 'rtx-4080-16', name: 'NVIDIA RTX 4080 / Super (16GB VRAM)', type: 'nvidia', vramGB: 16, unified: false, memBandwidthGBs: 736, description: '高速 16GB，極佳的 7B/8B/14B 生產速度' },
  { id: 'rtx-4090-24', name: 'NVIDIA RTX 4090 / 3090 (24GB VRAM)', type: 'nvidia', vramGB: 24, unified: false, memBandwidthGBs: 1008, description: '旗艦單卡！滿載 Qwen2.5-Coder-32B Q4_K_M (19GB) + KV' },
  { id: 'rtx-5080-16', name: 'NVIDIA RTX 5080 (16GB GDDR7)', type: 'nvidia', vramGB: 16, unified: false, memBandwidthGBs: 1024, description: 'Blackwell 次世代架構，超高 1TB/s 顯存頻寬' },
  { id: 'rtx-5090-32', name: 'NVIDIA RTX 5090 (32GB GDDR7)', type: 'nvidia', vramGB: 32, unified: false, memBandwidthGBs: 1792, description: '次世代單卡之王，完美支援 32B 8-bit 或 70B Q3_K_M' },
  { id: 'dual-4090-48', name: '雙卡 2x RTX 4090/3090 (48GB VRAM)', type: 'nvidia', vramGB: 48, unified: false, memBandwidthGBs: 2016, description: '極致創作者雙卡，70B Q4_K_M 或 32B FP16 高速並行' },
  { id: 'dual-5090-64', name: '雙卡 2x RTX 5090 (64GB VRAM)', type: 'nvidia', vramGB: 64, unified: false, memBandwidthGBs: 3584, description: '70B 8-bit / MoE 120B Q4 雙卡直推' },

  // AMD & Intel GPUs
  { id: 'amd-rx7900xtx', name: 'AMD Radeon RX 7900 XTX (24GB VRAM)', type: 'amd', vramGB: 24, unified: false, memBandwidthGBs: 960, description: 'ROCm / Vulkan 支援，24GB 大顯存高 CP 值選擇' },
  { id: 'intel-arc-a770', name: 'Intel Arc A770 (16GB VRAM)', type: 'intel', vramGB: 16, unified: false, memBandwidthGBs: 560, description: 'IPEX-LLM / llama.cpp Vulkan 支援，平價 16G 顯卡' },

  // Enterprise & Workstation
  { id: 'rtx-6000-ada', name: 'NVIDIA RTX 6000 Ada (48GB VRAM)', type: 'enterprise', vramGB: 48, unified: false, memBandwidthGBs: 960, description: '專業工作站單卡 48G ECC 顯存' },
  { id: 'a100-80', name: 'NVIDIA A100 / H100 (80GB VRAM)', type: 'enterprise', vramGB: 80, unified: false, memBandwidthGBs: 2000, description: '資料中心旗艦，70B 8-bit / FP16 企業級微調與推論' },

  // CPU System Memory
  { id: 'cpu-32', name: 'PC / 伺服器 CPU (32GB RAM)', type: 'cpu', vramGB: 32, unified: true, memBandwidthGBs: 60, description: '純 CPU 推論，適合 7B~14B Q4_K_M (速度約 5~15 t/s)' },
  { id: 'cpu-64', name: 'PC / 伺服器 CPU (64GB RAM)', type: 'cpu', vramGB: 64, unified: true, memBandwidthGBs: 80, description: '純 CPU 推論，支援 32B Q8 或 70B Q4 (速度約 2~8 t/s)' },
  { id: 'cpu-128', name: 'PC / 伺服器 CPU (128GB DDR5 RAM)', type: 'cpu', vramGB: 128, unified: true, memBandwidthGBs: 100, description: 'Day 16 探討的大記憶體共存方案，可跑大型 MoE / 70B Q8' }
];

const MODELS_DATABASE = [
  {
    id: 'qwen25-coder-32b',
    name: 'Qwen2.5-Coder-32B-Instruct',
    family: 'Qwen',
    paramsTotal: 32.5,
    paramsActive: 32.5,
    architecture: 'Dense',
    license: 'Apache 2.0',
    commercialAllowed: true,
    contextWindow: 131072, // 128k
    nativeContext: 32768,
    arenaCodeElo: 1284,
    humanEval: 92.7,
    sweBench: 41.2,
    tcGrade: 'A',
    tcQuantMinBit: '8-bit',
    tcQuantNote: '繁中表現優秀！但 4-bit 量化有 1.6~2x 語感折損，強烈建議 8-bit (Q8_0) 或認明 imatrix 最佳化。',
    jsonDisciplineScore: 88,
    jsonNote: '遵守繁中 prompt 與 JSON 規範極佳，agent 迴圈穩定度高。',
    kvPerTokKB: 16.2,
    speedPrefillScore: 95, // 密集模型 prefill 超快
    speedDecodeRating: '中等 (7.9~18 t/s 視硬體)',
    workloadFit: {
      prefill: 5, // 長進短出
      decode: 3,  // 短進長出
      agent: 4.5  // Agent
    },
    engineSupport: 'Production Merged',
    engineNotes: 'vLLM, llama.cpp, Ollama, SGLang, MLX 官方正式支援已合併，生態最成熟。',
    storageAdvise: '建議放置本機 NVMe SSD。冷啟動快，mmap 效率高達 73%。',
    examScore: '46/50 (Agent Exam 高標)',
    isDay16Featured: true,
    day16Role: '密集 27B/32B 標竿：Prefill 效能王者，長文 RAG 與 Repo 分析神器',
    quantProfiles: {
      'BF16': { sizeGB: 65.0, bpw: 16.0, recSpeedGpu: '25~35 t/s (4090x2 / A100)' },
      'Q8_0': { sizeGB: 34.5, bpw: 8.5, recSpeedGpu: '18~24 t/s (4090/5090 / 64G Mac)' },
      'Q6_K': { sizeGB: 26.8, bpw: 6.6, recSpeedGpu: '22~28 t/s' },
      'Q5_K_M': { sizeGB: 22.4, bpw: 5.5, recSpeedGpu: '25~32 t/s (24GB VRAM 剛好容納)' },
      'Q4_K_M': { sizeGB: 19.5, bpw: 4.5, recSpeedGpu: '28~36 t/s (24GB VRAM 留有 KV 餘裕)' },
      'NVFP4': { sizeGB: 17.8, bpw: 4.0, recSpeedGpu: '32~40 t/s (品質略遜於 imatrix Q4)' }
    }
  },
  {
    id: 'deepseek-r1-moe',
    name: 'DeepSeek-R1 (MoE 671B)',
    family: 'DeepSeek',
    paramsTotal: 671.0,
    paramsActive: 37.0,
    architecture: 'MoE',
    license: 'MIT',
    commercialAllowed: true,
    contextWindow: 131072,
    nativeContext: 65536,
    arenaCodeElo: 1365,
    humanEval: 96.1,
    sweBench: 49.2,
    tcGrade: 'S',
    tcQuantMinBit: 'Q4_K_M (imatrix) / Q8',
    tcQuantNote: '思維鏈 (CoT) 繁中推理深度天花板！建議使用 Q4_K_M imatrix 或 FP8 部署。',
    jsonDisciplineScore: 92,
    jsonNote: '可精準在 thinking 標籤後輸出乾淨 JSON，但長推理可能消耗較多 decode token。',
    kvPerTokKB: 2.1, // MLA 超省快取
    speedPrefillScore: 80,
    speedDecodeRating: '極高 (啟用參數量僅 37B，頻寬利用極佳)',
    workloadFit: {
      prefill: 4,
      decode: 5,
      agent: 5
    },
    engineSupport: 'Production Merged',
    engineNotes: 'vLLM, SGLang, llama.cpp, KTransformers, Ollama 完整支援 MLA/MoE。',
    storageAdvise: '模型權重龐大 (Q4_K_M 約 404GB)，需高速 NVMe 或 U.2 陣列。',
    examScore: '49/50 (冠軍級推理)',
    isDay16Featured: false,
    day16Role: '開源推理巔峰：MoE 啟用 37B + MLA 超低 KV 佔用',
    quantProfiles: {
      'BF16': { sizeGB: 1342.0, bpw: 16.0, recSpeedGpu: '需 8x H100 80G' },
      'FP8': { sizeGB: 671.0, bpw: 8.0, recSpeedGpu: '4x A100 80G 或 8x 4090' },
      'Q4_K_M': { sizeGB: 404.0, bpw: 4.5, recSpeedGpu: 'Mac 512GB / KTransformers CPU+GPU' },
      'Q2_K_XL': { sizeGB: 215.0, bpw: 2.5, recSpeedGpu: 'Mac 256GB / 雙卡工作站' }
    }
  },
  {
    id: 'deepseek-v3-moe',
    name: 'DeepSeek-V3 (MoE 671B)',
    family: 'DeepSeek',
    paramsTotal: 671.0,
    paramsActive: 37.0,
    architecture: 'MoE',
    license: 'MIT',
    commercialAllowed: true,
    contextWindow: 131072,
    nativeContext: 65536,
    arenaCodeElo: 1332,
    humanEval: 94.8,
    sweBench: 46.5,
    tcGrade: 'S-',
    tcQuantMinBit: 'Q4_K_M / Q8',
    tcQuantNote: '繁中文學、寫作與程式極強，MoE 啟用參數量低，decode 輸出極快。',
    jsonDisciplineScore: 90,
    jsonNote: '輸出遵循度極高，支援標準 Tool Calling 協定。',
    kvPerTokKB: 2.1,
    speedPrefillScore: 82,
    speedDecodeRating: '超高速 (MoE 37B 啟用)',
    workloadFit: {
      prefill: 4,
      decode: 5,
      agent: 4.8
    },
    engineSupport: 'Production Merged',
    engineNotes: '主線全面支援 MLA / MoE 並行推論。',
    storageAdvise: '主線生產需 NVMe SSD 陣列。',
    examScore: '48/50',
    isDay16Featured: false,
    day16Role: '全能開源基座：通用程式與長文解碼王者',
    quantProfiles: {
      'FP8': { sizeGB: 671.0, bpw: 8.0, recSpeedGpu: '4x A100 / 8x 4090' },
      'Q4_K_M': { sizeGB: 404.0, bpw: 4.5, recSpeedGpu: '工作站 512GB / KTransformers' },
      'Q3_K_M': { sizeGB: 280.0, bpw: 3.5, recSpeedGpu: 'Mac Studio 384GB' }
    }
  },
  {
    id: 'gpt-oss-120b',
    name: 'gpt-oss-120b (MoE 120B / Active 14B)',
    family: 'GPT-OSS',
    paramsTotal: 120.0,
    paramsActive: 14.0,
    architecture: 'MoE',
    license: 'Apache 2.0',
    commercialAllowed: true,
    contextWindow: 65536,
    nativeContext: 32768,
    arenaCodeElo: 1272,
    humanEval: 88.5,
    sweBench: 36.8,
    tcGrade: 'A-',
    tcQuantMinBit: '8-bit / MXFP4 imatrix',
    tcQuantNote: 'Day 16 實測序列：在 llama.cpp 上以 MXFP4/Q4 達成 60.6 t/s 高速解碼！看啟用參數不看總參數。',
    jsonDisciplineScore: 84,
    jsonNote: '長對話具備良好格式邊界，適合多輪工具迴圈。',
    kvPerTokKB: 12.0,
    speedPrefillScore: 84,
    speedDecodeRating: '極高速 (llama.cpp 實測 60.6 t/s)',
    workloadFit: {
      prefill: 3.8,
      decode: 5,
      agent: 4.5
    },
    engineSupport: 'Production Merged',
    engineNotes: 'llama.cpp 與 vLLM 已完美支援 MXFP4 與 GGUF。',
    storageAdvise: '共存型主力！Q4 檔約 68GB，放 NVMe 可十秒內冷啟動。',
    examScore: '43/50 (高速高分)',
    isDay16Featured: true,
    day16Role: 'Day 16 實測極速代表：60.6 t/s 解碼，短輸入長輸出的極致 MoE',
    quantProfiles: {
      'BF16': { sizeGB: 240.0, bpw: 16.0, recSpeedGpu: '3x 80G / 256GB Mac' },
      'Q8_0': { sizeGB: 128.0, bpw: 8.5, recSpeedGpu: '128GB Mac / 2x 48G (35 t/s)' },
      'MXFP4': { sizeGB: 68.0, bpw: 4.5, recSpeedGpu: '60.6 t/s (llama.cpp 實測金牌)' },
      'Q4_K_M': { sizeGB: 68.5, bpw: 4.5, recSpeedGpu: '55~62 t/s (96G Mac / 2x 4090)' }
    }
  },
  {
    id: 'ornith-35b-a3b',
    name: 'Ornith-35B-A3B (MoE 35B / Active 3B)',
    family: 'Ornith',
    paramsTotal: 35.0,
    paramsActive: 3.0,
    architecture: 'MoE',
    license: 'MIT',
    commercialAllowed: true,
    contextWindow: 65536,
    nativeContext: 32768,
    arenaCodeElo: 1248,
    humanEval: 84.2,
    sweBench: 32.0,
    tcGrade: 'A-',
    tcQuantMinBit: '8-bit 起步 (BF16 最佳)',
    tcQuantNote: 'Day 16 實測亮點：啟用參數量僅 3B，8-bit 解碼達 29.9 t/s！KV 成本僅 10.56 KB/tok (比密集27B省3.3倍)。',
    jsonDisciplineScore: 88,
    jsonNote: '嚴格遵守 JSON 格式，Agent 考卷得分高達 44/50。',
    kvPerTokKB: 10.56, // 3.3x lower than 27B dense
    speedPrefillScore: 82,
    speedDecodeRating: '高速 (8-bit 實測 29.9 t/s)',
    workloadFit: {
      prefill: 3.5,
      decode: 4.8,
      agent: 5
    },
    engineSupport: 'Production Merged',
    engineNotes: 'llama.cpp, vLLM 均可直接載入。',
    storageAdvise: 'BF16 峰值佔用 120.7 GB，128GB 機器可作獨佔主力；Q8 檔 38GB 可作共存型。',
    examScore: '44/50 (Agent 推薦)',
    isDay16Featured: true,
    day16Role: 'Day 16 獨佔/共存雙棲：KV 成本超低 10.56 KB，MIT 最寬鬆授權',
    quantProfiles: {
      'BF16': { sizeGB: 70.0, bpw: 16.0, recSpeedGpu: '128GB 機器全開 (120.7GB 峰值)' },
      'Q8_0': { sizeGB: 38.0, bpw: 8.5, recSpeedGpu: '29.9 t/s (實測速度)' },
      'Q5_K_M': { sizeGB: 25.2, bpw: 5.5, recSpeedGpu: '38~45 t/s (單卡 24G 剛好容納)' },
      'Q4_K_M': { sizeGB: 21.0, bpw: 4.5, recSpeedGpu: '42~50 t/s' }
    }
  },
  {
    id: 'qwen38-27b-dense',
    name: 'Qwen3.8-27B (Dense 27B Class)',
    family: 'Qwen',
    paramsTotal: 27.0,
    paramsActive: 27.0,
    architecture: 'Dense',
    license: 'Apache 2.0',
    commercialAllowed: true,
    contextWindow: 65536,
    nativeContext: 32768,
    arenaCodeElo: 1268,
    humanEval: 89.0,
    sweBench: 37.5,
    tcGrade: 'A',
    tcQuantMinBit: '8-bit 起步',
    tcQuantNote: 'Day 16 實測指出：8-bit decode 為 7.9 t/s，但 prefill 比 decode 快 200 倍！長輸入短輸出絕配。',
    jsonDisciplineScore: 82,
    jsonNote: 'KV Cache 成本達 34.5 KB/tok，多 session 時需預留顯存。',
    kvPerTokKB: 34.5,
    speedPrefillScore: 98, // 密集王者
    speedDecodeRating: '偏慢 (8-bit 實測 7.9 t/s)',
    workloadFit: {
      prefill: 5,   // 文件摘要、RAG、Repo 分析神器
      decode: 2.5, // 不適合長文生成
      agent: 3.5
    },
    engineSupport: 'Production Merged',
    engineNotes: '主流推理引擎均已深度最佳化 FlashAttention 與 Chunked Prefill。',
    storageAdvise: '住 NVMe SSD。大量 Prefill 依賴記憶體頻寬與快顯存。',
    examScore: '41/50',
    isDay16Featured: true,
    day16Role: 'Day 16 典型 Prefill 神器：長文摘要與 RAG 問答第一名，解碼勿碰',
    quantProfiles: {
      'BF16': { sizeGB: 54.0, bpw: 16.0, recSpeedGpu: '18~24 t/s (48G VRAM)' },
      'Q8_0': { sizeGB: 29.0, bpw: 8.5, recSpeedGpu: '7.9 t/s (Day 16 實測基準)' },
      'Q4_K_M': { sizeGB: 16.5, bpw: 4.5, recSpeedGpu: '14~20 t/s (單卡 24G 輕鬆跑)' }
    }
  },
  {
    id: 'flash-next-preview',
    name: 'Flash-Next-72B (Dense Experimental)',
    family: 'Flash',
    paramsTotal: 72.0,
    paramsActive: 72.0,
    architecture: 'Dense',
    license: 'qwen-community-1.0',
    commercialAllowed: false, // 需讀條款
    contextWindow: 131072,
    nativeContext: 32768,
    arenaCodeElo: 1292,
    humanEval: 91.2,
    sweBench: 40.8,
    tcGrade: 'B',
    tcQuantMinBit: '8-bit',
    tcQuantNote: 'Day 16 實測警示：整代架構升級增益幾乎沒分給繁中！紙面規格漂亮但繁中提升極微。',
    jsonDisciplineScore: 76,
    jsonNote: '吃 3/4 記憶體，需手動驗證晶片上是否清醒。',
    kvPerTokKB: 28.0,
    speedPrefillScore: 92,
    speedDecodeRating: '中等',
    workloadFit: {
      prefill: 4.2,
      decode: 3.5,
      agent: 3.0
    },
    engineSupport: 'Experimental (PR Only)',
    engineNotes: 'Day 16 案例：vLLM 與 llama.cpp 支援皆在 PR 階段，需自編分支，切勿進生產環境！',
    storageAdvise: '實驗品，放 NAS 集中庫即可，避免浪費本機主力 SSD。',
    examScore: '36/50 (生態與格式扣分)',
    isDay16Featured: true,
    day16Role: 'Day 16 警示案例：紙面榜首、PR 實驗品，生產服務應避開',
    quantProfiles: {
      'BF16': { sizeGB: 144.0, bpw: 16.0, recSpeedGpu: '需 2x 80G' },
      'Q8_0': { sizeGB: 76.8, bpw: 8.5, recSpeedGpu: '128G Mac 吃 3/4 記憶體' },
      'Q4_K_M': { sizeGB: 42.5, bpw: 4.5, recSpeedGpu: '雙卡 4090 或 64G Mac' }
    }
  },
  {
    id: 'qwen25-coder-7b',
    name: 'Qwen2.5-Coder-7B-Instruct',
    family: 'Qwen',
    paramsTotal: 7.6,
    paramsActive: 7.6,
    architecture: 'Dense',
    license: 'Apache 2.0',
    commercialAllowed: true,
    contextWindow: 131072,
    nativeContext: 32768,
    arenaCodeElo: 1215,
    humanEval: 85.4,
    sweBench: 28.6,
    tcGrade: 'B+',
    tcQuantMinBit: 'Q8_0 / FP16',
    tcQuantNote: '輕量端側主力！顯存吃極少，建議直上 8-bit 或 FP16 保證繁中品質。',
    jsonDisciplineScore: 82,
    jsonNote: '基本工具呼叫正常，單輪精準。',
    kvPerTokKB: 4.8,
    speedPrefillScore: 90,
    speedDecodeRating: '超極速 (45~85 t/s)',
    workloadFit: {
      prefill: 4,
      decode: 4,
      agent: 4
    },
    engineSupport: 'Production Merged',
    engineNotes: '所有端側框架 (Ollama, WebLLM, llama.cpp, SGLang, vLLM) 完美開箱即用。',
    storageAdvise: '小巧 (Q8 僅 8GB)，放哪裡都秒開。',
    examScore: '40/50',
    isDay16Featured: false,
    day16Role: '共存型神隊友：給 ComfyUI 留 16G 顯存，自己只吃 6~8G',
    quantProfiles: {
      'BF16': { sizeGB: 15.2, bpw: 16.0, recSpeedGpu: '35~55 t/s (16GB VRAM 輕鬆滿載)' },
      'Q8_0': { sizeGB: 8.2, bpw: 8.5, recSpeedGpu: '50~75 t/s (12GB VRAM 完美共存)' },
      'Q4_K_M': { sizeGB: 4.8, bpw: 4.5, recSpeedGpu: '70~100 t/s (8GB 筆電即跑)' }
    }
  },
  {
    id: 'llama-33-70b',
    name: 'Llama-3.3-70B-Instruct',
    family: 'Llama',
    paramsTotal: 70.6,
    paramsActive: 70.6,
    architecture: 'Dense',
    license: 'Llama 3.3 Community',
    commercialAllowed: true,
    contextWindow: 131072,
    nativeContext: 131072,
    arenaCodeElo: 1294,
    humanEval: 90.2,
    sweBench: 39.4,
    tcGrade: 'B+',
    tcQuantMinBit: '8-bit / imatrix Q4',
    tcQuantNote: '英文與邏輯第一梯隊，但繁中量化衰退比英文高，切忌無校正 4-bit，務必用 imatrix。',
    jsonDisciplineScore: 90,
    jsonNote: 'Meta 原生 JSON Schema 與 Tool Calling 訓練極為嚴格。',
    kvPerTokKB: 18.4,
    speedPrefillScore: 92,
    speedDecodeRating: '中等 (需大頻寬)',
    workloadFit: {
      prefill: 4.8,
      decode: 3.8,
      agent: 4.8
    },
    engineSupport: 'Production Merged',
    engineNotes: '全球生態支援度第一名。',
    storageAdvise: '常駐生產主力，強烈建議本機 NVMe SSD。',
    examScore: '45/50',
    isDay16Featured: false,
    day16Role: '企業級 Dense 旗艦：70B 標準量級，Agent 紀律模範生',
    quantProfiles: {
      'BF16': { sizeGB: 141.0, bpw: 16.0, recSpeedGpu: '2x 80G A100' },
      'Q8_0': { sizeGB: 75.0, bpw: 8.5, recSpeedGpu: '128G Mac / 2x 48G' },
      'Q5_K_M': { sizeGB: 49.5, bpw: 5.5, recSpeedGpu: '64G Mac / 2x 3090' },
      'Q4_K_M': { sizeGB: 42.5, bpw: 4.5, recSpeedGpu: '2x 4090 (48G VRAM 滿載極速)' }
    }
  },
  {
    id: 'codestral-22b',
    name: 'Codestral-22B-v0.1',
    family: 'Mistral',
    paramsTotal: 22.2,
    paramsActive: 22.2,
    architecture: 'Dense',
    license: 'MNCL (非商業專用 / 商用需授權)',
    commercialAllowed: false,
    contextWindow: 32768,
    nativeContext: 32768,
    arenaCodeElo: 1256,
    humanEval: 86.8,
    sweBench: 34.0,
    tcGrade: 'B-',
    tcQuantMinBit: '8-bit',
    tcQuantNote: '程式碼補全 (FIM) 與中間填充強，但繁體中文語感一般，偏歐美多語言。',
    jsonDisciplineScore: 84,
    jsonNote: '80+ 種語言支援，中間填空 (Fill-in-the-Middle) 專用模型。',
    kvPerTokKB: 14.2,
    speedPrefillScore: 92,
    speedDecodeRating: '良好 (20~30 t/s)',
    workloadFit: {
      prefill: 4.2,
      decode: 3.5,
      agent: 3.8
    },
    engineSupport: 'Production Merged',
    engineNotes: 'Mistral.rs, llama.cpp, vLLM 支援成熟。',
    storageAdvise: '本機 NVMe，適合常駐作為 IDE 後端。',
    examScore: '39/50',
    isDay16Featured: false,
    day16Role: 'IDE 自動補全神器：80+ 種程式語言 FIM 特化',
    quantProfiles: {
      'BF16': { sizeGB: 44.4, bpw: 16.0, recSpeedGpu: '48G VRAM' },
      'Q8_0': { sizeGB: 23.8, bpw: 8.5, recSpeedGpu: '24GB VRAM 剛好塞入' },
      'Q4_K_M': { sizeGB: 13.5, bpw: 4.5, recSpeedGpu: '16GB VRAM (4080/4060Ti)' }
    }
  },
  {
    id: 'gemma-2-27b',
    name: 'Gemma-2-27B-IT',
    family: 'Google Gemma',
    paramsTotal: 27.2,
    paramsActive: 27.2,
    architecture: 'Dense (Sliding Window)',
    license: 'Gemma License (允許商用)',
    commercialAllowed: true,
    contextWindow: 8192,
    nativeContext: 8192,
    arenaCodeElo: 1252,
    humanEval: 83.9,
    sweBench: 31.5,
    tcGrade: 'B+',
    tcQuantMinBit: '8-bit 起步',
    tcQuantNote: 'Google 架構品質紮實，但上下文長度受限 8k，且滑動窗口注意機制需要 engine 適配。',
    jsonDisciplineScore: 78,
    jsonNote: '遵守繁中 prompt 良好，短上下文任務表現佳。',
    kvPerTokKB: 24.0,
    speedPrefillScore: 94,
    speedDecodeRating: '中等',
    workloadFit: {
      prefill: 4.5,
      decode: 3.0,
      agent: 3.2
    },
    engineSupport: 'Production Merged',
    engineNotes: 'llama.cpp 與 vLLM 正式版均支援 Gemma-2 特殊 Soft-capping。',
    storageAdvise: '本機 NVMe。',
    examScore: '38/50',
    isDay16Featured: false,
    day16Role: 'Google 精品 Dense：短上下文精準推理與數學',
    quantProfiles: {
      'BF16': { sizeGB: 54.4, bpw: 16.0, recSpeedGpu: '48G VRAM' },
      'Q8_0': { sizeGB: 29.2, bpw: 8.5, recSpeedGpu: '24GB VRAM 需微縮 KV' },
      'Q4_K_M': { sizeGB: 16.8, bpw: 4.5, recSpeedGpu: '24GB VRAM 順暢運行' }
    }
  },
  {
    id: 'yi-coder-9b',
    name: 'Yi-Coder-9B-Chat',
    family: 'Yi',
    paramsTotal: 8.8,
    paramsActive: 8.8,
    architecture: 'Dense',
    license: 'Apache 2.0',
    commercialAllowed: true,
    contextWindow: 131072,
    nativeContext: 32768,
    arenaCodeElo: 1208,
    humanEval: 82.5,
    sweBench: 26.4,
    tcGrade: 'A-',
    tcQuantMinBit: 'Q8_0 / FP16',
    tcQuantNote: '中文原生血統，繁中理解力在 9B 量級名列前茅，128k 長文本。',
    jsonDisciplineScore: 82,
    jsonNote: '中英文指令遵循均勻。',
    kvPerTokKB: 6.5,
    speedPrefillScore: 88,
    speedDecodeRating: '極快 (40~65 t/s)',
    workloadFit: {
      prefill: 4.2,
      decode: 4.0,
      agent: 4.0
    },
    engineSupport: 'Production Merged',
    engineNotes: '全面支援。',
    storageAdvise: '體積小 (Q8 約 9.5GB)，本機或 NAS 皆可。',
    examScore: '41/50',
    isDay16Featured: false,
    day16Role: '端側中文黑馬：長上下文 128k + 原生中文程式碼',
    quantProfiles: {
      'BF16': { sizeGB: 17.6, bpw: 16.0, recSpeedGpu: '16GB/24GB VRAM' },
      'Q8_0': { sizeGB: 9.5, bpw: 8.5, recSpeedGpu: '12GB VRAM 暢跑' },
      'Q4_K_M': { sizeGB: 5.5, bpw: 4.5, recSpeedGpu: '8GB 顯卡輕鬆跑' }
    }
  }
];

const DAY16_METHODOLOGY = {
  title: 'Day 16｜模型選型方法論：五個問題，比排行榜有用',
  articleUrl: 'https://ithelp.ithome.com.tw/articles/10405704/',
  examRepo: 'https://github.com/ivanusto/llm-zhtw-agent-exam',
  threeMyths: [
    {
      id: 1,
      title: '排行榜量的語言不是你的語言',
      icon: 'globe',
      summary: '量化對繁中的傷害是英文的 1.6 到 2 倍！跨引擎跨量化家族都成立。英文榜上的名次到了繁中任務會重新洗牌。',
      quote: '英文社群說「4-bit 無感」時，他們沒有替你驗過。'
    },
    {
      id: 2,
      title: '排行榜不量你的工作負載形狀',
      icon: 'activity',
      summary: '同一顆密集 27B，prefill 對 decode 的效率差了 200 倍。做長文摘要是神器，拿來寫長文是折磨。榜上只有一個分數。',
      quote: '看啟用參數量，不是總參數量。'
    },
    {
      id: 3,
      title: '排行榜不量禮儀與格式紀律',
      icon: 'check-square',
      summary: '五個配方在能力題全數滿分，卻在「只輸出一個 JSON 不要多話」這題拉出 0/50 到 40/50 的差距！agent 迴圈一天幾百輪，直接決定帳單。',
      quote: '願不願意當白老鼠是個人選擇，把白老鼠環境放進生產服務是專業錯誤。'
    }
  ],
  storageRules: [
    {
      question: '它放得進記憶體嗎？',
      yesAction: '放得進：NAS 的代價只是冷啟動多十幾秒的一次性成本。',
      noAction: '放不進：絕不要放 NAS！每一次頁面回收再讀取都走網路，最慘案例總載入慢 3.8 倍！'
    },
    {
      question: '你的 loader 吃儲存速度嗎？',
      yesAction: '同數量級（如 GGUF mmap 達 73%）：儲存速度直接反映在啟動時間，住本機 NVMe。',
      noAction: '差一個數量級（如 vLLM 僅 3%）：搬去快碟不會有感。'
    }
  ],
  onePageRules: [
    { num: 1, topic: '任務形狀', rule: '長進短出選密集，短進長出選 MoE（看啟用量），agent 全都要看' },
    { num: 2, topic: '繁體中文', rule: '8-bit 起步、imatrix 優先、自己的語料自己驗' },
    { num: 3, topic: '記憶體', rule: '先決定獨佔還是共存，再看權重加 KV 加餘裕' },
    { num: 4, topic: '授權', rule: 'MANIFEST 裡那行 license 就是答案（商用認明 Apache/MIT）' },
    { num: 5, topic: '生態', rule: '支援沒合併的是實驗品，實驗品不進生產' }
  ]
};

// Export to window for global browser usage
if (typeof window !== 'undefined') {
  window.HARDWARE_PROFILES = HARDWARE_PROFILES;
  window.MODELS_DATABASE = MODELS_DATABASE;
  window.DAY16_METHODOLOGY = DAY16_METHODOLOGY;
}
