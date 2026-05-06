"""Service de gestion de la connexion Strava des utilisateurs.

Centralise la lecture et l'écriture des tokens Strava stockés sur le modèle
``User``. Aucune logique HTTP ici : ce module est appelé par les routes
Flask et manipule directement les objets SQLAlchemy.

Champs Strava concernés sur le modèle ``User`` :
    - ``is_strava_connected`` (bool)
    - ``strava_id`` (BigInteger, unique)
    - ``strava_access_token`` (str)
    - ``strava_expires_at`` (int, timestamp Unix)
    - ``strava_refresh_token`` (str)

Règle de cohérence : ``is_strava_connected = True`` implique que les quatre
autres champs sont renseignés. Inversement, ``disconnect_user`` les remet
tous à None et passe le flag à False.
"""

from __future__ import annotations

from database.extensions import db
from database.models import User


def list_connected_users() -> list[dict]:
    """Retourne la liste des utilisateurs connectés à Strava avec leurs tokens.

    Utilisé par le pipeline ETL pour rafraîchir les activités côté data stack.
    """
    users = User.query.filter_by(is_strava_connected=True).all()
    return [
        {
            "username": u.username,
            "strava_id": u.strava_id,
            "access_token": u.strava_access_token,
            "expires_at": u.strava_expires_at,
            "refresh_token": u.strava_refresh_token,
        }
        for u in users
    ]


def get_strava_payload(user: User) -> dict:
    """Renvoie le bloc Strava d'un utilisateur, prêt pour ``jsonify``."""
    return {
        "is_strava_connected": user.is_strava_connected,
        "strava_id": user.strava_id,
        "strava_access_token": user.strava_access_token,
        "strava_expires_at": user.strava_expires_at,
        "strava_refresh_token": user.strava_refresh_token,
    }


def update_user_tokens(user: User, data: dict, *, mark_connected: bool = True) -> None:
    """Met à jour les champs Strava d'un utilisateur depuis un payload JSON.

    Clés acceptées dans ``data`` : ``strava_id``, ``access_token``,
    ``expires_at``, ``refresh_token`` et ``is_strava_connected``
    (optionnel, ignoré si ``mark_connected`` est ``True``).

    Si ``mark_connected`` est ``True`` (cas de la route
    ``/users/<username>/strava`` PUT), force ``is_strava_connected`` à
    ``True``. Sinon (cas de l'ETL ``/etl/stravausers`` PUT), respecte la
    valeur fournie dans ``data`` si présente.
    """
    if mark_connected:
        user.is_strava_connected = True
    elif "is_strava_connected" in data:
        user.is_strava_connected = data["is_strava_connected"]

    user.strava_id = data.get("strava_id", user.strava_id)
    user.strava_access_token = data.get("access_token", user.strava_access_token)
    user.strava_expires_at = data.get("expires_at", user.strava_expires_at)
    user.strava_refresh_token = data.get("refresh_token", user.strava_refresh_token)
    db.session.commit()


def disconnect_user(user: User) -> None:
    """Déconnecte un utilisateur de Strava : nettoie tous les champs Strava."""
    user.is_strava_connected = False
    user.strava_id = None
    user.strava_access_token = None
    user.strava_expires_at = None
    user.strava_refresh_token = None
    db.session.commit()
