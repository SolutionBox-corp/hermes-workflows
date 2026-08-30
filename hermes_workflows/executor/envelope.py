"""Parse the optional structured record a script node may append to its stdout.

A script node's output is prose: whatever the command printed. That makes every
structured thing about a step — what it cost, which branch the work landed on,
which files are the evidence — something a person has to re-read out of English.
This module gives a command one narrow channel for saying it in a machine-
readable way, without changing what `output` means for anyone who was already
consuming it.

The contract is deliberately strict: the LAST non-empty line, a JSON object
whose ONLY top-level key is ``hermes_node``, whose value is itself an object.
Anything looser would silently eat the output of a command that happens to end
in JSON — and a script node's ``output`` is a consumed value, not decoration: a
``wait`` node reads ``{{nodes.<id>.output}}``. When any part of the contract is
unmet the stdout is returned exactly as it arrived and no record is claimed.

The record's *shape* is not interpreted here (see ``schema/run.ts`` for the
rendered fields). It is opaque payload: persisted and displayed, never branched
on, so a workflow's routing can never depend on a step describing itself.
"""

from __future__ import annotations

import json

ENVELOPE_KEY = "hermes_node"


def split_envelope(stdout: str) -> tuple[str, dict | None]:
    """Split a trailing ``hermes_node`` envelope off ``stdout``.

    Returns ``(body, record)`` with the envelope line removed from the body, or
    ``(stdout, None)`` when there is no envelope. Never raises: malformed input
    is simply not an envelope.

    Call this BEFORE the output is clipped. The clip is 100 000 chars and it
    truncates the tail, so a step that printed a lot and then declared its record
    would otherwise lose the record it just wrote.
    """
    if not stdout:
        return stdout, None
    stripped = stdout.rstrip("\n")
    head, separator, last = stripped.rpartition("\n")
    candidate = last.strip()
    # Cheap rejections first: the overwhelmingly common case is a command that
    # never heard of this protocol, and it should cost one string check.
    if not candidate.startswith("{") or ENVELOPE_KEY not in candidate:
        return stdout, None
    try:
        parsed = json.loads(candidate)
    except ValueError:
        return stdout, None
    if not isinstance(parsed, dict) or set(parsed) != {ENVELOPE_KEY}:
        return stdout, None
    record = parsed[ENVELOPE_KEY]
    if not isinstance(record, dict):
        return stdout, None
    # `separator` is empty when the envelope was the only line, in which case the
    # body is empty rather than a copy of the envelope.
    return (head if separator else ""), record
