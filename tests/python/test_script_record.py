"""ScriptExecutor turning a step's `hermes_node` envelope into a stored record.

Two orderings carry the weight here and both are asserted directly, because
getting either wrong loses the record silently rather than loudly:

  - the envelope is split off BEFORE the output is clipped, or a step that
    printed a lot and then declared its record truncates away what it just said;
  - an artifact the step declared but the executor cannot read is a warning on
    the record, never a failed node - the step did its work either way.
"""

from __future__ import annotations

import json
import shlex
from pathlib import Path

from hermes_workflows import artifacts
from hermes_workflows.executor import store as store_mod
from hermes_workflows.executor.script_executor import ScriptExecutor


def _executor(tmp_path: Path) -> ScriptExecutor:
    return ScriptExecutor(
        store_dir=tmp_path / "scripts",
        env_allowlist=["PATH"],
        timeout_seconds=20.0,
        artifacts_root=tmp_path / "runs",
    )


def _run(ex: ScriptExecutor, command: str, *, run_id="run-1", node_id="explore"):
    handle = ex.schedule(
        run_id=run_id, node_id=node_id, workflow_id="wf", params={"command": command}
    )
    return ex.poll(handle)


def _emit(record: dict) -> str:
    """A shell fragment printing `record` as the envelope line, quoted safely."""
    return f"printf '%s\\n' {shlex.quote(json.dumps({'hermes_node': record}))}"


def test_a_step_without_an_envelope_is_unchanged(tmp_path) -> None:
    completion = _run(_executor(tmp_path), "echo plain")
    assert completion.outcome == "success"
    assert completion.output == "plain"
    assert completion.record is None


def test_envelope_becomes_a_record_and_leaves_the_output_clean(tmp_path) -> None:
    record = {"headline": "ok", "facts": [{"label": "cost", "value": "$1.49"}]}
    completion = _run(_executor(tmp_path), f"echo done; {_emit(record)}")
    assert completion.output == "done"
    assert completion.record["headline"] == "ok"
    assert completion.record["facts"] == [{"label": "cost", "value": "$1.49"}]


def test_declared_artifact_is_copied_in_and_measured(tmp_path) -> None:
    source = tmp_path / "diff.patch"
    source.write_text("+++ a\n", encoding="utf-8")
    ex = _executor(tmp_path)
    record = {
        "artifacts": [
            {"name": "diff.patch", "path": str(source), "kind": "diff", "label": "Diff"}
        ]
    }

    completion = _run(ex, f"echo hi; {_emit(record)}")

    entry = completion.record["artifacts"][0]
    assert entry == {
        "name": "diff.patch",
        "label": "Diff",
        "kind": "diff",
        "bytes": 6,
        "truncated": False,
    }
    # The operator-side path never survives into the record: it is meaningless
    # to any reader of the run and would leak the box's layout into the UI.
    assert "path" not in entry
    stored = artifacts.read_artifact(tmp_path / "runs", "run-1", "explore", "diff.patch")
    assert stored == ("+++ a\n", False)


def test_an_unreadable_artifact_warns_instead_of_failing_the_node(tmp_path) -> None:
    ex = _executor(tmp_path)
    record = {"artifacts": [{"name": "gone.txt", "path": str(tmp_path / "gone.txt")}]}

    completion = _run(ex, f"echo hi; {_emit(record)}")

    assert completion.outcome == "success"
    assert completion.record["artifacts"] == []
    assert any("gone.txt" in warning for warning in completion.record["warnings"])


def test_an_unsafely_named_artifact_warns_and_is_not_written(tmp_path) -> None:
    source = tmp_path / "s.txt"
    source.write_text("x", encoding="utf-8")
    ex = _executor(tmp_path)
    record = {"artifacts": [{"name": "../evil.txt", "path": str(source)}]}

    completion = _run(ex, f"echo hi; {_emit(record)}")

    assert completion.outcome == "success"
    assert completion.record["artifacts"] == []
    assert completion.record["warnings"]
    assert not (tmp_path / "runs" / "evil.txt").exists()


