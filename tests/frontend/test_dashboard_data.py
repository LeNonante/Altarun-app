"""Tests du contrat de données du dashboard (fct_activities).

Ces tests n'importent pas ``frontend/app.py`` (side-effects au démarrage) : ils
testent directement le service et le jeu de démo.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from datetime import date

import pytest

from tests.conftest import FRONTEND_DIR

sys.path.insert(0, str(FRONTEND_DIR))
from services import dashboard_data


@pytest.fixture(scope="module")
def payload() -> dict:
    return dashboard_data.get_dashboard_payload("demo")


def test_mock_payload_respects_contract(payload: dict) -> None:
    acts = payload["activities"]
    assert payload["meta"]["row_count"] == len(acts)
    for a in acts:
        assert a.keys() >= dashboard_data.REQUIRED_COLUMNS
        assert a["sport_type"] in dashboard_data.SUPPORTED_SPORTS
        assert a["moving_time_min"] > 0
        assert len(a["hr_zones_min"]) == 5
    ids = [a["activity_id"] for a in acts]
    assert len(ids) == len(set(ids)), "activity_id doit être unique"


def test_mock_payload_is_calibrated(payload: dict) -> None:
    """Les moyennes des 52 dernières semaines complètes correspondent au profil cible."""
    lo, hi = date(2025, 9, 29), date(2026, 9, 27)
    hours: dict[str, float] = defaultdict(float)
    km = run_min = 0.0
    for a in payload["activities"]:
        d = date.fromisoformat(a["start_date_local"][:10])
        if not lo <= d <= hi:
            continue
        hours[a["sport_type"]] += a["moving_time_min"] / 60
        if a["sport_type"] == "Run":
            km += a["distance_km"]
            run_min += a["moving_time_min"]
    assert km / 52 == pytest.approx(40, abs=0.3)
    assert run_min * 60 / km == pytest.approx(320, abs=1.5)  # 5'20"/km
    assert hours["Tennis"] / 52 == pytest.approx(3, abs=0.05)
    assert hours["Swim"] / 52 == pytest.approx(1, abs=0.05)
    assert hours["Golf"] / 52 == pytest.approx(2, abs=0.05)
    assert hours["RockClimbing"] / 52 == pytest.approx(1, abs=0.05)


def test_validate_rejects_broken_contract() -> None:
    with pytest.raises(dashboard_data.DashboardDataError):
        dashboard_data.validate({"meta": {}, "activities": [{"sport_type": "Run"}]})
    with pytest.raises(dashboard_data.DashboardDataError):
        dashboard_data.validate({"activities": []})
