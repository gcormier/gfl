"""Tests for pipeline/capabilities.py — pure Python, no FreeCAD needed."""

from __future__ import annotations

import json

import pytest

from pipeline.capabilities import pick_default_length, pick_default_size

# ── pick_default_size ─────────────────────────────────────────────────────────

class TestPickDefaultSize:
    def test_single_size(self):
        assert pick_default_size(["M8"]) == "M8"

    def test_two_sizes_returns_first(self):
        # len=2, idx=1 — second element
        assert pick_default_size(["M4", "M8"]) == "M8"

    def test_odd_count_returns_middle(self):
        sizes = ["M3", "M4", "M5", "M6", "M8"]
        assert pick_default_size(sizes) == "M5"

    def test_even_count_returns_lower_middle(self):
        sizes = ["M3", "M4", "M5", "M6"]
        # len=4, idx=2 → "M5"
        assert pick_default_size(sizes) == "M5"

    def test_pin_sizes(self):
        sizes = ["1 mm", "2 mm", "3 mm", "4 mm", "5 mm", "6 mm", "8 mm"]
        # len=7, idx=3 → "4 mm"
        assert pick_default_size(sizes) == "4 mm"


# ── pick_default_length ───────────────────────────────────────────────────────

class TestPickDefaultLength:
    def test_empty_returns_none(self):
        assert pick_default_length([]) is None

    def test_single_length(self):
        assert pick_default_length(["20"]) == "20"

    def test_fewer_than_ten_returns_first(self):
        # max(0, 9//10) == 0 → first element
        lengths = ["10", "12", "16", "20", "25", "30", "35", "40", "45"]
        assert pick_default_length(lengths) == "10"

    def test_exactly_ten_returns_first(self):
        lengths = [str(i) for i in range(10, 110, 10)]  # 10 items
        # max(0, 10//10) == 1 → second element
        assert pick_default_length(lengths) == "20"

    def test_twenty_lengths_returns_second(self):
        lengths = [str(i) for i in range(5, 105, 5)]  # 20 items
        # max(0, 20//10) == 2 → third element (index 2)
        assert pick_default_length(lengths) == "15"

    def test_biased_toward_small(self):
        # Result should always be in the first quarter of the list
        lengths = [str(i) for i in range(10, 210, 10)]  # 20 items: 10,20,...200
        result = pick_default_length(lengths)
        assert result is not None
        assert int(result) <= 50  # well within the lower quarter


# ── load_capabilities / get_standard_info ────────────────────────────────────

class TestLoadCapabilities:
    def test_missing_snapshot_raises(self, tmp_path, monkeypatch):
        import pipeline.capabilities as cap_mod
        monkeypatch.setattr(cap_mod, "_CAPABILITIES_PATH", tmp_path / "nope.json")
        cap_mod.load_capabilities.cache_clear()
        with pytest.raises(RuntimeError, match="Cannot read"):
            cap_mod.load_capabilities()
        cap_mod.load_capabilities.cache_clear()

    def test_empty_snapshot_raises(self, tmp_path, monkeypatch):
        import pipeline.capabilities as cap_mod
        p = tmp_path / "empty.json"
        p.write_text(json.dumps({"standards": {}}), encoding="utf-8")
        monkeypatch.setattr(cap_mod, "_CAPABILITIES_PATH", p)
        cap_mod.load_capabilities.cache_clear()
        with pytest.raises(RuntimeError, match="empty"):
            cap_mod.load_capabilities()
        cap_mod.load_capabilities.cache_clear()

    def test_valid_snapshot(self, tmp_path, monkeypatch):
        import pipeline.capabilities as cap_mod
        p = tmp_path / "caps.json"
        p.write_text(json.dumps({
            "standards": {
                "ISO4762": {
                    "category": "Screw",
                    "sizes": ["M4", "M6", "M8"],
                    "lengths_by_size": {"M8": ["20", "25", "30"]},
                }
            }
        }), encoding="utf-8")
        monkeypatch.setattr(cap_mod, "_CAPABILITIES_PATH", p)
        cap_mod.load_capabilities.cache_clear()
        result = cap_mod.load_capabilities()
        assert "ISO4762" in result
        assert result["ISO4762"]["category"] == "Screw"
        cap_mod.load_capabilities.cache_clear()


class TestGetStandardInfo:
    def test_returns_none_for_unknown(self, tmp_path, monkeypatch):
        import pipeline.capabilities as cap_mod
        p = tmp_path / "caps.json"
        p.write_text(json.dumps({"standards": {"ISO4762": {"category": "Screw", "sizes": ["M8"], "lengths_by_size": {}}}}), encoding="utf-8")
        monkeypatch.setattr(cap_mod, "_CAPABILITIES_PATH", p)
        cap_mod.load_capabilities.cache_clear()
        assert cap_mod.get_standard_info("NOTEXIST") is None
        cap_mod.load_capabilities.cache_clear()
