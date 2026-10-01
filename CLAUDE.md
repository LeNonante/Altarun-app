# CLAUDE.md

> Ce fichier fournit le contexte du projet à Claude Code. Il est lu automatiquement au démarrage de chaque session.
> Documentation : https://docs.claude.com/en/docs/claude-code/memory

## Présentation du projet

**Altarun** est une application web autour de la course à pied basée sur l'API Strava. Elle est construite en trois grandes parties :

1. **Pipeline de données (Modern Data Stack)** : récupération et traitement des données Strava des utilisateurs (les exécutions ETL sont tracées dans BigQuery).
2. **Web app communautaire** : affichage de dashboards sur les activités Strava, création de clubs, équipes, défis entre coureurs.
3. **Module IA (à venir)** : génération de séances de course à pied personnalisées à partir des données Strava de l'utilisateur.

L'app est en français (UI, commentaires, messages d'erreur). Toute nouvelle fonctionnalité doit conserver cette langue côté utilisateur.

## Architecture

Le projet est organisé en deux services Flask indépendants qui communiquent en HTTP via un token Bearer.

```
Altarun-app/
├── api/                          # Service backend (Flask + SQLAlchemy)
│   ├── main.py                   # Point d'entrée léger : config Flask/DB, middleware Bearer, routage
│   ├── services/                 # Coeur de la logique data/API (Service Layer)
│   │   ├── __init__.py
│   │   ├── bigquery_service.py   # Client BigQuery + requêtes SQL (auth GCP)
│   │   └── strava_service.py     # Lecture/écriture des tokens Strava sur User
│   ├── database/
│   │   ├── extensions.py         # Instance SQLAlchemy (db)
│   │   └── models.py             # Modèles : User, Club, Team + tables d'association
│   ├── instance/                 # Base SQLite (généré, ignoré par git)
│   ├── static/avatars/           # Avatars par défaut
│   ├── requirements.txt
│   └── Dockerfile                # Expose le port 5000, gunicorn
│
├── frontend/                     # Service frontend (Flask + Jinja2)
│   ├── app.py                    # Routes web, intégration Strava OAuth, sessions
│   ├── services/
│   │   ├── config.py             # Wrappers HTTP vers l'API + utilitaires (2FA, QR code)
│   │   ├── big_query_requests.py
│   │   └── dashboard_data.py     # Source du dashboard (mock|bigquery) + validation du contrat fct_activities
│   ├── data/mock/                # Jeu de démo fct_activities.json (généré par scripts/)
│   ├── templates/                # Templates Jinja2 (login, clubs, settings, admin, ...)
│   ├── static/css|images/
│   ├── static/js/                # metrics.js (KPI), charts.js (SVG), dashboard.js (page d'accueil), studio.js (Studio KPI), coach.js (chat Coach IA)
│   ├── requirements.txt
│   └── Dockerfile                # Expose le port 5001, gunicorn
│
├── docker-compose.yml            # Orchestre les deux services sur le réseau docker-stack_local-network
├── pyproject.toml                # Config Ruff + pytest (racine partagée)
├── scripts/                      # generate_mock_activities.py (jeu de démo calibré, seed fixe)
├── tests/                        # Tests pytest (api/ et frontend/)
├── .env.example                  # Modèle de variables d'environnement
└── CLAUDE.md                     # Ce fichier
```

### Architecture en couches côté API

`api/main.py` reste un point d'entrée volontairement fin : il configure Flask/SQLAlchemy, déclare le middleware Bearer (`@app.before_request`) et expose les routes REST. Toute la logique data/API externe vit dans `api/services/` :

- `services/bigquery_service.py` : configuration des credentials GCP, client BigQuery (singleton paresseux), requêtes SQL contre l'entrepôt Strava. Les fonctions retournent des structures Python prêtes pour `jsonify()`.
- `services/strava_service.py` : lecture/écriture des tokens Strava sur le modèle `User`, listing des utilisateurs connectés pour l'ETL, déconnexion. Aucune logique HTTP, manipule directement les objets SQLAlchemy.

Quand tu ajoutes ou modifies une route qui touche à BigQuery ou aux tokens Strava, **passe toujours par les services** plutôt que d'écrire la logique directement dans `main.py`. Si une nouvelle source de données externe arrive (Pydantic schemas, webhooks Strava, autres entrepôts), créer un nouveau fichier dans `api/services/` plutôt que de gonfler les existants.

