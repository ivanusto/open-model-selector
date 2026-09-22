"""
OpenModel Selector - Weekly Leaderboard Sync Script

從 LMArena 官方 HF 資料集（lmarena-ai/leaderboard-dataset）抓最新分數，更新 data.js：
  - arenaCodeElo   ← Text 榜 coding 類別（style control，與 arena.ai/leaderboard/text/coding 相同）
  - arenaWebdevElo ← WebDev 榜（arena.ai/leaderboard/code/webdev）
  - DATA_ASOF.arena ← 兩榜的發布日期

對照方式是 data.js 每個模型的 arenaKey／arenaWebdevKey（完全比對 model_name），不做模糊比對。
抓取失敗或一筆都沒對到時以 exit 1 結束，讓 GitHub Actions 顯示失敗，不會靜默成功。
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

DATA_JS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data.js")

DATASET = "lmarena-ai/leaderboard-dataset"
FILTER_URL = "https://datasets-server.huggingface.co/filter"
PAGE = 100

BOARDS = {
    # 欄位名稱: (config, category)
    "arenaCodeElo": ("text_style_control", "coding"),
    "arenaWebdevElo": ("webdev", "webdev"),
}
KEY_FIELDS = {"arenaCodeElo": "arenaKey", "arenaWebdevElo": "arenaWebdevKey"}


def fetch_json(url, retries=4):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "OpenModelSelector-Sync/2.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # datasets-server 的 /filter 偶爾回 500，重試即可
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"讀取失敗：{url}（{last}）")


def fetch_board(config, category):
    """回傳 {model_name: rating} 與發布日期"""
    where = f"\"category\"='{category}'"
    ratings, dates, offset = {}, set(), 0
    while True:
        qs = urllib.parse.urlencode({
            "dataset": DATASET, "config": config, "split": "latest",
            "where": where, "offset": offset, "length": PAGE,
        })
        data = fetch_json(f"{FILTER_URL}?{qs}")
        rows = data.get("rows", [])
        for r in rows:
            row = r["row"]
            ratings[row["model_name"]] = row["rating"]
            dates.add(row.get("leaderboard_publish_date"))
        offset += len(rows)
        if not rows or offset >= data.get("num_rows_total", 0):
            break
    if not ratings:
        raise RuntimeError(f"{config}/{category} 沒有任何資料")
    return ratings, max(d for d in dates if d)


def model_blocks(content):
    """切出 MODELS_DATABASE 裡每個模型物件的 (id, start, end)，只在區塊內替換，避免跨模型誤改"""
    start = content.index("const MODELS_DATABASE = [")
    end = content.index("\n];", start)
    heads = [m for m in re.finditer(r"\n  \{\n    id: '([^']+)'", content[start:end])]
    blocks = []
    for i, m in enumerate(heads):
        b_start = start + m.start()
        b_end = start + heads[i + 1].start() if i + 1 < len(heads) else end
        blocks.append((m.group(1), b_start, b_end))
    return blocks


def main():
    print("=" * 60)
    print("OpenModel Selector 天梯榜同步（來源：LMArena 官方資料集）")
    print("=" * 60)

    boards, dates = {}, {}
    for field, (config, category) in BOARDS.items():
        ratings, date = fetch_board(config, category)
        boards[field], dates[field] = ratings, date
        print(f"{config}/{category}：{len(ratings)} 個模型，發布日期 {date}")

    with open(DATA_JS_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    matched, changed = 0, 0
    # 由後往前替換，前面區塊的位移不受影響
    for model_id, b_start, b_end in reversed(model_blocks(content)):
        block = content[b_start:b_end]
        new_block = block
        for field, key_field in KEY_FIELDS.items():
            km = re.search(rf"{key_field}: '([^']+)'", block)
            if not km:
                continue
            key = km.group(1)
            if key not in boards[field]:
                print(f"警告：{model_id} 的 {key_field}='{key}' 不在榜上")
                continue
            matched += 1
            val = round(boards[field][key], 1)
            new_block = re.sub(rf"({field}: )(null|[\d.]+)", rf"\g<1>{val}", new_block, count=1)
        if new_block != block:
            changed += 1
            content = content[:b_start] + new_block + content[b_end:]
            print(f"更新 {model_id}")

    asof = f"text-coding {dates['arenaCodeElo']} / webdev {dates['arenaWebdevElo']}"
    content, n = re.subn(r"(const DATA_ASOF = \{\s*arena: )'[^']*'", rf"\g<1>'{asof}'", content, count=1)
    if n != 1:
        print("錯誤：data.js 找不到 DATA_ASOF.arena")
        sys.exit(1)

    if matched == 0:
        print("錯誤：沒有任何模型對到榜上名稱，請檢查資料集格式或 arenaKey")
        sys.exit(1)

    with open(DATA_JS_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"完成：對到 {matched} 筆分數，{changed} 個模型有變動。")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"錯誤：{e}")
        sys.exit(1)
