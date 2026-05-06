"""Smoke tests pour le frontend.

Ces tests sont volontairement très légers — le frontend appelle l'API en HTTP via
``requests``, donc tester finement implique de mocker ces appels (à ajouter quand
on en aura besoin).
"""

from __future__ import annotations

import pytest


@pytest.mark.skip(
    reason=(
        "Le frontend importe app.py qui démarre des side-effects "
        "(connexion à l'API, génération SECRET_KEY_FRONT). À activer une fois "
        "que les imports sont mockés / paramétrables en mode test."
    )
)
def test_login_page_renders() -> None:
    """À implémenter : GET /login renvoie 200 et contient le formulaire de connexion."""
    raise NotImplementedError
