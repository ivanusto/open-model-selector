"""
OpenModel Selector - Weekly Leaderboard Sync Script

從 LMArena 官方 HF 資料集（lmarena-ai/leaderboard-dataset）抓最新分數，更新 data.js：
  - arenaCodeElo   ← Text 榜 coding 類別（style control，與 arena.ai/leaderboard/text/coding 相同）
  - arenaWebdevElo ← WebDev 榜（arena.ai/leaderboard/code/webdev）
  - DATA_ASOF.arena ← 兩榜的發布日期

對照方式是 data.js 每個模型的 arenaKey／arenaWebdevKey 與榜上 model_name 完全比對；
對不到時再以正規化名稱（小寫、括號與空白改成連字號）比對一次，只接受唯一結果，不做模糊比對。
2026-10-28 起資料集把 model_name 從代號（kimi-k2.6）改成顯示名稱（Kimi K2.6），正規化可同時接受兩種寫法。
抓取失敗或一筆都沒對到時以 exit 1 結束，讓 GitHub Actions 顯示失敗，不會靜默成功。
有 key 卻不在榜上（例如榜上改名）時輸出 ::warning::，舊分數保留但會在 Actions 摘要上看得到。
"""

import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import pyarrow.parquet as pq
except ImportError:
    pq = None

DATA_JS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data.js")

DATASET = "lmarena-ai/leaderboard-dataset"
PARQUET_RESOLVE_URL = "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/{config}/latest-00000-of-00001.parquet"
PARQUET_LIST_URL = "https://datasets-server.huggingface.co/parquet"
FILTER_URL = "https://datasets-server.huggingface.co/filter"
PAGE = 100

BOARDS = {
    # 欄位名稱: (config, category)
    "arenaCodeElo": ("text_style_control", "coding"),
    "arenaWebdevElo": ("webdev", "webdev"),
}
KEY_FIELDS = {"arenaCodeElo": "arenaKey", "arenaWebdevElo": "arenaWebdevKey"}


def fetch_bytes(url, retries=4, timeout=60):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "OpenModelSelector-Sync/2.1"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            # 4xx 重試也不會好，直接交給呼叫端換路徑
            if 400 <= e.code < 500:
                raise RuntimeError(f"讀取失敗：{url}（HTTP {e.code}）") from e
            last = e
            time.sleep(3 * (attempt + 1))
        except Exception as e:
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"讀取失敗：{url}（{last}）")


def fetch_json(url, retries=4):
    return json.loads(fetch_bytes(url, retries=retries).decode("utf-8"))


def fetch_board_parquet(config, category):
    """直接從 HF Hub CDN 下載靜態 Parquet 檔並以 pyarrow 讀取，避開 datasets-server /filter 的 500 與逾時問題"""
    urls = [PARQUET_RESOLVE_URL.format(config=config)]
    raw_list = []
    try:
        raw_list.append(fetch_bytes(urls[0], retries=3))
    except Exception:
        # 若未來分片檔名變更，改由 /parquet 端點查詢實際 URL
        qs = urllib.parse.urlencode({"dataset": DATASET, "config": config, "split": "latest"})
        meta = fetch_json(f"{PARQUET_LIST_URL}?{qs}")
        parquet_urls = [f["url"] for f in meta.get("parquet_files", []) if f.get("url")]
        if not parquet_urls:
            raise RuntimeError(f"{config}/latest 找不到任何 Parquet 檔案")
        for u in parquet_urls:
            raw_list.append(fetch_bytes(u, retries=3))

    ratings, dates = {}, set()
    for raw in raw_list:
        table = pq.read_table(
            io.BytesIO(raw),
            filters=[("category", "=", category)],
            columns=["model_name", "rating", "leaderboard_publish_date"],
        )
        rows = table.to_pydict()
        for name, rating, pub_date in zip(
            rows.get("model_name", []),
            rows.get("rating", []),
            rows.get("leaderboard_publish_date", []),
        ):
            if name and rating is not None:
                ratings[name] = rating
            if pub_date:
                dates.add(str(pub_date))
    return finish_board(config, category, ratings, dates)


def finish_board(config, category, ratings, dates):
    if not ratings:
        raise RuntimeError(f"{config}/{category} 沒有任何資料")
    if not dates:
        raise RuntimeError(f"{config}/{category} 沒有發布日期")
    return ratings, max(dates)


def fetch_board(config, category):
    """回傳 {model_name: rating} 與發布日期"""
    if pq is not None:
        return fetch_board_parquet(config, category)

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
            if row.get("model_name") and row.get("rating") is not None:
                ratings[row["model_name"]] = row["rating"]
            if row.get("leaderboard_publish_date"):
                dates.add(str(row["leaderboard_publish_date"]))
        offset += len(rows)
        if not rows or offset >= data.get("num_rows_total", 0):
            break
    return finish_board(config, category, ratings, dates)


def norm_name(name):
    """Kimi K3 (Max) 與 kimi-k3-max 視為同一個名稱"""
    s = name.lower().replace("(", " ").replace(")", " ").replace(",", " ")
    return re.sub(r"[\s_]+", "-", s.strip()).strip("-")


def resolve_key(key, ratings):
    """完全比對優先；否則正規化後唯一相符才算對到"""
    if key in ratings:
        return key
    hits = [n for n in ratings if norm_name(n) == norm_name(key)]
    return hits[0] if len(hits) == 1 else None


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

    matched, changed, missing = 0, 0, []
    # 由後往前替換，前面區塊的位移不受影響
    for model_id, b_start, b_end in reversed(model_blocks(content)):
        block = content[b_start:b_end]
        new_block = block
        for field, key_field in KEY_FIELDS.items():
            km = re.search(rf"{key_field}: '([^']+)'", block)
            if not km:
                continue
            key = km.group(1)
            name = resolve_key(key, boards[field])
            if name is None:
                missing.append(f"{model_id} 的 {key_field}='{key}'")
                continue
            if name != key:
                print(f"提示：{model_id} 的 {key_field}='{key}' 以正規化對到榜上的 '{name}'")
            matched += 1
            val = round(boards[field][name], 1)
            new_block = re.sub(rf"({field}: )(null|[\d.]+)", rf"\g<1>{val}", new_block, count=1)
        if new_block != block:
            changed += 1
            content = content[:b_start] + new_block + content[b_end:]
            print(f"更新 {model_id}")

    for item in missing:
        # GitHub Actions 會把這行顯示成黃色警告；分數保留上一次的值
        print(f"::warning::{item} 不在榜上，保留舊分數")

    asof = f"text-coding {dates['arenaCodeElo']} / webdev {dates['arenaWebdevElo']}"
    head = content.index("const DATA_ASOF = {")
    tail = content.index("};", head)
    asof_block, n = re.subn(r"(\barena: )'[^']*'", rf"\g<1>'{asof}'", content[head:tail], count=1)
    content = content[:head] + asof_block + content[tail:]
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
