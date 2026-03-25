"""実試合ログ収集・解析スクリプト。

Google Drive の公開フォルダから .log.gz ファイルをダウンロードし、
ssl_log_parser.extract_full_analysis() でフル解析して JSON を出力する。

出力:
  public/analysis-data/{id}.json  — 個別試合データ
  public/analysis-index.json      — 一覧メタデータ
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

import ssl_log_parser

GDRIVE_FOLDER_ID = "1Z_kMspBYE7Cj15tJSIKDWFPdfwco7nED"

# スクリプトはリポジトリルートから実行されることを前提とするが、
# scripts/ ディレクトリから実行された場合でも正しく動作するよう CWD を基準にする
_REPO_ROOT = pathlib.Path(os.getcwd())
CACHE_DIR = _REPO_ROOT / "cache" / "reallog"
OUTPUT_DATA_DIR = _REPO_ROOT / "public" / "analysis-data"
OUTPUT_INDEX = _REPO_ROOT / "public" / "analysis-index.json"


# ---------------------------------------------------------------------------
# 引数解析
# ---------------------------------------------------------------------------
parser = argparse.ArgumentParser(description="Download and analyze real game logs from Google Drive.")
parser.add_argument(
    "--incremental",
    action="store_true",
    help="インクリメンタルモード: 既存の解析済みIDはスキップ",
)
parser.add_argument(
    "--folder-id",
    default=GDRIVE_FOLDER_ID,
    help="Google Drive フォルダID (デフォルト: %(default)s)",
)
args = parser.parse_args()

# ---------------------------------------------------------------------------
# ディレクトリ準備
# ---------------------------------------------------------------------------
CACHE_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DATA_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Google Drive からファイルをダウンロード
# ---------------------------------------------------------------------------
def download_gdrive_file(file_id: str, file_name: str) -> pathlib.Path:
    """指定ファイルをキャッシュにダウンロードして返す。キャッシュ済みならスキップ。"""
    dest = CACHE_DIR / file_name
    if dest.exists():
        print(f"  キャッシュ使用: {file_name}")
        return dest

    try:
        import gdown
    except ImportError:
        print("ERROR: gdown がインストールされていません。pip install gdown を実行してください。")
        sys.exit(1)

    url = f"https://drive.google.com/uc?id={file_id}"
    print(f"  ダウンロード中: {file_name} ...")
    gdown.download(url, str(dest), quiet=False)
    return dest


def download_folder_bulk(folder_id: str) -> list[pathlib.Path]:
    """フォルダを一括ダウンロードして .log.gz ファイルパス一覧を返す。"""
    try:
        import gdown
    except ImportError:
        print("ERROR: gdown がインストールされていません。pip install gdown を実行してください。")
        sys.exit(1)

    print(f"Google Drive フォルダ {folder_id} を一括ダウンロード中...")
    try:
        gdown.download_folder(
            id=folder_id,
            output=str(CACHE_DIR),
            quiet=False,
            use_cookies=False,
        )
    except Exception as e:
        print(f"フォルダダウンロード失敗: {e}")

    return sorted(CACHE_DIR.glob("*.log.gz"))


# ---------------------------------------------------------------------------
# インクリメンタルモード: 既存の解析済みIDを読み込む
# ---------------------------------------------------------------------------
existing_ids: set[str] = set()
if args.incremental and OUTPUT_INDEX.exists():
    try:
        with open(OUTPUT_INDEX, "r", encoding="utf-8") as f:
            prev = json.load(f)
        existing_ids = {m["id"] for m in prev.get("matches", [])}
        print(f"インクリメンタルモード: 既存 {len(existing_ids)} 試合をスキップ")
    except Exception as e:
        print(f"既存インデックス読み込み失敗: {e}")

# ---------------------------------------------------------------------------
# フォルダを一括ダウンロードして .log.gz ファイルを収集
# ---------------------------------------------------------------------------
log_files = download_folder_bulk(args.folder_id)

if not log_files:
    # フォールバック: キャッシュディレクトリにある既存ファイルのみ処理
    log_files = sorted(CACHE_DIR.glob("*.log.gz"))
    if not log_files:
        print("処理対象のログファイルが見つかりません。")
        sys.exit(0)

print(f"\n{len(log_files)} 件のログファイルを処理します。")

# ---------------------------------------------------------------------------
# 各ログを解析して JSON 出力
# ---------------------------------------------------------------------------
matches_meta: list[dict] = []
processed = 0
skipped = 0
errors = 0

for log_path in log_files:
    filename = log_path.name

    # JSON キャッシュキー (ファイル名ベース)
    base = log_path.stem
    if base.endswith(".log"):
        base = base[:-4]
    match_id = base.replace(" ", "_").replace("/", "_").replace("\\", "_")

    if args.incremental and match_id in existing_ids:
        print(f"スキップ (既存): {filename}")
        # 既存の JSON からメタデータを読み込んで一覧に追加
        out_path = OUTPUT_DATA_DIR / f"{match_id}.json"
        if out_path.exists():
            try:
                with open(out_path, "r", encoding="utf-8") as f:
                    d = json.load(f)
                matches_meta.append(d["meta"])
            except Exception:
                pass
        skipped += 1
        continue

    # JSON キャッシュが既に存在する場合はスキップ
    out_path = OUTPUT_DATA_DIR / f"{match_id}.json"
    if out_path.exists() and not args.incremental:
        print(f"解析済みキャッシュ使用: {filename}")
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                d = json.load(f)
            matches_meta.append(d["meta"])
        except Exception:
            pass
        skipped += 1
        continue

    print(f"解析中: {filename}")
    try:
        log_gz_bytes = log_path.read_bytes()
        analysis = ssl_log_parser.extract_full_analysis(log_gz_bytes, filename=filename)
    except Exception as e:
        print(f"  解析失敗: {e}")
        errors += 1
        continue

    # 個別 JSON を出力
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, separators=(",", ":"))
    print(
        f"  完了: {analysis['meta']['teams']['yellow']} {analysis['meta']['final_score']['yellow']}"
        f" - {analysis['meta']['final_score']['blue']} {analysis['meta']['teams']['blue']}"
        f"  ({analysis['meta']['duration_sec']:.0f}s, "
        f"{len(analysis['replay_frames'])}フレーム, "
        f"{len(analysis['goal_scenes'])}ゴール)"
    )

    matches_meta.append(analysis["meta"])
    processed += 1

# ---------------------------------------------------------------------------
# インデックス JSON を出力
# ---------------------------------------------------------------------------
# 日付でソート (ファイル名に日付が含まれる場合)
matches_meta.sort(key=lambda m: m.get("filename", ""), reverse=True)

with open(OUTPUT_INDEX, "w", encoding="utf-8") as f:
    json.dump({"matches": matches_meta}, f, ensure_ascii=False, indent=2)

print(
    f"\n完了: 新規解析 {processed} 試合, スキップ {skipped} 試合, エラー {errors} 試合"
)
print(f"インデックス出力: {OUTPUT_INDEX} ({len(matches_meta)} 試合)")
