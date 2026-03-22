from datetime import datetime, timedelta
import re
import argparse
import json
import pathlib

import github_api

REPO = "ibis-ssl/crane"
MATCH_WORKFLOW_ID = "match-vs-tigers.yaml"
CACHE_DIR = "./cache/"


def try_cache(key: str, f):
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
            json.dump(result, cache_file, indent=4, ensure_ascii=False)
        return result


def parse_match_result(text: str) -> dict | None:
    result = {}

    m = re.search(r"試合時間: ([\d.]+)秒", text)
    if not m:
        return None
    result["duration_sec"] = float(m.group(1))

    m = re.search(r"最終スコア: ibis (\d+) - (\d+) TIGERs Mannheim", text)
    if not m:
        return None
    result["score_ibis"] = int(m.group(1))
    result["score_tigers"] = int(m.group(2))

    m = re.search(r"結果: (.+)", text)
    if not m:
        return None
    result["result"] = m.group(1).strip()

    m = re.search(r"イベント数: (\d+)", text)
    result["event_count"] = int(m.group(1)) if m else 0

    def parse_team_fouls(section_text: str) -> dict:
        fouls = {"yellow_cards": 0, "foul_count": 0, "final_robots": 0, "breakdown": {}}
        m = re.search(r"イエローカード: (\d+)枚", section_text)
        if m:
            fouls["yellow_cards"] = int(m.group(1))
        m = re.search(r"ファウルカウント: (\d+)", section_text)
        if m:
            fouls["foul_count"] = int(m.group(1))
        m = re.search(r"最終出場可能台数: (\d+)", section_text)
        if m:
            fouls["final_robots"] = int(m.group(1))
        breakdown_section = re.search(r"ファウル内訳:(.*?)(?=\n[A-Z]|\Z)", section_text, re.DOTALL)
        if breakdown_section:
            for match in re.finditer(r"(\w+): (\d+)回", breakdown_section.group(1)):
                fouls["breakdown"][match.group(1)] = int(match.group(2))
        return fouls

    yellow_section = re.search(r"YELLOW \(ibis\):(.*?)(?=BLUE \(TIGERs|\Z)", text, re.DOTALL)
    blue_section = re.search(r"BLUE \(TIGERs Mannheim\):(.*?)(?===|\Z)", text, re.DOTALL)

    result["fouls"] = {
        "ibis": parse_team_fouls(yellow_section.group(1)) if yellow_section else {},
        "tigers": parse_team_fouls(blue_section.group(1)) if blue_section else {},
    }

    return result


parser = argparse.ArgumentParser(description="Fetch match-vs-tigers result data.")
parser.add_argument("--github_token", required=True)
args = parser.parse_args()

workflow_api = github_api.GitHubWorkflowAPI(args.github_token)

workflow_runs = workflow_api.get_workflow_duration_list(REPO, MATCH_WORKFLOW_ID, accurate=False)

cutoff_date = datetime.now() - timedelta(days=90)
workflow_runs = [r for r in workflow_runs if r["created_at"] > cutoff_date]

matches = []

for run in workflow_runs:
    if run["conclusion"] != "success":
        continue

    run_id = run["id"]
    head_sha = run.get("head_sha", "")

    try:
        artifacts = try_cache(
            f"match-artifacts-{REPO}-{run_id}",
            lambda: workflow_api.get_run_artifacts(REPO, run_id),
        )
    except Exception as e:
        print(f"run_id={run_id}: アーティファクト一覧取得失敗: {e}")
        continue

    match_artifact = next(
        (a for a in artifacts if a.get("name", "").startswith("match-result-")), None
    )
    if match_artifact is None:
        print(f"run_id={run_id}: match-result アーティファクトなし")
        continue

    artifact_id = match_artifact["id"]

    try:
        files = try_cache(
            f"match-artifact-{REPO}-{artifact_id}",
            lambda: workflow_api.download_artifact(REPO, artifact_id),
        )
    except Exception as e:
        print(f"run_id={run_id}: アーティファクトダウンロード失敗: {e}")
        continue

    result_text = files.get("match_result.txt")
    if result_text is None:
        print(f"run_id={run_id}: match_result.txt が見つかりません")
        continue

    parsed = parse_match_result(result_text)
    if parsed is None:
        print(f"run_id={run_id}: match_result.txt のパース失敗")
        continue

    matches.append({
        "run_id": run_id,
        "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
        "head_sha": head_sha[:7] if head_sha else "",
        "branch": run.get("head_branch", ""),
        **parsed,
    })

matches.sort(key=lambda m: m["date"])

total = len(matches)
wins = losses = draws = 0
for m in matches:
    if m["result"] == "CRANE WIN":
        wins += 1
    elif m["result"] == "TIGERs WIN":
        losses += 1
    elif m["result"] == "DRAW":
        draws += 1

json_data = {
    "matches": matches,
    "summary": {
        "total": total,
        "wins": wins,
        "losses": losses,
        "draws": draws,
        "win_rate": round(wins / total * 100, 1) if total > 0 else 0,
    },
}

with open("match_data.json", "w", encoding="utf-8") as f:
    json.dump(json_data, f, indent=4, ensure_ascii=False)

print(f"完了: {total}試合分のデータを match_data.json に書き出しました")
print(f"  勝利: {wins}, 敗北: {losses}, 引き分け: {draws}")
