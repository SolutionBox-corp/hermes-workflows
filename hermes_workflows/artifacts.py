"""Per-node artifact store: the evidence a step produced, kept on disk.

Layout, mirroring ``packages/core/src/runtime/artifacts.ts`` (the TypeScript-side
reader for the same contract)::

    <root>/<run_id>/nodes/<node_id>/artifacts/<name>

Bytes live here rather than in the node's ``output`` column for two reasons. The
run inspector polls the whole run state every couple of seconds, so anything in
it is re-sent on that cadence - a diff has no business riding a 2-second poll.
And the output column is clipped at 100 000 characters, which a real diff will
happily exceed. Only an artifact's *metadata* (name, label, kind, size) travels
with the run state; the content is fetched when a person opens it.

Names, run ids and node ids are validated before they touch a path. They arrive
from an operator-authored script and, on the read side, from a URL segment; one
``..`` would otherwise write or read outside the store.
"""

from __future__ import annotations

import re
from pathlib import Path

# What a single step may leave behind per file. Generous enough for a real diff,
# bounded enough that an unattended agent cannot fill the disk one node at a
# time. A file over the cap is stored truncated and flagged, never dropped: a
# clipped diff still answers "roughly what happened", an absent one answers
# nothing.
MAX_ARTIFACT_BYTES = 524_288

_COPY_CHUNK = 65_536

# One path segment: starts alphanumeric (so no dotfiles and no leading dash),
# then dots, dashes, underscores and alphanumerics only. No separator of either
# flavour can match, which is what makes traversal impossible rather than merely
# unlikely.
_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def valid_name(name: str) -> bool:
    """Whether ``name`` is a safe single path segment."""
    return bool(name) and bool(_SAFE_SEGMENT.match(name)) and ".." not in name


def _segment(value: str, what: str) -> str:
    if not valid_name(value):
        raise ValueError(f"unsafe {what}: {value!r}")
    return value


def node_artifact_dir(root: Path | str, run_id: str, node_id: str) -> Path:
    """The directory holding one node's artifacts. Raises on an unsafe id."""
    return (
        Path(root)
        / _segment(run_id, "run id")
        / "nodes"
        / _segment(node_id, "node id")
        / "artifacts"
    )


def store_artifact(
    root: Path | str, run_id: str, node_id: str, name: str, source: Path | str
) -> int:
    """Copy ``source`` into the store as ``name``; return the bytes kept.

    Copies at most :data:`MAX_ARTIFACT_BYTES`. Raises ``ValueError`` for an
    unsafe name or id and ``OSError`` when the source cannot be read - both are
    for the caller to turn into a warning on the record, because a step that did
    its work must not be failed by an unreadable side file.
    """
    target_dir = node_artifact_dir(root, run_id, node_id)
    target = target_dir / _segment(name, "artifact name")
    # Opened before the directory is created, so an unreadable source does not
    # leave an empty artifact directory behind.
    with open(source, "rb") as src:
        target_dir.mkdir(parents=True, exist_ok=True)
        written = 0
        with open(target, "wb") as dst:
            while written < MAX_ARTIFACT_BYTES:
                chunk = src.read(min(_COPY_CHUNK, MAX_ARTIFACT_BYTES - written))
                if not chunk:
                    break
                dst.write(chunk)
                written += len(chunk)
    return written


# Artifacts that are not text. A screenshot is evidence, and evidence a reviewer
# cannot look at is evidence they have to take on trust, so these are served as
# bytes rather than mangled through a UTF-8 decode.
BINARY_SUFFIXES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def media_type(name: str) -> str | None:
    """The media type for a binary artifact, or None when it is text."""
    _stem, _dot, suffix = name.rpartition(".")
    return BINARY_SUFFIXES.get(f".{suffix.lower()}") if _dot else None


def read_artifact_bytes(
    root: Path | str, run_id: str, node_id: str, name: str
) -> tuple[bytes, bool] | None:
    """``(data, truncated)`` for any artifact, without decoding it."""
    try:
        path = node_artifact_dir(root, run_id, node_id) / _segment(name, "artifact name")
    except ValueError:
        return None
    if not path.is_file():
        return None
    data = path.read_bytes()
    return data, len(data) >= MAX_ARTIFACT_BYTES


def read_artifact(
    root: Path | str, run_id: str, node_id: str, name: str
) -> tuple[str, bool] | None:
    """``(text, truncated)``, or ``None`` when there is no such artifact.

    Never raises: an unsafe name is indistinguishable from an absent one, so a
    caller serving this over HTTP answers 404 for both without having to tell
    them apart. Decoding is lenient - an artifact is evidence to read, and
    partially binary content should still be readable rather than fatal.
    """
    try:
        path = node_artifact_dir(root, run_id, node_id) / _segment(name, "artifact name")
    except ValueError:
        return None
    if not path.is_file():
        return None
    data = path.read_bytes()
    return data.decode("utf-8", errors="replace"), len(data) >= MAX_ARTIFACT_BYTES
