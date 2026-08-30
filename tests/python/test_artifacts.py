"""Per-node artifact store.

The names arrive from an operator-authored script, so every test that matters
here is about a name never becoming a path it should not be. The size cap
matters for the same reason a diff does not live in the node's output column:
something has to bound what an unattended step can write.
"""

from __future__ import annotations

import pytest

from hermes_workflows import artifacts


@pytest.mark.parametrize("name", ["diff.patch", "result.md", "a-b_c.1.txt", "x" * 128])
def test_accepts_a_plain_single_segment_name(name) -> None:
    assert artifacts.valid_name(name)


@pytest.mark.parametrize(
    "name",
    [
        "",
        ".",
        "..",
        "../escape",
        "a/b",
        "a\\b",
        "/absolute",
        ".hidden",
        "x" * 129,
        "with space",
    ],
)
def test_rejects_anything_that_could_leave_the_directory(name) -> None:
    assert not artifacts.valid_name(name)


def test_store_and_read_round_trip(tmp_path) -> None:
    source = tmp_path / "source.txt"
    source.write_text("hello\n", encoding="utf-8")
    root = tmp_path / "runs"

    written = artifacts.store_artifact(root, "run-1", "explore", "result.md", source)

    assert written == 6
    assert artifacts.read_artifact(root, "run-1", "explore", "result.md") == ("hello\n", False)


def test_layout_matches_the_documented_contract(tmp_path) -> None:
    """`<root>/<run>/nodes/<node>/artifacts/<name>` - the same layout the
    TypeScript-side reader in packages/core/src/runtime/artifacts.ts expects."""
    root = tmp_path / "runs"
    expected = root / "run-1" / "nodes" / "explore" / "artifacts"
    assert artifacts.node_artifact_dir(root, "run-1", "explore") == expected


def test_artifacts_of_different_nodes_do_not_collide(tmp_path) -> None:
    source = tmp_path / "s.txt"
    source.write_text("a", encoding="utf-8")
    root = tmp_path / "runs"
    artifacts.store_artifact(root, "r", "explore", "diff.patch", source)
    source.write_text("bb", encoding="utf-8")
    artifacts.store_artifact(root, "r", "tdd", "diff.patch", source)

    assert artifacts.read_artifact(root, "r", "explore", "diff.patch") == ("a", False)
    assert artifacts.read_artifact(root, "r", "tdd", "diff.patch") == ("bb", False)


def test_oversized_artifact_is_capped_and_flagged(tmp_path) -> None:
    source = tmp_path / "big.patch"
    source.write_text("x" * (artifacts.MAX_ARTIFACT_BYTES + 10), encoding="utf-8")
    root = tmp_path / "runs"

    written = artifacts.store_artifact(root, "r", "n", "big.patch", source)

    assert written == artifacts.MAX_ARTIFACT_BYTES
    text, truncated = artifacts.read_artifact(root, "r", "n", "big.patch")
    assert truncated is True
    assert len(text) == artifacts.MAX_ARTIFACT_BYTES


def test_missing_artifact_reads_as_none(tmp_path) -> None:
    assert artifacts.read_artifact(tmp_path, "r", "n", "nope.txt") is None


def test_a_traversing_name_is_refused_on_write(tmp_path) -> None:
    source = tmp_path / "s.txt"
    source.write_text("x", encoding="utf-8")
    with pytest.raises(ValueError):
        artifacts.store_artifact(tmp_path, "r", "n", "../evil.txt", source)
    assert not (tmp_path.parent / "evil.txt").exists()


def test_a_traversing_name_reads_as_none_rather_than_raising(tmp_path) -> None:
    """A read is driven by a URL path segment; it must answer 'no such artifact'
    rather than surface a distinguishable error for an escaping name."""
    assert artifacts.read_artifact(tmp_path, "r", "n", "../../etc/passwd") is None


def test_run_and_node_ids_are_validated_too(tmp_path) -> None:
    source = tmp_path / "s.txt"
    source.write_text("x", encoding="utf-8")
    with pytest.raises(ValueError):
        artifacts.store_artifact(tmp_path, "../r", "n", "a.txt", source)
    with pytest.raises(ValueError):
        artifacts.store_artifact(tmp_path, "r", "../n", "a.txt", source)


def test_an_unreadable_source_raises_oserror_for_the_caller_to_warn_on(tmp_path) -> None:
    with pytest.raises(OSError):
        artifacts.store_artifact(tmp_path, "r", "n", "gone.txt", tmp_path / "gone.txt")


def test_invalid_utf8_is_replaced_rather_than_failing_the_read(tmp_path) -> None:
    root = tmp_path / "runs"
    directory = artifacts.node_artifact_dir(root, "r", "n")
    directory.mkdir(parents=True)
    (directory / "raw.bin").write_bytes(b"ok \xff\xfe")

    text, truncated = artifacts.read_artifact(root, "r", "n", "raw.bin")

    assert text.startswith("ok ")
    assert truncated is False
