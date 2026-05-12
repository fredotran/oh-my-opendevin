#!/usr/bin/env python3
# /// script
# dependencies = []
# ///
"""
Devin CLI Test Reporter
========================

Retrieves and summarizes all Devin CLI sessions (both direct CLI and MCP-spawned)
to verify tiered model routing, execution times, and session outcomes.

Usage:
    uv run scripts/devin-test-reporter.py          # Full report
    uv run scripts/devin-test-reporter.py --json   # JSON output for CI
    uv run scripts/devin-test-reporter.py --tier <tier>  # Filter by tier

Note on model tracking:
    - CLI sessions: `devin list --format json` does NOT include model.
      Model is only visible in the live interactive session.
    - MCP sessions: The MCP server stores metadata in-memory only.
      Log files (.log) contain output but not the resolved model.
    - To track models reliably, use this script WHILE sessions are active
      via MCP `devin_list` / `devin_status` tools, or inspect the session
      store state in the running MCP server process.

Outputs:
    - Session count by source (CLI vs MCP)
    - Status breakdown
    - Activity timeline
    - Per-session details (prompt, cwd, timestamps, log sizes)
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ─── Configuration ───────────────────────────────────────────────────────────

MCP_LOG_DIR = Path("/tmp/oh-my-opencode-devin-mcp")
TIER_MAP = {
    "kimi-k2.6": ("Standard", "omit model"),
    "swe-1-6": ("Fast/Cheap", '"swe"'),
    "codex": ("Code Gen", '"codex"'),
    "sonnet": ("Balanced", '"sonnet"'),
    "opus": ("Deep", '"opus"'),
}


def run_devin_list() -> list[dict]:
    """Run `devin list --format json` and return parsed sessions."""
    try:
        result = subprocess.run(
            ["devin", "list", "--format", "json"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            print(f"[warn] devin list failed: {result.stderr.strip()}", file=sys.stderr)
            return []
        data = json.loads(result.stdout)
        return data if isinstance(data, list) else data.get("sessions", [])
    except FileNotFoundError:
        print("[warn] 'devin' CLI not found in PATH. Skipping direct CLI sessions.", file=sys.stderr)
        return []
    except json.JSONDecodeError as e:
        print(f"[warn] Failed to parse devin list JSON: {e}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"[warn] devin list error: {e}", file=sys.stderr)
        return []


def get_mcp_sessions() -> list[dict]:
    """Scan MCP server log directory for session log files."""
    sessions = []
    if not MCP_LOG_DIR.exists():
        print(f"[info] MCP log dir not found: {MCP_LOG_DIR}", file=sys.stderr)
        return sessions

    log_files = sorted(MCP_LOG_DIR.glob("*.log"))
    for log_file in log_files:
        try:
            sid = log_file.stem
            stat = log_file.stat()
            start_time = datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat()
            end_time = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            size = stat.st_size

            # Try to extract prompt from first lines of log
            prompt = ""
            try:
                with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                    first_lines = f.read(2048)
                    # Look for common prompt markers
                    lines = first_lines.strip().split("\n")
                    if lines and lines[0].strip():
                        prompt = lines[0].strip()
            except Exception:
                pass

            # Try to infer model from log content (model may be mentioned)
            inferred_model = "unknown"
            try:
                with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read(8192)
                    for model_name in TIER_MAP:
                        if model_name in content:
                            inferred_model = model_name
                            break
            except Exception:
                pass

            sessions.append({
                "id": sid,
                "model": inferred_model,
                "status": "unknown",  # MCP server doesn't persist status to disk
                "prompt": prompt[:120] + "..." if len(prompt) > 120 else prompt,
                "cwd": "",
                "start_time": start_time,
                "end_time": end_time,
                "source": "mcp",
                "log_size_bytes": size,
            })
        except Exception as e:
            print(f"[warn] Failed to read {log_file}: {e}", file=sys.stderr)

    return sessions


def parse_unix_ts(ts: int | None) -> datetime | None:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (ValueError, OSError, OverflowError):
        return None


def parse_iso(dt_str: str | None) -> datetime | None:
    if not dt_str:
        return None
    dt_str = dt_str.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(dt_str)
    except ValueError:
        return None


def compute_duration(start: datetime | None, end: datetime | None) -> float | None:
    if start and end:
        return (end - start).total_seconds()
    return None


def get_tier_info(model: str) -> tuple[str, str]:
    """Return (tier_name, keyword) for a resolved model."""
    for resolved, (tier, keyword) in TIER_MAP.items():
        if resolved in model or model == resolved:
            return tier, keyword
    return "Unknown", model


def build_report(cli_sessions: list[dict], mcp_sessions: list[dict]) -> dict:
    """Build a structured report from all sessions."""
    all_sessions = []

    for s in cli_sessions:
        start = parse_unix_ts(s.get("last_activity_at"))
        # CLI list doesn't have end time or status, use last activity as proxy
        all_sessions.append({
            "id": s.get("id", s.get("session_id", "unknown")),
            "model": "unknown",  # devin list JSON doesn't include model
            "status": "unknown",
            "prompt": s.get("title", s.get("initial_prompt", ""))[:120],
            "cwd": s.get("working_directory", s.get("working_directory_display", "")),
            "start_time": start.isoformat() if start else None,
            "end_time": None,
            "source": "cli",
            "log_size_bytes": 0,
            "last_activity_ago": s.get("last_activity_ago", ""),
        })

    all_sessions.extend(mcp_sessions)

    # Enrich with tier info and durations
    for s in all_sessions:
        s["tier"], s["keyword"] = get_tier_info(s["model"])
        start = parse_iso(s["start_time"])
        end = parse_iso(s["end_time"])
        s["duration_seconds"] = compute_duration(start, end)
        s["start_pretty"] = start.strftime("%Y-%m-%d %H:%M:%S") if start else "N/A"
        s["end_pretty"] = end.strftime("%Y-%m-%d %H:%M:%S") if end else "N/A"

    # Aggregations
    by_tier = defaultdict(lambda: {"count": 0, "total_duration": 0.0, "models": set()})
    by_status = defaultdict(int)
    by_source = defaultdict(int)
    total_duration = 0.0

    for s in all_sessions:
        tier = s["tier"]
        by_tier[tier]["count"] += 1
        by_tier[tier]["models"].add(s["model"])
        if s["duration_seconds"]:
            by_tier[tier]["total_duration"] += s["duration_seconds"]
            total_duration += s["duration_seconds"]
        by_status[s["status"]] += 1
        by_source[s["source"]] += 1

    return {
        "sessions": all_sessions,
        "summary": {
            "total_sessions": len(all_sessions),
            "by_source": dict(by_source),
            "by_status": dict(by_status),
            "by_tier": {
                tier: {
                    "count": info["count"],
                    "models": sorted(info["models"]),
                    "total_duration_seconds": round(info["total_duration"], 2),
                    "avg_duration_seconds": round(info["total_duration"] / info["count"], 2) if info["count"] > 0 else 0,
                }
                for tier, info in sorted(by_tier.items())
            },
            "total_duration_seconds": round(total_duration, 2),
        },
    }


def print_text_report(report: dict, tier_filter: str | None = None):
    """Print a human-readable report."""
    sessions = report["sessions"]
    summary = report["summary"]

    if tier_filter:
        sessions = [s for s in sessions if s["tier"].lower() == tier_filter.lower()]
        if not sessions:
            print(f"No sessions found for tier: {tier_filter}")
            return

    # ── Header ──────────────────────────────────────────────────────────────
    print("=" * 90)
    print("  DEVIN CLI TEST REPORT")
    print("=" * 90)
    print()

    # ── Summary ─────────────────────────────────────────────────────────────
    print("  SUMMARY")
    print("  " + "-" * 86)
    print(f"  Total sessions:     {summary['total_sessions']}")
    for source, count in sorted(summary["by_source"].items()):
        print(f"  Source: {source:<10} {count}")
    print(f"  Total wall time:    {summary['total_duration_seconds']:.1f}s")
    print()

    print("  BY STATUS")
    print("  " + "-" * 86)
    max_count = max(summary["by_status"].values()) if summary["by_status"] else 0
    for status, count in sorted(summary["by_status"].items()):
        bar = "█" * count + "░" * (max_count - count)
        print(f"  {status:12} {bar} {count}")
    print()

    print("  BY TIER")
    print("  " + "-" * 86)
    print(f"  {'Tier':<14} {'Count':>6} {'Models':<30} {'Total Time':>12} {'Avg Time':>10}")
    print(f"  {'-'*14} {'-'*6} {'-'*30} {'-'*12} {'-'*10}")
    for tier, info in summary["by_tier"].items():
        models_str = ", ".join(info["models"])[:28]
        print(f"  {tier:<14} {info['count']:>6} {models_str:<30} {info['total_duration_seconds']:>10.1f}s {info['avg_duration_seconds']:>8.1f}s")
    print()

    # ── Model Tracking Note ─────────────────────────────────────────────────
    print("  MODEL TRACKING NOTE")
    print("  " + "-" * 86)
    print("  Model info is NOT persisted by either the Devin CLI or the MCP server.")
    print("  To verify tier routing, run this script WHILE sessions are active and use:")
    print("    - MCP tool: devin_list / devin_status  (shows resolved model)")
    print("    - CLI: devin list  (does not include model)")
    print()

    # ── Per-Session Details ─────────────────────────────────────────────────
    print("  SESSION DETAILS")
    print("  " + "-" * 86)
    print(f"  {'ID':<28} {'Source':<6} {'Tier':<12} {'Status':<10} {'Duration':>10} {'Log Size':>10} {'Last Act':>10}")
    print(f"  {'-'*28} {'-'*6} {'-'*12} {'-'*10} {'-'*10} {'-'*10} {'-'*10}")

    for s in sessions:
        dur = f"{s['duration_seconds']:.1f}s" if s["duration_seconds"] else "N/A"
        log_sz = f"{s['log_size_bytes'] / 1024:.1f}KB" if s["log_size_bytes"] > 1024 else f"{s['log_size_bytes']}B"
        last_act = s.get("last_activity_ago", "")[:9]
        print(f"  {s['id'][:28]:<28} {s['source']:<6} {s['tier']:<12} {s['status']:<10} {dur:>10} {log_sz:>10} {last_act:>10}")

    print()
    print("  PROMPTS & WORKING DIRECTORIES")
    print("  " + "-" * 86)
    for s in sessions:
        print(f"  [{s['source']}] {s['tier']} | {s['id'][:20]}...")
        if s.get("cwd"):
            print(f"    CWD:  {s['cwd']}")
        prompt = s.get("prompt", "")
        if prompt:
            # Wrap prompt at 80 chars
            indent = "    "
            wrapped = re.sub(r"(.{80})", r"\1\n    ", prompt)
            print(f"    Task: {wrapped}")
        print()

    print("=" * 90)


def main():
    parser = argparse.ArgumentParser(description="Devin CLI Test Reporter")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    parser.add_argument("--tier", type=str, default=None, help="Filter by tier (Standard, Fast/Cheap, Code Gen, Balanced, Deep)")
    args = parser.parse_args()

    cli_sessions = run_devin_list()
    mcp_sessions = get_mcp_sessions()
    report = build_report(cli_sessions, mcp_sessions)

    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        print_text_report(report, tier_filter=args.tier)


if __name__ == "__main__":
    main()
