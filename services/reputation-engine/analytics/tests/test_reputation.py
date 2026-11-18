import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from reputation import compute_performance, records_frame, wilson_lower


def test_basic():
    recs = [
        {"outcome": "TargetHit", "returnBps": 1000, "confidence": 70, "onchain": True, "resolvedAt": 1},
        {"outcome": "InvalidationHit", "returnBps": -500, "confidence": 60, "onchain": True, "resolvedAt": 2},
        {"outcome": "Forfeited", "returnBps": None, "confidence": 50, "onchain": True, "resolvedAt": None},
        {"outcome": "Unresolved", "returnBps": None, "confidence": 50, "onchain": True, "resolvedAt": None},
        {"outcome": "TargetHit", "returnBps": 900, "confidence": 90, "onchain": False, "resolvedAt": 3},
    ]
    s = compute_performance(records_frame(recs))
    assert s["published"] == 4
    assert s["wins"] == 1 and s["losses"] == 2 and s["scored"] == 3
    assert s["unresolved"] == 1
    assert s["maxDrawdownBps"] == 500
    assert s["sampleWarning"]


def test_wilson():
    assert wilson_lower(0, 0) is None
    assert 0 < wilson_lower(8, 10) < 0.8
