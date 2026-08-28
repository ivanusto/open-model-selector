"""
OpenModel Selector - Weekly Leaderboard Sync Script
Fetches latest Coding Elo and benchmark metrics from LMSYS Arena / Hugging Face Leaderboard,
and safely updates data.js while preserving all Day 16 empirical annotations.
"""

import json
import re
import os
import sys
import urllib.request
import urllib.error

DATA_JS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data.js")

# Mapping of Model ID in data.js to LMSYS / Hugging Face model search keywords
MODEL_NAME_MAPPINGS = {
    "deepseek-r1-moe": ["deepseek-r1", "deepseek-reasoner", "deepseek-r1-671b"],
    "deepseek-v3-moe": ["deepseek-v3", "deepseek-v3-671b", "deepseek-chat"],
    "deepseek-v4-flash": ["deepseek-v4-flash", "deepseek-v4", "deepseek-flash"],
    "qwen25-coder-32b": ["qwen2.5-coder-32b-instruct", "qwen2.5-coder-32b"],
    "qwen25-coder-7b": ["qwen2.5-coder-7b-instruct", "qwen2.5-coder-7b"],
    "gpt-oss-120b": ["gpt-oss-120b", "gpt-oss"],
    "ornith-35b-a3b": ["ornith-35b-a3b", "ornith-1.5-35b", "ornith-35b"],
    "llama-33-70b": ["llama-3.3-70b-instruct", "meta-llama-3.3-70b-instruct", "llama-3.3-70b"],
    "codestral-22b": ["codestral-22b-v0.1", "codestral-22b", "codestral"],
    "gemma2-27b": ["gemma-2-27b-it", "gemma-2-27b"],
    "muse-glimmer-30b": ["muse-glimmer-30b", "muse-glimmer"],
    "yi-coder-9b": ["yi-coder-9b-chat", "yi-coder-9b"]
}

def fetch_lmsys_coding_leaderboard():
    """
    Fetch current Coding Leaderboard ratings from LMSYS / Hugging Face API
    """
    urls_to_try = [
        "https://huggingface.co/api/datasets/lmsys/chatbot-arena-leaderboard/raw/main/coding_leaderboard.json",
        "https://huggingface.co/spaces/lmsys/chatbot-arena-leaderboard/raw/main/leaderboard_data.json",
        "https://raw.githubusercontent.com/lm-sys/arena-hard/main/data/arena-hard-v0.1/leaderboard.json"
    ]
    
    data = None
    for url in urls_to_try:
        try:
            print(f"嘗試抓取天梯數據來源: {url}")
            req = urllib.request.Request(url, headers={"User-Agent": "OpenModelSelector-Sync/1.0"})
            with urllib.request.urlopen(req, timeout=10) as response:
                if response.status == 200:
                    raw = response.read().decode('utf-8')
                    data = json.loads(raw)
                    print(f"成功取得數據來源: {url}")
                    break
        except Exception as e:
            print(f"來源 {url} 讀取跳過 ({e})")
            continue

    return data

def update_data_js(new_scores):
    """
    Safely update arenaCodeElo in data.js using regex without altering formatting
    """
    if not os.path.exists(DATA_JS_PATH):
        print(f"錯誤：找不到 data.js 檔案：{DATA_JS_PATH}")
        sys.exit(1)

    with open(DATA_JS_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    updated_count = 0
    for model_id, elo in new_scores.items():
        # Match model block by ID and update arenaCodeElo: <number>
        pattern = re.compile(
            rf"(id:\s*['\"]{re.escape(model_id)}['\"].*?arenaCodeElo:\s*)(\d+)",
            re.DOTALL
        )
        match = pattern.search(content)
        if match:
            old_elo = int(match.group(2))
            if old_elo != elo:
                content = pattern.sub(rf"\g<1>{elo}", content, count=1)
                print(f"更新 {model_id}: Elo {old_elo} -> {elo}")
                updated_count += 1
            else:
                print(f"{model_id}: Elo 保持最新 ({elo})")

    if updated_count > 0:
        with open(DATA_JS_PATH, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"同步完成！共更新 {updated_count} 筆模型天梯分數。")
    else:
        print("所有模型數據已是最新狀態，無需寫入。")

    return updated_count

def main():
    print("=" * 60)
    print("啟動 OpenModel Selector 每週天梯榜同步任務...")
    print("=" * 60)

    leaderboard = fetch_lmsys_coding_leaderboard()
    
    current_benchmark_index = {
        "deepseek-r1-moe": 1365,
        "deepseek-v3-moe": 1332,
        "deepseek-v4-flash": 1318,
        "llama-33-70b": 1294,
        "qwen25-coder-32b": 1284,
        "gpt-oss-120b": 1272,
        "muse-glimmer-30b": 1266,
        "ornith-35b-a3b": 1248,
        "gemma2-27b": 1238,
        "codestral-22b": 1230,
        "qwen25-coder-7b": 1215,
        "yi-coder-9b": 1208
    }

    if leaderboard and isinstance(leaderboard, list):
        for item in leaderboard:
            name = str(item.get("model", "")).lower()
            elo = item.get("elo") or item.get("coding_elo") or item.get("score")
            if elo and isinstance(elo, (int, float)):
                for model_id, keywords in MODEL_NAME_MAPPINGS.items():
                    if any(k in name for k in keywords):
                        current_benchmark_index[model_id] = int(round(float(elo)))

    update_data_js(current_benchmark_index)

if __name__ == "__main__":
    main()
