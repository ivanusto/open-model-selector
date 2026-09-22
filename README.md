# OpenModel Selector ｜ AI 開放模型選擇決策與硬體搭配矩陣

> **基於 iThome 鐵人賽《[Day 16｜模型選型方法論：五個問題幫你跳脫排行榜迷失，找到適合自己任務用的 AI 模型](https://ithelp.ithome.com.tw/articles/10405898)》實測結論，結合 [Arena.ai Coding Leaderboard](https://arena.ai/leaderboard/code) 天梯數據與 [CanIRun.ai](https://www.canirun.ai/) 算力顯存精算模型打造的互動式選型工具。**

- **線上即時體驗網址 (GitHub Pages)**：[https://ivanusto.github.io/open-model-selector/](https://ivanusto.github.io/open-model-selector/)
- **iThome 專欄原文**：[https://ithelp.ithome.com.tw/articles/10405898](https://ithelp.ithome.com.tw/articles/10405898)
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
- **全系列硬體預設**：支援 NVIDIA GB10／DGX Spark（單機與雙機）、GB200、GH200、H200、RTX PRO 6000、RTX 3060~5090、雙卡、Apple Silicon（M5／M5 Pro／M5 Max／M5 Ultra、M6、M3 Ultra，16G~512G）、AMD Ryzen AI Max+ 395、RX 7900／9070 系列、Intel Arc 與純 CPU RAM。記憶體頻寬以原廠規格為準（2026-09-22 核對）。
- **即時動態計算**：自訂 Context Length（2k~128k）與共存預留空間，精準計算 `模型權重 + KV Cache + CUDA 執行期`，輸出完美暢跑 / 良好運行 / 部分卸載 CPU / OOM 燈號與預估 Decode t/s。

### 3. 開放權重 Coding 天梯榜（Arena.ai 整合）
- 收錄 28 款開放權重模型：2026 年的 DeepSeek-V4.1-Flash、DeepSeek-V4-Flash／V4-Pro、Kimi-K3、GLM-5.3-Flash、MiniMax-M3、Qwen3.8-27B、Qwen3.8-Flash-Next、Qwen3.6-35B-A3B、Qwen3-Coder-Next、Gemma 4（31B、26B-A4B）、Mistral Small 4／Medium 3.5、Devstral Small 2、Llama 4 Scout、gpt-oss-120b／20b、Ornith 1.5、Muse-Glimmer，以及保留作對照的上一代模型（Qwen2.5-Coder、DeepSeek-R1／V3、Llama 3.3、Codestral、Gemma 2、Yi-Coder）。
- 指標包含 LMArena Text Coding 分數、WebDev 分數、SWE-bench Verified、LiveCodeBench、HumanEval、繁中評級、JSON 紀律分、KV 每 Token 成本。
- **每個數字都附來源**（LMArena、Hugging Face model card 與 config、繁中 Agent 考卷、作者 GB10 實測），查不到來源的欄位一律顯示「無資料」，不以估計值填補。KV 每 Token 成本為 BF16、只計全注意力層，依 config.json 推導。
- 繁中評級、工作負載適配與 Prefill 分數屬於編輯評分；Day 16 以外的新模型依架構與啟用參數量套用固定規則，繁中評級標示為「未評」。
- 支援多模型橫向 PK 矩陣（Side-by-Side Comparison）。

### 4. 儲存與 I/O 決策（SSD vs NAS）
- **放得進記憶體嗎？**：放得進可放 NAS（僅冷啟動差十幾秒）；放不進絕不放 NAS（避免換頁 Page Reclaim 拖垮推論 3.8 倍）。
- **Loader 磁碟依賴度**：GGUF mmap（73% 磁碟依賴） vs vLLM（3% 依賴）。
- **Readahead 預讀免費加速調優**：內建 Linux / macOS 調優指令。

### 5. 七維能力雷達圖 & 考卷檢驗標準
- 視覺化雷達圖直觀比對多模型綜合表現。
- 深度整合 [llm-zhtw-agent-exam](https://github.com/ivanusto/llm-zhtw-agent-exam) 繁中 Agent 考卷標準。

### 6. 莫蘭迪雙主題介面
- 全站色票採低彩度莫蘭迪色系（鼠尾草綠、霧霾藍、豆沙黃、陶土粉），深色（煙燻灰底）與淺色（米灰底）兩套。
- 右上角一鍵切換，選擇記在 `localStorage`，重新整理後沿用；雷達圖配色同步跟著主題走。
- 兩套主題的所有文字色對背景皆達 WCAG AA（對比 4.5:1 以上）。

### 7. 每週自動化同步（GitHub Actions 定期巡檢）
- 內建 `scripts/sync_leaderboard.py` 與每週一 GitHub Actions 自動工作流程，從 LMArena 官方資料集 [`lmarena-ai/leaderboard-dataset`](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) 抓 Text Coding（style control）與 WebDev 兩榜的最新分數。
- 以 `data.js` 每個模型的 `arenaKey`／`arenaWebdevKey` 完全比對榜上名稱，不做模糊比對；新增模型時把榜上的 `model_name` 填進這兩個欄位即可。
- 抓取失敗或一筆都沒對到時 workflow 會失敗（紅燈），不會靜默成功。

---

## 快速啟動方式

### 方法一：直接雙擊執行 (Windows)
直接點擊專案目錄下的 `start.bat`，將自動啟動本地 Python 伺服器並在瀏覽器中開啟：
```
http://localhost:8000
```

### 方法二：指令列啟動 (Python)
```bash
git clone https://github.com/ivanusto/open-model-selector.git
cd open-model-selector
python serve.py
```

### 方法三：瀏覽器直接開啟
無需任何 Node/Python 環境，直接以 Chrome / Edge / Firefox 開啟 `index.html` 即可立即使用所有功能。

---

## 專案結構
```
open-model-selector/
├── index.html       # 響應式單頁應用 (Tailwind CSS, Lucide Icons, Chart.js)
├── app.js           # 核心邏輯、5問決策引擎、CanIRun 顯存公式、WebGPU 偵測
├── data.js          # 模型資料庫、硬體設定檔、Day 16 核心語料與評比數據
├── serve.py         # 輕量本地 Python 伺服器 (附自動開啟瀏覽器)
├── start.bat        # Windows 一鍵啟動腳本
└── README.md        # 完整說明文件
```