### Flux d'authentification

- Toute requête vers l'API doit porter un header `Authorization: Bearer <API_TOKEN>` (vérifié dans `@app.before_request`).
- Le frontend gère les sessions utilisateur avec **Flask-Login** + protection CSRF (**Flask-WTF**).
- 2FA optionnel via TOTP (**pyotp**) : secret stocké en base, QR code généré côté frontend.
- Reset de mot de passe par email (Flask-Mail / Gmail SMTP) avec token expirant en 1 h.
- OAuth Strava : redirection vers `https://www.strava.com/oauth/authorize`, callback sur `/exchange_token`.

### Modèles de données (api/database/models.py)

- `User` : id, username, email, password_hash, photo (LargeBinary), 2FA, tokens Strava, reset_token.
- `Club` : id, name, code (6 caractères unique), is_private, password_hash, admin_id (FK User).
- `Team` : id, name, color, photo, club_id (FK Club, cascade).
- `club_membership` : table d'association User ↔ Club (Many-to-Many).
- `team_membership` : table d'association User ↔ Team (Many-to-Many).

## Stack technique

| Couche | Technologies |
|---|---|
| Langage | Python 3.10 |
| Backend | Flask, Flask-SQLAlchemy, Flask-Mail, gunicorn |
| Frontend | Flask, Jinja2, Flask-Login, Flask-WTF (CSRF), requests |
| Base de données | SQLite (fichier `api/instance/Altarun-api.db`) |
| Auth | Bearer token API + Flask-Login + 2FA (pyotp) |
| Intégrations | Strava OAuth, Google BigQuery, Gmail SMTP |
| Infra | Docker, docker-compose |
| Qualité | Ruff (lint + format), pytest |

## Commandes utiles

### Lancer l'application

```bash
# Tout via Docker (recommandé) : nécessite le réseau externe docker-stack_local-network
docker-compose up --build

# En local sans Docker (deux terminaux séparés)
cd api && pip install -r requirements.txt && python main.py            # API sur :5000
cd frontend && pip install -r requirements.txt && python app.py        # Frontend sur :5001
```

### Qualité de code

```bash
# Lint + format avec Ruff (configuré dans pyproject.toml)
ruff check .                  # voir les erreurs
ruff check . --fix            # corriger ce qui est auto-corrigeable
ruff format .                 # formater le code

# Tests
pytest                        # tous les tests
pytest tests/api              # uniquement les tests de l'API
pytest -v                     # mode verbeux
pytest -k "club"              # filtrer par nom
```

### Git

```bash
# Branches actives
git branch -a                 # main, dev_louis, dev_aurel, ajout-cartes, dev-noms-onglets, menu-retractable
```

### Dashboard (page d'accueil)

- Toute définition de KPI vit dans `frontend/static/js/metrics.js` (une formule = un endroit). Ne pas recalculer un KPI dans `dashboard.js`.
- Les couleurs de sport sont fixes (ordre de `SPORTS`) et validées daltonisme : ne jamais les réattribuer selon le filtre.
- Le front ne lit que le contrat `fct_activities` via `GET /dashboard/data`. Pour brancher la vraie donnée : `DASHBOARD_SOURCE=bigquery` + route API `GET /bigquery-data/activities/<username>` (à implémenter dans `api/services/bigquery_service.py`).
- Studio KPI : ajouter une mesure ou une dimension = une entrée dans `MEASURES` / `DIMS` de `studio.js` (fonction JS + expression SQL BigQuery équivalente). Les dimensions croisées sont calculées dans `enrich()` de `dashboard.js`.
- Après modification du générateur : `python scripts/generate_mock_activities.py && pytest tests/frontend`.

## Variables d'environnement

Voir `.env.example` à la racine pour la liste complète. Les services lisent leur propre `.env` :

