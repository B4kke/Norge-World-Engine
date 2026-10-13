#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("run_visual_source_probes.py")
spec = importlib.util.spec_from_file_location("visual_source_probe_suite", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    tools = root / "tools" / "visual-data"
    outputs = root / "outputs"
    tools.mkdir(parents=True)

    (tools / "pass_probe.py").write_text(
        "import argparse,json\n"
        "p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()\n"
        "open(a.output,'w').write(json.dumps({'schema':'test.pass/0.1','status':'PASS'}))\n",
        encoding="utf-8",
    )
    (tools / "fail_probe.py").write_text(
        "import argparse,json,sys\n"
        "p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()\n"
        "open(a.output,'w').write(json.dumps({'schema':'test.fail/0.1','status':'INCOMPLETE','reason':'fixture'}))\n"
        "print('fixture failure detail', file=sys.stderr)\n"
        "sys.exit(2)\n",
        encoding="utf-8",
    )
    (tools / "late_probe.py").write_text(
        "import argparse,json\n"
        "p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args()\n"
        "open(a.output,'w').write(json.dumps({'schema':'test.late/0.1','status':'PASS'}))\n",
        encoding="utf-8",
    )

    original = module.PROBES
    module.PROBES = (
        ("pass", "pass_probe.py", "pass.json"),
        ("fail", "fail_probe.py", "fail.json"),
        ("late", "late_probe.py", "late.json"),
    )
    try:
        report = module.run_all(tools_dir=tools, output_dir=outputs, timeout_seconds=10)
    finally:
        module.PROBES = original

    assert report["status"] == "FAIL"
    assert report["failed_probes"] == ["fail"]
    assert report["probe_count"] == 3
    by_name = {item["name"]: item for item in report["results"]}
    assert by_name["pass"]["status"] == "PASS"
    assert by_name["fail"]["return_code"] == 2
    assert by_name["fail"]["output_status"] == "INCOMPLETE"
    assert "fixture failure detail" in by_name["fail"]["stderr_tail"]
    assert by_name["late"]["status"] == "PASS", "suite stopped after first failure"
    assert (outputs / "late.json").exists()

print("visual source probe suite regressions: PASS")
