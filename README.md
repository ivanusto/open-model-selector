# OpenModel Selector ｜ AI 開放模型選擇決策與硬體搭配矩陣

> **基於 iThome 鐵人賽《[Day 16｜模型選型方法論：五個問題幫你跳脫排行榜迷失，找到適合自己任務用的 AI 模型](https://ithelp.ithome.com.tw/articles/10405898)》實測結論，結合 [Arena.ai Coding Leaderboard](https://arena.ai/leaderboard/code) 天梯數據、[CanIRun.ai](https://www.canirun.ai/) 算力顯存精算模型，以及作者單機與雙機 NVIDIA GB10 的實測成績打造的互動式選型工具。**

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
- **即時淘汰日誌 & 啟動指令生成**：依量化檔類型產出 `llama.cpp`（GGUF）或 `vLLM`（BF16／FP8／NVFP4）的啟動指令，上下文長度跟著試算頁的設定走；EXL3 與 ds4 等社群格式改列出量化檔來源。
- **問題三實際影響篩選**：共存模式扣掉保留餘裕，並把最小量化檔加上目前上下文的 KV 快取與執行期一起算，放不下就淘汰。

### 2. 能跑嗎？(CanIRun.ai 算力與顯存精算模擬)
- **硬體自動偵測**：從瀏覽器 WebGL 的 GPU 字串比對型號（WebGPU 只回報廠牌與架構，不含型號）；對不到時保留原本的選擇，不會擅自換成別的硬體。
- **全系列硬體預設**：支援 NVIDIA GB10／DGX Spark（單機與雙機）、GB200、GH200、H200、RTX PRO 6000、RTX 3060~5090、雙卡、Apple Silicon（M5／M5 Pro／M5 Max／M5 Ultra、M6、M3 Ultra，16G~512G）、AMD Ryzen AI Max+ 395、RX 7900／9070 系列、Intel Arc 與純 CPU RAM。記憶體頻寬以原廠規格為準（2026-09-22 核對）。
- **即時動態計算**：自訂 Context Length（2k~128k）與共存預留空間，計算 `模型權重 + KV Cache + 執行期`，輸出完美暢跑 / 良好運行 / 部分卸載 CPU / 放不下燈號。統一記憶體（Apple、GB10、Strix Halo、純 CPU）沒有卸載這條路，直接判定放不下。
- **Decode 速度**：有作者 GB10 實測的模型與檔位直接顯示實測值並標「實測」；其餘顯示頻寬理論上限（記憶體頻寬 ÷ 每 token 讀取的啟用權重），並註明 GB10 上各引擎實測約達上限的 45% 到 73%（Day 11）。

### 3. 開放權重 Coding 天梯榜（Arena.ai 整合）
- 收錄 37 款開放權重模型：2026 年的 DeepSeek-V4.1-Flash（0910 與 1017 兩版）、DeepSeek-V4-Flash／V4-Pro、Kimi-K3／K2.6、MiMo-V2.6-Pro／Flash、GLM-5.3／5.3-Flash、MiniMax-M3、Qwen3.8-27B、Qwen3.8-Flash-Next、Qwen3.6-35B-A3B、Qwen3-Coder-Next、Gemma 4（31B、26B-A4B）、Mistral Small 4／Medium 3.5、Devstral Small 2、Llama 4 Scout、Nemotron-3-Super、gpt-oss-120b／20b、Ornith 1.5（35B、122B）、Flint、Nanbeige4.3-33B、Muse-Glimmer，以及保留作對照的上一代模型（Qwen2.5-Coder、DeepSeek-R1／V3、Llama 3.3、Codestral、Gemma 2、Yi-Coder）。
- 指標包含 LMArena Text Coding 分數、WebDev 分數、SWE-bench Verified、LiveCodeBench、HumanEval、繁中評級、JSON 紀律分、KV 每 Token 成本。
- **每個數字都附來源**（LMArena、Hugging Face model card 與 config、繁中 Agent 考卷、作者 GB10 實測），查不到來源的欄位一律顯示「無資料」，不以估計值填補。KV 每 Token 成本為 BF16、只計全注意力層，依 config.json 推導。
- Agent 模式下，考過繁中 Agent 考卷的模型排在沒考過的前面；沒考過的不受 JSON 紀律門檻淘汰，推薦卡片標示「未經考卷驗證」。
- 繁中評級、工作負載適配與 Prefill 分數屬於編輯評分；Day 16 以外的新模型依架構與啟用參數量套用固定規則，繁中評級標示為「未評」。
- 支援多模型橫向 PK 矩陣（Side-by-Side Comparison）。

### 4. GB10 實測紀錄（作者單機與雙機）
- 獨立分頁列出作者在 NVIDIA GB10（DGX Spark 同級）上的實測：雙機是兩台以 ConnectX-7 直連、跨機張量並行（TP=2）。
- 每筆紀錄包含日期、引擎與權重來源、單一請求 decode、N 路併發合計吞吐、prefill，以及品質檢查（針取回、工具呼叫、繁中考卷、簡體洩漏）。
- 目前收錄 Qwen3.8-27B（單機 8.08 對雙機 TP=2 14.80 t/s）、Mistral-Small-4、Ornith 1.5 35B（BF16 與 NVFP4，併發 1 到 32）、DeepSeek-V4-Flash、DeepSeek-V4.1-Flash 0910 的三種社群配方，以及 DeepSeek-V4.1-Flash-1017 在 TensorFold Python 版與 Zig 版上的兩組成績。
- 資料在 `data.js` 的 `LOCAL_BENCHMARKS`，每筆都對到模型的量化檔位；「能跑嗎？」與模型詳情會引用這些實測值。不同引擎的 token 切法不同，跨引擎只看量級。

### 5. 儲存與 I/O 決策（SSD vs NAS）
- **放得進記憶體嗎？**：放得進可放 NAS（僅冷啟動差十幾秒）；放不進別放 NAS。實測模型大小逼近可用記憶體時，走 NFS 的總載入慢了 3.8 倍，連名義上純 CPU 的階段都被拖慢，因為記憶體裝不下模型加上載入過程的中間副本。系統記憶體跟著選定的硬體走。
- **Loader 磁碟依賴度**：同一顆碟、同一個 readahead 設定下，GGUF mmap 吃掉磁碟能力的 81%，vLLM 只用到 3%。
- **Readahead 預讀免費加速調優**：內建 Linux / macOS 調優指令。

### 6. 七維能力雷達圖 & 考卷檢驗標準
- 視覺化雷達圖直觀比對多模型綜合表現。
- 深度整合 [llm-zhtw-agent-exam](https://github.com/ivanusto/llm-zhtw-agent-exam) 繁中 Agent 考卷標準。

### 7. 莫蘭迪雙主題介面
- 全站色票採低彩度莫蘭迪色系（鼠尾草綠、霧霾藍、豆沙黃、陶土粉），深色（煙燻灰底）與淺色（米灰底）兩套。
- 右上角一鍵切換，選擇記在 `localStorage`，重新整理後沿用；雷達圖配色同步跟著主題走。
- 兩套主題的所有文字色對背景皆達 WCAG AA（對比 4.5:1 以上）；最小字級 11px，對話框支援 Esc 與點背景關閉、焦點鎖定，分頁按鈕有 `aria-selected`。

### 8. 每週自動化同步（GitHub Actions 定期巡檢）
- 內建 `scripts/sync_leaderboard.py` 與每週一 GitHub Actions 自動工作流程，從 LMArena 官方資料集 [`lmarena-ai/leaderboard-dataset`](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) 抓 Text Coding（style control）與 WebDev 兩榜的最新分數。
- 以 `data.js` 每個模型的 `arenaKey`／`arenaWebdevKey` 與榜上名稱完全比對；對不到時再以正規化名稱（小寫、括號與空白改連字號）比對，只接受唯一結果，不做模糊比對。2026-10-28 起資料集把 `model_name` 從代號（`kimi-k2.6`）改成顯示名稱（`Kimi K2.6`），兩種寫法都對得上。新增模型時把榜上的 `model_name` 填進這兩個欄位即可。
- 抓取失敗或一筆都沒對到時 workflow 會失敗（紅燈）；個別 key 不在榜上時以黃色警告列出，不會靜默保留舊分。
- 同步後用 `scripts/validate_data.mjs` 驗證 data.js（id 唯一、必要欄位、數字不是 NaN、實測紀錄對得到模型與檔位），推送前先 rebase。

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
無需任何 Node/Python 環境，直接以 Chrome / Edge / Firefox 開啟 `index.html` 即可立即使用所有功能。網頁只載入 repo 內的檔案，不依賴第三方 CDN。

### 修改介面或資料之後（開發者）
`assets/tailwind.css` 與 `vendor/` 是建置產物，跟著 repo 一起提交（GitHub Pages 不跑 npm）。改了 `index.html`、`app.js` 的 class 或圖示，或改了 `data.js` 之後：

```bash
npm ci
npm run build   # 重新產生 vendor/、assets/tailwind.css，並驗證 data.js
```

CI 會重新建置並比對，產物沒更新就會失敗。

---

## 專案結構
```
open-model-selector/
├── index.html              # 響應式單頁應用（預建 Tailwind CSS、精簡 lucide 圖示、Chart.js 延遲載入）
├── app.js                  # 核心邏輯、5問決策引擎、CanIRun 顯存與速度公式、GB10 實測分頁、硬體偵測
├── data.js                 # 模型資料庫、硬體設定檔、LOCAL_BENCHMARKS 實測紀錄、Day 16 方法論
├── assets/tailwind.css     # 建置產物：npm run build:css
├── vendor/                 # 建置產物：npm run vendor（Chart.js、只含用到圖示的 icons.js）
├── src/tailwind.css        # Tailwind 輸入檔
├── tailwind.config.js      # 莫蘭迪色票與字型設定
├── package.json            # 釘住版本的建置工具（tailwindcss、chart.js、lucide）
├── scripts/
│   ├── sync_leaderboard.py # 每週同步 LMArena 分數
│   ├── validate_data.mjs   # 驗證 data.js
│   └── copy_vendor.mjs     # 產生 vendor/
├── serve.py                # 輕量本地 Python 伺服器 (附自動開啟瀏覽器)
├── start.bat               # Windows 一鍵啟動腳本
└── README.md               # 完整說明文件
```