- `api/.env` : `API_TOKEN`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `APP_URL`
- `frontend/.env` : `API_TOKEN`, `API_URL`, `APP_URL`, `APP_PUBLIC_URL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `SECRET_KEY_FRONT` (auto-généré), `DASHBOARD_SOURCE` (`mock` par défaut)

Le fichier `api/gcp-key.json` (clé de service Google Cloud pour BigQuery) doit être placé manuellement, il est gitignoré.

## Conventions de code

- **Langue** : code en Python, commentaires et messages utilisateur en **français**. Garder ce parti pris.
- **Style** : Ruff fait foi (PEP 8, longueur de ligne 100, double quotes). Lance `ruff format .` avant de committer.
- **Routes** : déclarées en plat dans `main.py` (api) et `app.py` (frontend). Pas (encore) de blueprints. Si un fichier dépasse 1000 lignes, c'est le moment de découper.
- **DB** : toujours passer par `db.session.commit()` après une modification. Utiliser `try/except` + `rollback()` pour les contraintes d'unicité.
- **API responses** : retourner `({...}, status_code)`. Privilégier `jsonify()` pour les listes.
- **Sécurité** : ne jamais logger un token Strava, un mot de passe, une `API_TOKEN` ni le contenu de `gcp-key.json`. Hasher tous les mots de passe avec `werkzeug.security`.
- **Photos utilisateurs** : stockées en `LargeBinary` directement en base (pas de filesystem).

## Workflow recommandé pour Claude Code

Quand tu travailles sur ce projet :

1. **Avant de modifier l'API** : lire `api/main.py`, `api/database/models.py`, et le module concerné dans `api/services/` si la demande touche BigQuery ou Strava. La plupart des routes sont protégées par le check `@app.before_request`.
2. **Pour toute logique BigQuery ou Strava côté API** : passer par `api/services/`. Ne jamais réintroduire d'appels `bigquery.Client()` ni d'écritures de tokens dans `main.py`.
3. **Avant de modifier le frontend** : lire le template Jinja concerné dans `frontend/templates/` ET la fonction de service correspondante dans `frontend/services/config.py` (qui appelle l'API).
4. **Avant de toucher aux modèles** : SQLAlchemy ne fait pas de migration automatique sur SQLite. Si tu changes un modèle existant, il faut soit supprimer `api/instance/Altarun-api.db` (perte de données), soit écrire une migration manuelle.
5. **Toujours** : exécuter `ruff check . --fix && ruff format .` avant de présenter le diff final.
6. **Idéalement** : ajouter / mettre à jour les tests dans `tests/` quand tu touches au code.

## Sub-agents disponibles

Voir `.claude/agents/` :

- `backend-expert` : spécialiste du "Core" backend : routes Flask, sessions, sécurité (Bearer, CSRF, 2FA, hash de mots de passe), modèles métier (User/Club/Team), logique métier de haut niveau (clubs, équipes, admin). Délègue toute la partie Strava/BigQuery à `data-api-expert`.
- `frontend-expert` : spécialiste Flask/Jinja, UX, intégration Strava OAuth côté UI, Flask-Login, Flask-WTF.
- `data-api-expert` : expert intégration de données et ingénierie API : flux OAuth2 Strava (refresh tokens, parsing d'activités, webhooks), Google BigQuery (schémas, requêtes SQL, quotas/auth GCP), validation stricte avec Pydantic. Possède toute la logique située dans les services qui appellent une API externe ou qui stockent / requêtent des données externes.

### Règle de routage entre `backend-expert` et `data-api-expert`

- Si la demande touche une route REST "métier" (utilisateurs, clubs, équipes, admin, 2FA, reset password, sessions) sans appel externe : `backend-expert`.
- Si la demande touche un appel à l'API Strava, un refresh de token, un parsing d'activité, un webhook, une requête BigQuery, ou la validation d'un payload externe : `data-api-expert`.
- Si la demande est mixte (ex: une nouvelle route qui aggrège des stats Strava issues de BigQuery), `backend-expert` prend la route + l'auth + les permissions, puis passe la main à `data-api-expert` pour la partie data.

## Choses à NE PAS faire

- Ne jamais committer `api/gcp-key.json`, `api/.env`, `frontend/.env`, `api/instance/*.db` (déjà dans `.gitignore`).
- Ne jamais hardcoder l'`API_TOKEN`, les credentials Strava ou le mot de passe Gmail.
- Ne pas désactiver le check Bearer du `before_request` même temporairement : c'est la seule barrière entre l'API et l'extérieur.
- Ne pas casser la rétro-compatibilité des routes existantes (le frontend tape dessus en HTTP).
- Ne pas ajouter de dépendances JS lourdes côté frontend sans en discuter : l'app est volontairement légère (Jinja + CSS + un peu de JS vanilla).
