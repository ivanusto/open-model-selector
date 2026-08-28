# OpenModel Selector ｜ AI 開放模型選擇決策與硬體搭配矩陣

> **基於 iThome 鐵人賽《[Day 16｜模型選型方法論：五個問題，比排行榜有用](https://ithelp.ithome.com.tw/articles/10405704/)》實測結論，結合 [Arena.ai Coding Leaderboard](https://arena.ai/leaderboard/code) 天梯數據與 [CanIRun.ai](https://www.canirun.ai/) 算力顯存精算模型打造的互動式選型工具。**

- **線上即時體驗網址 (GitHub Pages)**：[https://ivanusto.github.io/open-model-forge/](https://ivanusto.github.io/open-model-forge/)
- **iThome 專欄原文**：[https://ithelp.ithome.com.tw/articles/10405704/](https://ithelp.ithome.com.tw/articles/10405704/)
- **繁中 Agent 考卷專案**：[ivanusto/llm-zhtw-agent-exam](https://github.com/ivanusto/llm-zhtw-agent-exam)

---

## 核心功能特色

### 1. 5問選型決策樹（Day 16 實測方法論）
- **Q1 任務形狀**：長進短出（Prefill 導向）選密集模型（27B/32B）；短進長出（Decode 導向）選小啟用量 MoE（Ornith 3B, gpt-oss 14B）；Agent 迴圈全方位考量。
- **Q2 繁體中文**：繁中量化劣化為英文 1.6~2 倍！強制 **8-bit 起步**、**低位元認明 imatrix 系**。
- **Q3 記憶體配置**：獨佔型（滿載峰值） vs 共存型（預留顯存給 ComfyUI / 日常工作）。
- **Q4 授權條款**：過濾商用無憂（Apache 2.0 / MIT）與非商用限制條款（MNCL 等）。
- **Q5 生態成熟度**：嚴格區分「主線 Merged 正式版」與「PR 階段實驗品（如 Flash-Next）」，堅持**實驗品不進生產**。
- **即時淘汰日誌 & 啟動指令生成**：自動產出 `llama.cpp` / `vLLM` / `Ollama` 最佳啟動參數與 GGUF 量化檔建議。

### 2. 能跑嗎？(CanIRun.ai 算力與顯存精算模擬)
- **WebGPU 硬體自動偵測**：點擊一鍵透過瀏覽器 WebGPU/WebGL 取得 GPU 型號與顯存估計。
- **全系列硬體預設**：支援 NVIDIA GB10 Grace Blackwell、GH200、RTX 3060~5090、雙卡/四卡、Apple Silicon 統一記憶體（16G~512G）、AMD RX 7900 系列、Intel Arc 與純 CPU RAM。
- **即時動態計算**：自訂 Context Length（2k~128k）與共存預留空間，精準計算 `模型權重 + KV Cache + CUDA 執行期`，輸出完美暢跑 / 良好運行 / 部分卸載 CPU / OOM 燈號與預估 Decode t/s。

### 3. 開放權重 Coding 天梯榜（Arena.ai 整合）
- 彙整 DeepSeek-R1/V3、Qwen2.5-Coder、gpt-oss-120b、Ornith-35B-A3B、Llama 3.3、Codestral、Gemma 2 等主流開放模型。
- 提供 Arena Coding Elo、HumanEval、繁中評級、JSON 紀律分、KV 每 Token 成本等指標。
- 支援多模型橫向 PK 矩陣（Side-by-Side Comparison）。

### 4. 儲存與 I/O 決策（SSD vs NAS）
- **放得進記憶體嗎？**：放得進可放 NAS（僅冷啟動差十幾秒）；放不進絕不放 NAS（避免換頁 Page Reclaim 拖垮推論 3.8 倍）。
- **Loader 磁碟依賴度**：GGUF mmap（73% 磁碟依賴） vs vLLM（3% 依賴）。
- **Readahead 預讀免費加速調優**：內建 Linux / macOS 調優指令。

### 5. 七維能力雷達圖 & 考卷檢驗標準
- 視覺化雷達圖直觀比對多模型綜合表現。
- 深度整合 [llm-zhtw-agent-exam](https://github.com/ivanusto/llm-zhtw-agent-exam) 繁中 Agent 考卷標準。

---

## 快速啟動方式

### 方法一：直接雙擊執行 (Windows)
直接點擊專案目錄下的 `start.bat`，將自動啟動本地 Python 伺服器並在瀏覽器中開啟：
```
http://localhost:8000
```

### 方法二：指令列啟動 (Python)
```bash
git clone https://github.com/ivanusto/open-model-forge.git
cd open-model-forge
python serve.py
```

### 方法三：瀏覽器直接開啟
無需任何 Node/Python 環境，直接以 Chrome / Edge / Firefox 開啟 `index.html` 即可立即使用所有功能。

---

## 專案結構
```
open-model-forge/
├── index.html       # 響應式單頁應用 (Tailwind CSS, Lucide Icons, Chart.js)
├── app.js           # 核心邏輯、5問決策引擎、CanIRun 顯存公式、WebGPU 偵測
├── data.js          # 模型資料庫、硬體設定檔、Day 16 核心語料與評比數據
├── serve.py         # 輕量本地 Python 伺服器 (附自動開啟瀏覽器)
├── start.bat        # Windows 一鍵啟動腳本
└── README.md        # 完整說明文件
```
