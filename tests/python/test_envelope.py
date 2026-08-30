"""The `hermes_node` stdout envelope: the one narrow channel a script node has
for describing itself in a machine-readable way.

The contract has to be strict in both directions. Too loose and it eats the
output of a command that merely happens to end in JSON - and a script node's
`output` is consumed, not decoration (a `wait` node reads
`{{nodes.<id>.output}}`). Too strict and a step silently loses the record it
just wrote. Both directions are asserted here.
"""

from __future__ import annotations

from hermes_workflows.executor.envelope import split_envelope


def test_output_without_an_envelope_is_returned_untouched() -> None:
    assert split_envelope("hello\nworld") == ("hello\nworld", None)


def test_empty_output_is_not_an_envelope() -> None:
    assert split_envelope("") == ("", None)


def test_envelope_is_stripped_from_the_body_and_parsed() -> None:
    body, record = split_envelope('done\n{"hermes_node": {"headline": "ok"}}')
    assert body == "done"
    assert record == {"headline": "ok"}


def test_plain_trailing_json_is_not_an_envelope() -> None:
    """A command whose last line is ordinary JSON keeps that line in its output."""
    text = 'done\n{"result": 1}'
    assert split_envelope(text) == (text, None)


def test_extra_top_level_keys_disqualify_it() -> None:
    text = 'done\n{"hermes_node": {}, "other": 1}'
    assert split_envelope(text) == (text, None)


def test_non_object_payload_is_rejected() -> None:
    text = 'done\n{"hermes_node": [1, 2]}'
    assert split_envelope(text) == (text, None)


def test_malformed_json_is_rejected_without_raising() -> None:
    text = 'done\n{"hermes_node": {'
    assert split_envelope(text) == (text, None)


def test_envelope_as_the_only_line_leaves_an_empty_body() -> None:
    body, record = split_envelope('{"hermes_node": {"headline": "ok"}}')
    assert body == ""
    assert record == {"headline": "ok"}


def test_trailing_newlines_do_not_hide_the_envelope() -> None:
    body, record = split_envelope('done\n{"hermes_node": {}}\n\n')
    assert body == "done"
    assert record == {}


def test_an_envelope_earlier_than_the_last_line_is_ignored() -> None:
    """Only the last line is the channel; anything above it is ordinary output."""
    text = '{"hermes_node": {"headline": "no"}}\ntrailing'
    assert split_envelope(text) == (text, None)


def test_a_multi_line_body_keeps_all_of_its_lines() -> None:
    body, record = split_envelope('one\ntwo\nthree\n{"hermes_node": {}}')
    assert body == "one\ntwo\nthree"
    assert record == {}


def test_record_payload_is_not_interpreted() -> None:
    """The engine persists and renders the record; it never branches on it, so
    an unrecognised shape must survive the parse unaltered."""
    _, record = split_envelope('{"hermes_node": {"anything": [{"deep": true}]}}')
    assert record == {"anything": [{"deep": True}]}
