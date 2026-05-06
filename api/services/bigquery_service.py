"""Service d'accès à Google BigQuery.

Centralise la configuration du client BigQuery et les requêtes SQL exécutées
contre l'entrepôt Strava. Aucune logique HTTP ici : ce module est appelé
par les routes Flask et retourne des structures Python prêtes à passer à
``jsonify()``.

L'authentification GCP repose sur la variable d'environnement
``GOOGLE_APPLICATION_CREDENTIALS`` qui doit pointer vers un fichier de clé
de service (``api/gcp-key.json`` par défaut). Voir ``configure_credentials``.
"""

from __future__ import annotations

import os

from google.cloud import bigquery

# Client BigQuery instancié à la demande (singleton paresseux).
_client: bigquery.Client | None = None


def configure_credentials(credentials_path: str) -> None:
    """Renseigne la variable d'environnement ``GOOGLE_APPLICATION_CREDENTIALS``.

    À appeler une seule fois au démarrage de l'application avec le chemin
    absolu vers le fichier ``gcp-key.json``. Le client BigQuery utilise
    ensuite cette variable pour s'authentifier automatiquement.
    """
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path


def get_client() -> bigquery.Client:
    """Retourne le client BigQuery (créé à la première utilisation)."""
    global _client
    if _client is None:
        _client = bigquery.Client()
    return _client


def get_last_etl_executions(limit: int = 10) -> list[dict]:
    """Retourne les ``limit`` dernières exécutions de l'ETL Strava.

    Lève une exception si la requête échoue (à attraper côté route).
    Les valeurs retournées sont prêtes à être sérialisées en JSON.
    """
    if not isinstance(limit, int) or limit <= 0:
        raise ValueError("limit doit être un entier strictement positif")

    client = get_client()
    query = f"""
        SELECT *
        FROM `dashboardstrava-grafana.strava_data.timestamp_executions_order`
        LIMIT {limit}
    """
    query_job = client.query(query)
    return [dict(row) for row in query_job]