def test_envelope_survives_an_output_longer_than_the_clip(tmp_path) -> None:
    """The reason `_record` runs before `_clean`: the clip truncates the tail,
    which is exactly where the envelope lives."""
    ex = _executor(tmp_path)
    filler = "y" * (store_mod.MAX_OUTPUT_CHARS + 100)
    record = {"headline": "still here"}

    completion = _run(ex, f"printf '%s\\n' {shlex.quote(filler)}; {_emit(record)}")

    assert completion.record["headline"] == "still here"
    assert completion.output.endswith("[truncated]")


def test_a_failing_step_still_records(tmp_path) -> None:
    """A failed step's record is the one you most want to read."""
    ex = _executor(tmp_path)
    record = {"headline": "blocked by the gates"}
    completion = _run(ex, f"{_emit(record)}; echo why >&2; exit 4")

    assert completion.outcome == "failure"
    assert completion.record["headline"] == "blocked by the gates"


def test_record_survives_the_completion_store(tmp_path) -> None:
    ex = _executor(tmp_path)
    handle = ex.schedule(
        run_id="run-1",
        node_id="explore",
        workflow_id="wf",
        params={"command": f"echo hi; {_emit({'headline': 'ok'})}"},
    )
    reloaded = _executor(tmp_path).poll(handle)
    assert reloaded.record == {"headline": "ok"}


def test_artifacts_are_keyed_by_the_node_that_produced_them(tmp_path) -> None:
    source = tmp_path / "s.txt"
    source.write_text("from tdd", encoding="utf-8")
    ex = _executor(tmp_path)
    record = {"artifacts": [{"name": "result.md", "path": str(source)}]}

    _run(ex, f"echo hi; {_emit(record)}", run_id="run-1", node_id="tdd")

    assert artifacts.read_artifact(tmp_path / "runs", "run-1", "tdd", "result.md") == (
        "from tdd",
        False,
    )
    assert artifacts.read_artifact(tmp_path / "runs", "run-1", "explore", "result.md") is None


def test_a_non_list_artifacts_field_is_ignored_not_fatal(tmp_path) -> None:
    completion = _run(_executor(tmp_path), f"echo hi; {_emit({'artifacts': 'nope'})}")
    assert completion.outcome == "success"
    assert completion.record is not None


def test_primary_flag_survives_into_the_stored_record(tmp_path) -> None:
    """It marks the one artifact a reviewer is meant to read, and the gate opens
    it for them. Losing it here would put the document being judged back behind
    a click."""
    source = tmp_path / "design.md"
    source.write_text("# design", encoding="utf-8")
    ex = _executor(tmp_path)
    record = {"artifacts": [{"name": "design.md", "label": "Navrh", "kind": "markdown",
                             "primary": True, "path": str(source)}]}

    completion = _run(ex, f"echo hi; {_emit(record)}")

    entry = completion.record["artifacts"][0]
    assert entry["primary"] is True
    assert entry["name"] == "design.md"


def test_an_artifact_without_the_flag_does_not_gain_one(tmp_path) -> None:
    source = tmp_path / "other.txt"
    source.write_text("x", encoding="utf-8")
    ex = _executor(tmp_path)
    record = {"artifacts": [{"name": "other.txt", "path": str(source)}]}

    completion = _run(ex, f"echo hi; {_emit(record)}")

    assert "primary" not in completion.record["artifacts"][0]


def test_questions_reach_the_record(tmp_path) -> None:
    ex = _executor(tmp_path)
    record = {"questions": ["Potvrdit rozsah?", "Ma to mit vlastni spec?"]}

    completion = _run(ex, f"echo hi; {_emit(record)}")

    assert completion.record["questions"] == ["Potvrdit rozsah?", "Ma to mit vlastni spec?"]
