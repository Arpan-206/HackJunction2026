"""Every training example of the priors lane comes from an allowed source.

Allowed: an open dataset listed in core/priors/provenance.py, our own
generator under core.priors, or our self-hosted Gemma on Verda. Gemini, the
Decisions API and the held-out real captures (logs/live) must never appear.
"""

from __future__ import annotations

import json

from core.priors import provenance as P


def test_all_manifests_have_allowed_sources():
    manifests = sorted(P.DATA_DIR.glob("*.provenance.json"))
    assert manifests, "no provenance manifest: train the priors first"
    assert P.check_manifests() == []


def test_check_rejects_bad_sources():
    bad = [
        "gemini:gemini-3.5-flash",
        "generator:backend.app.services.llm.gemini",
        "open_dataset:kaggle_asl",
        "decisions:api",
        "generator:core.priors.asl:logs/live/20261114-131952/solver_12277.rgmp",
        "self_hosted_gemma:https://example.com",
        "human_label:arpan",
    ]
    for tag in bad:
        assert P.check_source(tag) is not None, tag


def test_check_accepts_good_sources():
    good = [
        "open_dataset:furelise:piece_065:left",
        "generator:core.priors.asl.simulate:fs_a:calibration:ideal",
        "self_hosted_gemma:verda:geppetto-gemma",
    ]
    for tag in good:
        assert P.check_source(tag) is None, tag


def test_manifest_counts_fail_when_tampered(tmp_path):
    (tmp_path / "x.provenance.json").write_text(
        json.dumps({"name": "x", "n_examples": 3, "sources": {"gemini:flash": 3}})
    )
    problems = P.check_manifests(tmp_path)
    assert problems and "gemini" in problems[0]
