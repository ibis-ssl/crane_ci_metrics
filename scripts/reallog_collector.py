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


def list_gdrive_folder_files(folder_id: str) -> dict[str, str]:
    """Google Drive フォルダのファイル一覧を取得し {filename: file_id} を返す。

    gdown の内部 API を使用。失敗した場合は空 dict を返す。
    """
    try:
        from gdown.download import _get_session
        from gdown.download_folder import _download_and_parse_google_drive_link
    except ImportError:
        return {}

    _UA = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.95 Safari/537.36"
    )
    url = f"https://drive.google.com/drive/folders/{folder_id}"
    try:
        sess = _get_session(proxy=None, use_cookies=False, user_agent=_UA)
        ok, gdrive_file = _download_and_parse_google_drive_link(
            sess=sess, url=url, quiet=True, remaining_ok=True
        )
        if not ok or gdrive_file is None:
            return {}
        return {child.name: child.id for child in gdrive_file.children}
    except Exception as e:
        print(f"フォルダ一覧取得失敗 (ダウンロードリンクなし): {e}")
        return {}


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


def _load_meta_from_json(out_path: pathlib.Path, gdrive_url: str | None) -> dict | None:
    """JSON を読み込み、必要なら gdrive_url を更新して meta を返す。失敗時は None。"""
    try:
        with open(out_path, "r", encoding="utf-8") as f:
            d = json.load(f)
        meta = d["meta"]
        if gdrive_url and meta.get("gdrive_url") != gdrive_url:
            meta["gdrive_url"] = gdrive_url
            with open(out_path, "w", encoding="utf-8") as fw:
                json.dump(d, fw, ensure_ascii=False, separators=(",", ":"))
        return meta
    except Exception:
        return None


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
# フォルダのファイル一覧を取得してダウンロード
# gdrive_files が取得できた場合は個別ダウンロードで重複ネットワーク呼び出しを回避する
# ---------------------------------------------------------------------------
print("Google Drive フォルダのファイル一覧を取得中...")
gdrive_files: dict[str, str] = list_gdrive_folder_files(args.folder_id)

if gdrive_files:
    print(f"  {len(gdrive_files)} 件のファイルIDを取得")
    for fname, fid in gdrive_files.items():
        if fname.endswith(".log.gz"):
            download_gdrive_file(fid, fname)
    log_files = sorted(CACHE_DIR.glob("*.log.gz"))
else:
    print("  ファイルID取得失敗 (ダウンロードリンクなし)")
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

    file_id = gdrive_files.get(filename)
    gdrive_url = f"https://drive.google.com/file/d/{file_id}/view" if file_id else None

    if args.incremental and match_id in existing_ids:
        print(f"スキップ (既存): {filename}")
        out_path = OUTPUT_DATA_DIR / f"{match_id}.json"
        if out_path.exists():
            meta = _load_meta_from_json(out_path, gdrive_url)
            if meta:
                matches_meta.append(meta)
        skipped += 1
        continue

    # JSON キャッシュが既に存在する場合はスキップ
    out_path = OUTPUT_DATA_DIR / f"{match_id}.json"
    if out_path.exists() and not args.incremental:
        print(f"解析済みキャッシュ使用: {filename}")
        meta = _load_meta_from_json(out_path, gdrive_url)
        if meta:
            matches_meta.append(meta)
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

    if gdrive_url:
        analysis["meta"]["gdrive_url"] = gdrive_url

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
