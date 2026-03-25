from datetime import datetime, timedelta
import re
import argparse
import pathlib
import json

import github_api
from colcon_log_analyzer import ColconLogAnalyzer
from dxf import DXF

import numpy as np

# Constant
REPO = "ibis-ssl/crane"

BUILD_WORKFLOW_ID = "full_build.yaml"
BUILD_LOG_ID = "0_FullBuild (jazzy).txt"

DOCKER_ORGS = "ibis-ssl"
DOCKER_IMAGE = "crane"

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
            json.dump(result, cache_file, indent=4)
        return result


# Setup argparse to parse command-line arguments
parser = argparse.ArgumentParser(
    description="Fetch GitHub Action's run data and plot it."
)
parser.add_argument(
    "--github_token",
    required=True,
    help="GitHub Token to authenticate with GitHub API.",
)
parser.add_argument(
    "--github_actor",
    required=True,
    help="GitHub username to authenticate with GitHub API (Packages).",
)
parser.add_argument(
    "--incremental",
    action="store_true",
    help="インクリメンタルモード: 新規データのみ追加し既存データを保持する",
)
args = parser.parse_args()

# Use the github_token passed as command-line argument
github_token = args.github_token
github_actor = args.github_actor

workflow_api = github_api.GitHubWorkflowAPI(github_token)

prev_data = None
existing_run_ids = set()
existing_durations = {}
if args.incremental:
    prev_cache = pathlib.Path(CACHE_DIR) / "github_action_data.json"
    if prev_cache.exists():
        with open(prev_cache, "r") as f:
            prev_data = json.load(f)
        for e in prev_data.get("workflow_time", []):
            existing_run_ids.add(e["run_id"])
            existing_durations[e["run_id"]] = e["duration"] * 3600  # hours -> seconds
        print(f"インクリメンタルモード: 既存 {len(existing_run_ids)} 件のrunをスキップ")
    else:
        print("インクリメンタルモード: 前回データなし、フルモードで実行します")

# 90日前をcutoff_dateとして渡し、ページネーションを早期終了する
cutoff_date = datetime.now() - timedelta(days=90) if args.incremental else None

workflow_runs = workflow_api.get_workflow_duration_list(
    REPO, BUILD_WORKFLOW_ID, accurate=True, cutoff_date=cutoff_date, skip_run_ids=existing_run_ids
)

# 既知のrunにdurationを補完
for run in workflow_runs:
    if run["id"] in existing_durations and "duration" not in run:
        run["duration"] = existing_durations[run["id"]]

####################
# Build time analysis
####################


# Exclude outliers (TODO: Fix outliers appears in inaccurate mode)
workflow_runs = [item for item in workflow_runs if item["duration"] < 3600 * 100]

####################
# Log analysis
####################

package_duration_logs = {}

# Fetch logs
# Log may be removed, so handling 404 error is necessary
for run in workflow_runs:
    # older than 90 days
    if (datetime.now() - run["created_at"]).days > 90:
        continue

    # skip
    if run["conclusion"] != "success":
        continue

    if run["id"] in existing_run_ids:
        continue

    try:
        logs = try_cache(
            f"{REPO}-{run['id']}",
            lambda: workflow_api.get_workflow_logs(REPO, run["id"]),
        )
    except Exception as e:
        print(f"Log for run_id={run['id']} cannot be fetched. {e}")
        continue

    if BUILD_LOG_ID in logs.keys():
        build_log_text = logs[BUILD_LOG_ID]
    analyzer = ColconLogAnalyzer(build_log_text)

    package_duration_list = analyzer.get_build_duration_list()

    # Sort by duration
    package_duration_list = sorted(package_duration_list, key=lambda k: -k[2])

    # Into KV
    package_duration_dict = {}

    for package in package_duration_list:
        package_duration_dict[package[0]] = package[2]

    package_duration_logs[run["id"]] = {
        "run_id": run["id"],
        "date": run["created_at"],
        "duration": package_duration_dict,
    }

####################
# Docker image analysis
####################

# package_api = github_api.GithubPackagesAPI(github_token)
# packages = package_api.get_all_containers(DOCKER_ORGS, DOCKER_IMAGE)


# def auth(dxf, response):
#     dxf.authenticate(github_actor, github_token, response=response)


# docker_images = []

# dxf = DXF("ghcr.io", f"{DOCKER_ORGS}/{DOCKER_IMAGE}", auth)
# for package in packages:
#     tag_count = len(package["metadata"]["container"]["tags"])
#     if tag_count == 0:
#         continue
#     tag = package["metadata"]["container"]["tags"][0]
#     if not tag.endswith("amd64") or "cuda" in tag or "prebuilt" not in tag:
#         continue

#     print(tag)
#     manifest = try_cache(f"docker_{tag}", lambda: dxf.get_manifest(tag))
#     if manifest is None:
#         print(f"Failed to fetch manifest for {tag}")
#         continue
#     metadata = json.loads(
#         (manifest["linux/amd64"] if type(manifest) is dict else manifest)
#     )
#     # print(metadata)

#     total_size = sum([layer["size"] for layer in metadata["layers"]])
#     docker_images.append(
#         {
#             "size": total_size,
#             "date": package["updated_at"].strftime("%Y/%m/%d %H:%M:%S"),
#             "tag": tag,
#         }
#     )


####################
# Output JSON for Pages
####################

new_entries = []
for run in workflow_runs:
    if run["id"] in existing_run_ids:
        continue
    new_entries.append(
        {
            "run_id": run["id"],
            "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
            "duration": run["duration"] / 3600,
            "details": package_duration_logs[run["id"]]["duration"]
            if run["id"] in package_duration_logs
            else None,
        }
    )

existing_entries = prev_data["workflow_time"] if prev_data else []
json_data = {
    "workflow_time": existing_entries + new_entries,
    # "docker_images": docker_images,
}

print(f"新規 {len(new_entries)} 件を追加 (既存 {len(existing_entries)} 件と合計 {len(json_data['workflow_time'])} 件)")

# Save the data to a JSON file
with open("github_action_data.json", "w") as jsonfile:
    json.dump(json_data, jsonfile, indent=4)
