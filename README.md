# Altarun-app

Application web autour de la course à pied basée sur l'API **Strava**.

Le projet se découpe en trois étapes :

1. **Modern Data Stack** — pipeline ETL des données Strava des utilisateurs (exécutions tracées dans BigQuery).
2. **Web app communautaire** — dashboards Strava, clubs, équipes et défis entre coureurs.
3. **Module IA** *(à venir)* — génération de séances de course personnalisées à partir des données Strava de l'utilisateur.

## Architecture

```
Altarun-app/
├── api/          # Backend Flask + SQLAlchemy (port 5000) — REST protégée par Bearer
├── frontend/     # Frontend Flask + Jinja2 (port 5001) — UI utilisateur, OAuth Strava
├── docker-compose.yml
├── pyproject.toml    # Configuration Ruff (lint/format) + pytest
├── tests/            # Tests pytest
├── CLAUDE.md         # Contexte projet pour Claude Code
└── .claude/          # Sub-agents et settings Claude Code
```

Plus de détails techniques dans [`CLAUDE.md`](./CLAUDE.md).

## Démarrage rapide

### 1. Configuration des secrets

Copier le modèle et remplir les valeurs :

```bash
cp .env.example api/.env       # ne garder que les variables marquées API + COMMUN
cp .env.example frontend/.env  # ne garder que les variables marquées FRONTEND + COMMUN
```

Placer la clé de service Google Cloud (pour BigQuery) dans `api/gcp-key.json`.

### 2. Lancer avec Docker (recommandé)

Le réseau Docker `docker-stack_local-network` doit exister au préalable :

```bash
docker network create docker-stack_local-network 2>/dev/null || true
docker-compose up --build
```

- API : http://localhost:5000 (protégée par Bearer)
- Frontend : http://localhost:5001

### 3. Lancer en local (sans Docker)

Dans deux terminaux :

```bash
# Terminal 1 — API
cd api
pip install -r requirements.txt
python main.py

# Terminal 2 — Frontend
cd frontend
pip install -r requirements.txt
python app.py
```

## Qualité de code

Le projet utilise **Ruff** (lint + format) et **pytest** (tests). La configuration vit dans `pyproject.toml`.

```bash
pip install ruff pytest

ruff check . --fix       # corriger les warnings auto-corrigeables
ruff format .            # formater le code
pytest                   # lancer les tests
```

## Variables d'environnement

Voir [`.env.example`](./.env.example) pour la liste complète et les explications. Les principales :

| Variable | Service | Description |
|---|---|---|
| `API_TOKEN` | API + Frontend | Bearer token partagé entre les deux services |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Frontend | OAuth Strava |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | API | Gmail SMTP pour le reset de mot de passe |
| `APP_URL` / `API_URL` / `APP_PUBLIC_URL` | les deux | URLs des services |

## Travailler avec Claude Code

Ce dépôt est configuré pour [Claude Code](https://docs.claude.com/en/docs/claude-code/overview). Au démarrage, Claude Code lit automatiquement [`CLAUDE.md`](./CLAUDE.md) pour comprendre l'architecture et les conventions.

Trois sub-agents spécialisés sont disponibles dans `.claude/agents/` :

- `backend-expert` — Flask, SQLAlchemy, sécurité API, BigQuery.
- `frontend-expert` — Jinja2, CSS, Strava OAuth, Flask-Login.
- `devops-expert` — Docker, gunicorn, déploiement.

## Branches

`main` (intégration), `dev_louis`, `dev_aurel`, `ajout-cartes`, `dev-noms-onglets`, `menu-retractable`.

## Licence

Voir [`LICENSE`](./LICENSE).
