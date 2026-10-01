# Altarun-app

Application web autour de la course à pied basée sur l'API **Strava**.

Le projet se découpe en trois étapes :

1. **Modern Data Stack** : pipeline ETL des données Strava des utilisateurs (exécutions tracées dans BigQuery).
2. **Web app communautaire** : dashboards Strava, clubs, équipes et défis entre coureurs.
3. **Module IA** *(à venir)* : génération de séances de course personnalisées à partir des données Strava de l'utilisateur.

## Architecture

```
Altarun-app/
├── api/          # Backend Flask + SQLAlchemy (port 5000) : REST protégée par Bearer
├── frontend/     # Frontend Flask + Jinja2 (port 5001) : UI utilisateur, OAuth Strava
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
# Terminal 1 : API
cd api
pip install -r requirements.txt
python main.py

# Terminal 2 : Frontend
cd frontend
pip install -r requirements.txt
python app.py
```

## Dashboard multi-sport (page d'accueil)

La page d'accueil affiche un dashboard d'analyse multi-sport (course, natation, tennis, escalade, golf) avec un sélecteur de sport et de période (4 sem. → 12 mois, comparaison automatique à la période précédente).

**Flux de données**

```
BigQuery (mart dbt fct_activities)  ──►  API /bigquery-data/activities/<user>  ──┐
                                                                                   ├──►  frontend/services/dashboard_data.py  ──►  GET /dashboard/data  ──►  JS
frontend/data/mock/fct_activities.json (jeu de démo, seed fixe)  ─────────────────┘        (DASHBOARD_SOURCE=mock|bigquery, validation du contrat)
```

| Couche | Fichier | Rôle |
|---|---|---|
| Données de démo | `scripts/generate_mock_activities.py` | Génère un jeu déterministe et **calibré** (~17 h/sem. : course 65 km/sem. à 5'20"/km, tennis 7 h, natation 1 h, golf 2 h une semaine sur deux à index ~40, escalade 1 h) avec des effets croisés réalistes |
| Contrat | `frontend/services/dashboard_data.py` | Choix de la source, validation des colonnes `fct_activities` |
| Couche sémantique | `frontend/static/js/metrics.js` | Définitions uniques des KPI : TRIMP, CTL/ATL/TSB, ACWR, efficacité aérobie, Riegel, index golf |
| Visualisation | `frontend/static/js/charts.js` | Mini-librairie SVG sans dépendance (barres, lignes, nuages, heatmaps, calendrier) + vue tableau accessible |
| Page | `frontend/static/js/dashboard.js`, `templates/index.html` | Filtres, tuiles KPI, analyses croisées, export CSV |
| Studio KPI | `frontend/static/js/studio.js` | Constructeur de KPI en glisser-déposer (mesures × dimensions, dont dimensions croisées : activité/charge de la veille, forme du jour, semaine avec golf), 6 visuels, requête BigQuery générée, épinglage sur la vue d'ensemble. Le visuel « Comparaison » produit les cartes « Analyses croisées » (groupe A vs B ou valeur vs cible) : les 4 cartes par défaut sont des configurations du Studio, modifiables et remplaçables |

**Profil sportif** (`static/js/profile.js`, bouton « Mes objectifs » et « Modifier » dans le coach) : objectif de course (nom, date, distance, chrono visé), objectifs hebdomadaires par sport, FC max et de repos, parcours de golf de référence. Toutes les cibles affichées en découlent.

**Coach IA** (`templates/coach.html`, `static/js/coach.js`) : chat avec le coach, alimenté par un contexte calculé depuis `fct_activities` (forme du jour, charge, records, prédictions, effets croisés), affiché à droite de la conversation. Les réponses sont aujourd'hui générées localement à partir de ce contexte ; le branchement d'un modèle de langage passera par une route `POST /coach/message` qui recevra ce même contexte.

**KPI notables** : charge d'entraînement TRIMP commune à tous les sports, modèle forme/fatigue/fraîcheur (Banister), ratio charge aiguë/chronique (risque de blessure), polarisation 80/20 par zones cardiaques, corrélations entre sports, effets mesurés (tennis la veille → allure du lendemain, semaine golf → sortie longue), prédictions de temps de course, index golf estimé (méthode WHS).

```bash
python scripts/generate_mock_activities.py        # régénère le jeu de démo (seed 57)
pytest tests/frontend/test_dashboard_data.py      # vérifie le contrat et la calibration
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

- `backend-expert` : Flask, SQLAlchemy, sécurité API, BigQuery.
- `frontend-expert` : Jinja2, CSS, Strava OAuth, Flask-Login.
- `devops-expert` : Docker, gunicorn, déploiement.

## Branches

`main` (intégration), `dev_louis`, `dev_aurel`, `ajout-cartes`, `dev-noms-onglets`, `menu-retractable`.

## Licence

Voir [`LICENSE`](./LICENSE).
