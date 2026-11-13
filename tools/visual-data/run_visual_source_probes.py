#!/usr/bin/env python3
"""Run all lightweight visual-source probes and preserve diagnostics for every source.

The individual probes intentionally own their own source semantics. This wrapper only
adds observability: a failure in one probe must not hide the remaining probe results,
and CI must retain the small JSON evidence before failing the job.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROBES = (
    ("visual_sources", "probe_visual_sources.py", "nwe-visual-source-probe.json"),
    ("visual_order_selections", "probe_visual_order_selections.py", "nwe-visual-order-selection.json"),
    ("sr16_metadata_links", "probe_sr16_metadata_links.py", "nwe-sr16-metadata-links.json"),
    ("vegetation_real_sample", "probe_vegetation_real_sample.py", "nwe-vegetation-real-source-probe.json"),
    ("nibio_capabilities_catalog", "probe_nibio_capabilities_catalog.py", "nwe-nibio-capabilities-catalog.json"),
    ("ar50_determinism", "probe_ar50_determinism.py", "nwe-ar50-determinism.json"),
)
DEFAULT_TIMEOUT_SECONDS = 90
TAIL_CHARS = 4000


def _tail(value: str) -> str:
    value = value.strip()
    return value[-TAIL_CHARS:] if len(value) > TAIL_CHARS else value


def run_probe(*, tools_dir: Path, output_dir: Path, name: str, script_name: str, output_name: str, timeout_seconds: int) -> dict[str, Any]:
    script = tools_dir / script_name
    output = output_dir / output_name
    command = [sys.executable, str(script), "--output", str(output)]
    started = datetime.now(timezone.utc)
    try:
        completed = subprocess.run(
            command,
            cwd=tools_dir.parent.parent,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        return_code = completed.returncode
        stdout_tail = _tail(completed.stdout)
        stderr_tail = _tail(completed.stderr)
        error = None
    except subprocess.TimeoutExpired as exc:
        return_code = 124
        stdout_tail = _tail(exc.stdout or "") if isinstance(exc.stdout, str) else ""
        stderr_tail = _tail(exc.stderr or "") if isinstance(exc.stderr, str) else ""
        error = f"TimeoutExpired>{timeout_seconds}s"
    except Exception as exc:  # keep later probes observable even if one launcher fails
        return_code = 125
        stdout_tail = ""
        stderr_tail = ""
        error = repr(exc)

    output_status = None
    output_schema = None
    if output.exists():
        try:
            parsed = json.loads(output.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                output_status = parsed.get("status")
                output_schema = parsed.get("schema")
        except Exception as exc:
            error = error or f"OUTPUT_JSON_INVALID:{exc!r}"

    return {
        "name": name,
        "script": script_name,
        "output": str(output),
        "output_exists": output.exists(),
        "output_schema": output_schema,
        "output_status": output_status,
        "return_code": return_code,
        "status": "PASS" if return_code == 0 and output.exists() else "FAIL",
        "duration_ms": round((datetime.now(timezone.utc) - started).total_seconds() * 1000, 3),
        "stdout_tail": stdout_tail,
        "stderr_tail": stderr_tail,
        "error": error,
    }


def run_all(*, tools_dir: Path, output_dir: Path, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    results = [
        run_probe(
            tools_dir=tools_dir,
            output_dir=output_dir,
            name=name,
            script_name=script_name,
            output_name=output_name,
            timeout_seconds=timeout_seconds,
        )
        for name, script_name, output_name in PROBES
    ]
    failed = [item["name"] for item in results if item["status"] != "PASS"]
    return {
        "schema": "nwe.visual-source-probe-suite/0.1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if not failed else "FAIL",
        "failed_probes": failed,
        "probe_count": len(results),
        "results": results,
        "policy": {
            "continue_after_individual_failure": True,
            "small_metadata_evidence_only": True,
            "raw_geodata_downloaded_by_wrapper": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--summary", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    args = parser.parse_args()
    if args.timeout_seconds <= 0:
        raise SystemExit("timeout must be positive")

    tools_dir = Path(__file__).resolve().parent
    report = run_all(
        tools_dir=tools_dir,
        output_dir=Path(args.output_dir).resolve(),
        timeout_seconds=args.timeout_seconds,
    )
    Path(args.summary).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
