"""Fixtures pytest partagées pour les tests Altarun."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
API_DIR = ROOT_DIR / "api"
FRONTEND_DIR = ROOT_DIR / "frontend"


@pytest.fixture(scope="session", autouse=True)
def _set_env_for_tests(tmp_path_factory: pytest.TempPathFactory) -> None:
    """Variables d'environnement minimales pour faire booter l'API et le frontend en test.

    On utilise une base SQLite temporaire et un token bidon pour ne jamais toucher
    à la base réelle ni aux secrets de prod.
    """
    os.environ.setdefault("API_TOKEN", "test-bearer-token")
    os.environ.setdefault("APP_URL", "http://localhost:5001")
    os.environ.setdefault("API_URL", "http://localhost:5000")
    os.environ.setdefault("APP_PUBLIC_URL", "http://localhost:5001")
    os.environ.setdefault("MAIL_USERNAME", "test@example.com")
    os.environ.setdefault("MAIL_PASSWORD", "fake")
    os.environ.setdefault("STRAVA_CLIENT_ID", "0")
    os.environ.setdefault("STRAVA_CLIENT_SECRET", "fake")
    os.environ.setdefault("SECRET_KEY_FRONT", "test-secret-key")


@pytest.fixture
def api_app():
    """Charge l'app Flask de l'API avec une DB SQLite temporaire en mémoire.

    NOTE : le module ``api/main.py`` instancie l'app au moment de l'import, donc
    on ajoute ``api/`` à ``sys.path`` puis on importe.
    """
    sys.path.insert(0, str(API_DIR))
    # On importe ici pour bénéficier des variables d'env définies plus haut.
    import main as api_main  # type: ignore[import-not-found]

    api_main.app.config["TESTING"] = True
    api_main.app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

    with api_main.app.app_context():
        api_main.db.create_all()
        yield api_main.app
        api_main.db.session.remove()
        api_main.db.drop_all()


@pytest.fixture
def api_client(api_app):
    """Test client Flask pour taper sur l'API."""
    return api_app.test_client()


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Headers d'auth valides à passer à toutes les requêtes API protégées."""
    return {"Authorization": f"Bearer {os.environ['API_TOKEN']}"}
