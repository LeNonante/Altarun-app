# Tests

Tests automatisés du projet Altarun, organisés par service.

```
tests/
├── conftest.py          # Fixtures pytest partagées
├── api/                 # Tests du backend (api/main.py + modèles)
│   ├── __init__.py
│   └── test_smoke.py    # Vérifie que l'API démarre et que l'auth Bearer marche
└── frontend/            # Tests du frontend (frontend/app.py)
    ├── __init__.py
    └── test_smoke.py    # Vérifie le rendu des pages publiques
```

## Lancer les tests

```bash
# Tous les tests
pytest

# Uniquement l'API
pytest tests/api

# Verbeux
pytest -v

# Un test spécifique
pytest tests/api/test_smoke.py::test_unauthenticated_request_is_rejected
```

## Ajouter un test

- Un fichier par fonctionnalité, nommé `test_<feature>.py`.
- Une fonction par cas, nommée `test_<comportement_attendu>`.
- Utiliser les fixtures de `conftest.py` (notamment `api_client` et `auth_headers`).
- Pour les tests qui touchent la DB : utiliser une base SQLite temporaire (cf. fixture `api_app`).

Les tests fournis ici sont des **squelettes minimaux** : ils servent à vérifier que la structure marche. À toi (ou à Claude Code) de les compléter au fur et à mesure que le projet grandit.
