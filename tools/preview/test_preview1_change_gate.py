from preview1_change_gate import requires_heavy_proof


def test_push_always_requires_heavy_proof() -> None:
    assert requires_heavy_proof(event_name="push", action="", changed_files=[])


def test_docs_only_pr_can_skip_heavy_proof() -> None:
    assert not requires_heavy_proof(
        event_name="pull_request",
        action="synchronize",
        changed_files=["docs/05-worklog.md"],
    )


def test_full_pr_diff_preserves_earlier_code_change_after_later_docs_commit() -> None:
    # Adversarial sequence: code commit starts heavy run; later docs-only commit
    # cancels it. The replacement run must still see the earlier code change in
    # base...HEAD and remain heavy.
    assert requires_heavy_proof(
        event_name="pull_request",
        action="synchronize",
        changed_files=[
            "apps/world-viewer/src/preview1.ts",
            "docs/05-worklog.md",
        ],
    )


def test_preview_workflow_change_requires_heavy_proof() -> None:
    assert requires_heavy_proof(
        event_name="pull_request",
        action="synchronize",
        changed_files=[".github/workflows/preview1-realdata-publish.yml"],
    )


def test_unrelated_visual_probe_change_does_not_force_preview_proof() -> None:
    assert not requires_heavy_proof(
        event_name="pull_request",
        action="synchronize",
        changed_files=["tools/visual-data/probe_visual_order_selections.py"],
    )
