"""Collects goal scene data from SSL game logs in CI artifacts."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import argparse
import json
import pathlib

import github_api
import ssl_log_parser

REPO = "ibis-ssl/crane"
MATCH_WORKFLOW_ID = "match-vs-tigers.yaml"
CACHE_DIR = "./cache/"


def try_cache_json(key: str, f):
    key = key.replace("/", "_")
    cache_path = pathlib.Path(CACHE_DIR) / key

    if cache_path.exists():
        with open(cache_path, "r") as cache_file:
            return json.load(cache_file)
    else:
        result = f()
        if result is None:
            raise Exception("Result is None")
        with open(cache_path, "w") as cache_file:
            json.dump(result, cache_file, indent=2, ensure_ascii=False)
        return result


def find_log_artifact(artifacts: list) -> dict | None:
    """アーティファクト一覧からSSL game logを含むものを探す。

    アーティファクト名: match-ssl-log-{sha}
    """
    for a in artifacts:
        name = a.get("name", "")
        if name.startswith("match-ssl-log-"):
            return a
    # フォールバック: ログ関連のキーワードで検索
    for a in artifacts:
        name = a.get("name", "").lower()
        if "ssl-log" in name or "game-log" in name or "gamelog" in name:
            return a
    return None


parser = argparse.ArgumentParser(description="Fetch goal scene data from SSL game logs.")
parser.add_argument("--github_token", required=True)
parser.add_argument("--list-artifacts", action="store_true", help="アーティファクト名を一覧表示して終了")
parser.add_argument(
    "--incremental",
    action="store_true",
    help="インクリメンタルモード: 新規データのみ追加し既存データを保持する",
)
args = parser.parse_args()

workflow_api = github_api.GitHubWorkflowAPI(args.github_token)

# インクリメンタルモード: 前回の出力JSONを読み込む
prev_scenes = []
existing_run_ids = set()
if args.incremental:
    prev_cache = pathlib.Path(CACHE_DIR) / "goal_scenes.json"
    if prev_cache.exists():
        with open(prev_cache, "r") as f:
            prev_data = json.load(f)
        prev_scenes = prev_data.get("scenes", [])
        existing_run_ids = {s["run_id"] for s in prev_scenes}
        print(f"インクリメンタルモード: 既存 {len(existing_run_ids)} 件のrunをスキップ")
    else:
        print("インクリメンタルモード: 前回データなし、フルモードで実行します")

cutoff_date = datetime.now() - timedelta(days=90)
workflow_runs = workflow_api.get_workflow_duration_list(REPO, MATCH_WORKFLOW_ID, accurate=False, cutoff_date=cutoff_date)

workflow_runs = [r for r in workflow_runs if r["created_at"] > cutoff_date]
workflow_runs = [r for r in workflow_runs if r["conclusion"] == "success"]

if args.list_artifacts:
    print("=== アーティファクト一覧 (最新5件) ===")
    for run in workflow_runs[-5:]:
        run_id = run["id"]
        try:
            artifacts = try_cache_json(
                f"goal-artifacts-{REPO}-{run_id}",
                lambda: workflow_api.get_run_artifacts(REPO, run_id),
            )
            print(f"\nrun_id={run_id} ({run['created_at'].strftime('%Y/%m/%d')}):")
            for a in artifacts:
                print(f"  - {a['name']} (id={a['id']}, size={a.get('size_in_bytes', '?')}B)")
        except Exception as e:
            print(f"  取得失敗: {e}")
    import sys
    sys.exit(0)

all_scenes = []
processed_runs = 0
skipped_no_artifact = 0
skipped_no_log = 0

# キャッシュヒットのrunを先に処理し、キャッシュミスのrunを並列処理対象にする
runs_to_fetch = []
for run in workflow_runs:
    run_id = run["id"]
    if run_id in existing_run_ids:
        continue

    date_str = run["created_at"].strftime("%Y/%m/%d %H:%M:%S")

    scene_cache_key = f"goal-scenes-{REPO}-{run_id}"
    scene_cache_path = pathlib.Path(CACHE_DIR) / scene_cache_key.replace("/", "_")
    if scene_cache_path.exists():
        with open(scene_cache_path, "r") as f:
            cached = json.load(f)
        for scene in cached:
            scene["run_id"] = run_id
            scene["date"] = date_str
        all_scenes.extend(cached)
        processed_runs += 1
    else:
        runs_to_fetch.append(run)


def process_run(run):
    """1つのrunのアーティファクトをダウンロードしてゴールシーンを抽出する。
    Returns (run_id, date_str, scenes, status) where status is 'ok', 'no_artifact', 'no_log', or 'error'.
    """
    run_id = run["id"]
    date_str = run["created_at"].strftime("%Y/%m/%d %H:%M:%S")

    try:
        artifacts = try_cache_json(
            f"goal-artifacts-{REPO}-{run_id}",
            lambda: workflow_api.get_run_artifacts(REPO, run_id),
        )
    except Exception as e:
        print(f"run_id={run_id}: アーティファクト一覧取得失敗: {e}")
        return run_id, date_str, None, "error"

    log_artifact = find_log_artifact(artifacts)
    if log_artifact is None:
        return run_id, date_str, None, "no_artifact"

    artifact_id = log_artifact["id"]
    artifact_name = log_artifact["name"]

    try:
        files = workflow_api.download_artifact(REPO, artifact_id)
    except Exception as e:
        print(f"run_id={run_id}: アーティファクトダウンロード失敗: {e}")
        return run_id, date_str, None, "error"

    log_gz_data = None
    log_filename = None
    for filename, content in files.items():
        if isinstance(content, bytes) and filename.endswith(".log.gz"):
            log_gz_data = content
            log_filename = filename
            break

    if log_gz_data is None:
        print(f"run_id={run_id}: .log.gz ファイルが {artifact_name} に見つかりません (files: {list(files.keys())})")
        return run_id, date_str, None, "no_log"

    try:
        scenes = ssl_log_parser.extract_goal_scenes(log_gz_data)
        print(f"run_id={run_id} ({date_str}): {len(scenes)} ゴールシーン抽出 ({log_filename})")
    except Exception as e:
        print(f"run_id={run_id}: ログパース失敗: {e}")
        return run_id, date_str, None, "error"

    scene_cache_key = f"goal-scenes-{REPO}-{run_id}"
    scene_cache_path = pathlib.Path(CACHE_DIR) / scene_cache_key.replace("/", "_")
    with open(scene_cache_path, "w") as f:
        json.dump(scenes, f, indent=2, ensure_ascii=False)

    return run_id, date_str, scenes, "ok"


MAX_WORKERS = 4
with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
    futures = {executor.submit(process_run, run): run for run in runs_to_fetch}
    for future in as_completed(futures):
        run_id, date_str, scenes, status = future.result()
        if status == "ok":
            for scene in scenes:
                scene["run_id"] = run_id
                scene["date"] = date_str
            all_scenes.extend(scenes)
            processed_runs += 1
        elif status == "no_artifact":
            skipped_no_artifact += 1
        elif status == "no_log":
            skipped_no_log += 1

# ゴールシーン一覧を出力（前回データと合算）
merged_scenes = prev_scenes + all_scenes
output = {"scenes": merged_scenes}
with open("goal_scenes.json", "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"\n完了: 新規 {processed_runs}試合/{len(all_scenes)}シーン追加 (既存 {len(prev_scenes)}シーンと合計 {len(merged_scenes)}シーン)")
print(f"  (アーティファクトなし: {skipped_no_artifact}, ログなし: {skipped_no_log})")
