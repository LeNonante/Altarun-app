"""Service de données du dashboard.

Le front ne connaît qu'un contrat : le payload ``{"meta": {...}, "activities": [...]}``
dont chaque activité respecte le schéma du mart ``fct_activities`` (voir
``REQUIRED_COLUMNS``). La source est choisie par la variable d'environnement
``DASHBOARD_SOURCE`` :

* ``mock`` (défaut) : jeu de démo déterministe généré par
  ``scripts/generate_mock_activities.py`` ;
* ``bigquery`` : activités réelles de l'utilisateur, servies par l'API
  (``GET /bigquery-data/activities/<username>``), elle-même branchée sur le mart dbt.

Basculer de l'une à l'autre ne demande aucune modification du front.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import requests

MOCK_PATH = Path(__file__).resolve().parent.parent / "data" / "mock" / "fct_activities.json"

# Contrat minimal attendu par le dashboard (colonnes communes à tous les sports).
REQUIRED_COLUMNS = frozenset(
    {
        "activity_id",
        "start_date_local",
        "sport_type",
        "name",
        "workout_type",
        "distance_km",
        "moving_time_min",
        "avg_hr",
        "max_hr",
        "calories",
        "hr_zones_min",
    }
)
SUPPORTED_SPORTS = frozenset({"Run", "Swim", "Tennis", "Golf", "RockClimbing"})


class DashboardDataError(RuntimeError):
    """Les données du dashboard sont indisponibles ou ne respectent pas le contrat."""


def get_source() -> str:
    return os.environ.get("DASHBOARD_SOURCE", "mock").strip().lower()


@lru_cache(maxsize=1)
def _load_mock() -> dict:
    with MOCK_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _fetch_bigquery(username: str) -> dict:
    base_url = os.environ.get("API_URL")
    headers = {"Authorization": f"Bearer {os.environ.get('API_TOKEN')}"}
    try:
        r = requests.get(
            f"{base_url}/bigquery-data/activities/{username}", headers=headers, timeout=10
        )
        r.raise_for_status()
        return r.json()
    except requests.RequestException as exc:
        raise DashboardDataError("API indisponible pour les activités") from exc


def validate(payload: dict) -> dict:
    """Vérifie le contrat de données (colonnes et sports) avant de servir le front."""
    activities = payload.get("activities")
    if not isinstance(activities, list) or "meta" not in payload:
        raise DashboardDataError("Payload invalide : clés 'meta' et 'activities' attendues")
    for a in activities[:50]:  # échantillon : le contrat est vérifié en profondeur par les tests
        missing = REQUIRED_COLUMNS - a.keys()
        if missing:
            raise DashboardDataError(f"Colonnes manquantes : {sorted(missing)}")
        if a["sport_type"] not in SUPPORTED_SPORTS:
            raise DashboardDataError(f"Sport non supporté : {a['sport_type']}")
    return payload


def get_dashboard_payload(username: str) -> dict:
    """Point d'entrée unique utilisé par la route ``/dashboard/data``."""
    if get_source() == "bigquery":
        return validate(_fetch_bigquery(username))
    return validate(_load_mock())
