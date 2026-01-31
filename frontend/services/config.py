import os
from dotenv import load_dotenv, set_key, dotenv_values
import subprocess
import requests
import io
import base64
import qrcode
import pyotp

load_dotenv()
BASE_URL = os.environ.get("API_URL")

API_KEY = os.environ.get("API_TOKEN")

# C'est ici que ça change : format standard
HEADERS = {
    "Authorization": f"Bearer {API_KEY}"
}


def isThereASecretKey() :
    return os.getenv("SECRET_KEY_FRONT") is not None

def setSecretKey(env_file,key) :
    #Enregistrement de la clef secrete
    set_key(env_file, "SECRET_KEY_FRONT", key)
    load_dotenv(override=True)

def getSecretKey() :
    return os.getenv("SECRET_KEY_FRONT")

def get_git_version():
    try:
        return subprocess.check_output(
            ["git", "describe", "--tags", "--dirty", "--always"],
            stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "unknown"

def check_password(username, password):
    r = requests.post(f"{BASE_URL}/auth", json={"username": username, "password": password}, headers=HEADERS)
    return r.status_code == 200

def request_password_reset(email):
    try:
        r = requests.post(f"{BASE_URL}/auth/request-reset", json={"email": email}, headers=HEADERS)
        return r.status_code == 200
    except Exception:
        return False

def reset_password_with_token(token, new_password):
    try:
        r = requests.post(f"{BASE_URL}/auth/reset-password", json={
            "token": token,
            "new_password": new_password
        }, headers=HEADERS)
        if r.status_code == 200:
            return True, "Mot de passe modifié avec succès."
        else:
            return False, r.json().get('error', 'Erreur inconnue')
    except Exception:
        return False, "Erreur de connexion à l'API"


def create_user(username, email, password):
    r = requests.post(f"{BASE_URL}/users", json={
        "username": username,
        "email": email,
        "password": password
    }, headers=HEADERS)
    return r.status_code == 201

def get_profile_info(username):
    r = requests.get(f"{BASE_URL}/users/{username}", headers=HEADERS)
    if r.status_code == 200:
        return r.json()
    return None

def update_profile_info(username, first_name, last_name, email):
    r = requests.put(f"{BASE_URL}/users/{username}", json={
        "first_name": first_name,
        "last_name": last_name,
        "email": email
    }, headers=HEADERS)
    return r.status_code == 200

def enable_2fa(username):
    r = requests.post(f"{BASE_URL}/users/{username}/2fa/enable", headers=HEADERS)
    if r.status_code == 200:
        return r.json().get("secret")
    return None

def disable_2fa(username):
    r = requests.post(f"{BASE_URL}/users/{username}/2fa/disable", headers=HEADERS)
    return r.status_code == 200

def is_2fa_enabled(username):
    r = requests.get(f"{BASE_URL}/users/{username}/2fa/status", headers=HEADERS)
    if r.status_code == 200:
        return r.json().get("is_2fa_enabled", False)
    return False

def verify_2fa_token(username, token):
    r = requests.post(f"{BASE_URL}/users/{username}/2fa/verify", json={"token": token}, headers=HEADERS)
    if r.status_code == 200:
        return r.json().get("valid", False)
    return False

def create_qr_code(username, secret_key):
    # On prépare les infos pour Google Authenticator
    totp_auth = pyotp.TOTP(secret_key)
    
    # Création de l'URI (le lien qui contient la clé, le nom de l'app, et l'user)
    uri = totp_auth.provisioning_uri( 
        name=username,
        issuer_name="Altarun"
    )
    
    img = qrcode.make(uri)
    # 1. On crée un tampon mémoire (comme un fichier virtuel)
    buffer = io.BytesIO()
    # 2. On sauvegarde l'image dans ce tampon au format PNG
    img.save(buffer, format="PNG")
    # 3. On récupère les bytes, on encode en base64, et on decode en string utf-8
    img_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return img_str


def update_strava_connection(username, strava_id, access_token, expires_at, refresh_token):
    r = requests.put(f"{BASE_URL}/users/{username}/strava", json={
        "strava_id": strava_id,
        "access_token": access_token,
        "expires_at": expires_at,
        "refresh_token": refresh_token
    }, headers=HEADERS)
    return r.status_code == 200

def get_strava_connection(username):
    r = requests.get(f"{BASE_URL}/users/{username}/strava", headers=HEADERS)
    if r.status_code == 200:
        return r.json()
    return None

def disconnect_strava(username):
    r = requests.delete(f"{BASE_URL}/users/{username}/strava", headers=HEADERS)
    return r.status_code == 200

def update_profile_picture(username, file_storage):
    # On prépare le fichier pour l'envoi via requests
    files = {'photo': (file_storage.filename, file_storage.stream, file_storage.mimetype)}
    try:
        r = requests.post(f"{BASE_URL}/users/{username}/photo", files=files, headers=HEADERS)
        return r.status_code == 200
    except Exception:
        return False

def update_password(username, current_password, new_password):
    # Authentifier l'utilisateur avec le mot de passe actuel
    auth_response = requests.post(f"{BASE_URL}/auth", json={"username": username, "password": current_password}, headers=HEADERS)
    if auth_response.status_code != 200:
        return False  # Mot de passe actuel incorrect

    # Mettre à jour le mot de passe
    r = requests.put(f"{BASE_URL}/users/{username}/password", json={"new_password": new_password}, headers=HEADERS)
    return r.status_code == 200

def check_email_availability(email):
    r = requests.get(f"{BASE_URL}/check_email", params={"email": email}, headers=HEADERS)
    if r.status_code == 200:
        data = r.json()
        return data.get("available", False)
    return False

def list_clubs():
    try:
        r = requests.get(f"{BASE_URL}/clubs", headers=HEADERS)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return []

def get_club_details(club_id):
    if club_id is None:
        return 404
    r = requests.get(f"{BASE_URL}/clubs/{club_id}", headers=HEADERS)
    if r.status_code == 200:
        return r.json()
    return None

def get_club_id_by_code(club_code):
    clubs = list_clubs()
    club_id = next((c.get("id") for c in clubs if c.get("code") == club_code), None)
    return club_id

def check_club_password(club_id, password):
    """Vérifie le mot de passe du club via l'API"""
    try:
        r = requests.post(f"{BASE_URL}/clubs/auth", json={"id": club_id, "password": password}, headers=HEADERS)
        return r.status_code == 200
    except Exception:
        return False
    
def join_club(username, club_id):
    profile = get_profile_info(username)
    if not profile:
        return 400
    
    user_id = profile.get("id")
    
    if club_id is None:
        return 404
    
    r = requests.post(f"{BASE_URL}/clubs/{club_id}/join", json={"user_id": user_id}, headers=HEADERS)
    return r.status_code

def create_club(username, club_name):
    profile = get_profile_info(username)
    if not profile:
        return False
    
    user_id = profile.get("id")
    
    try:
        r = requests.post(f"{BASE_URL}/clubs", json={
            "name": club_name, 
            "user_id": user_id
        }, headers=HEADERS)
        return r.status_code == 201
    except Exception:
        return False
    
def get_admin_dashboard_stats():
    try:
        r = requests.get(f"{BASE_URL}/admin/stats", headers=HEADERS)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

def get_users_list():
    """Récupère la liste de tous les utilisateurs pour l'admin"""
    try:
        r = requests.get(f"{BASE_URL}/admin/users", headers=HEADERS)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return []

def update_user_role(user_id, is_admin):
    """Change le statut admin d'un utilisateur"""
    try:
        r = requests.put(f"{BASE_URL}/admin/users/{user_id}/role", 
                         json={"is_admin": is_admin}, 
                         headers=HEADERS)
        return r.status_code == 200
    except Exception:
        return False