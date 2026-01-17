import os
from dotenv import load_dotenv, set_key, dotenv_values
import subprocess
import requests
BASE_URL = "http://192.168.1.12:5000"

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
    r = requests.post(f"{BASE_URL}/auth", json={"username": username, "password": password})
    return r.status_code == 200

def get_profile_info(username):
    r = requests.get(f"{BASE_URL}/users/{username}")
    if r.status_code == 200:
        return r.json()
    return None

def update_profile_info(username, first_name, last_name, email):
    r = requests.put(f"{BASE_URL}/users/{username}", json={
        "first_name": first_name,
        "last_name": last_name,
        "email": email
    })
    return r.status_code == 200

def update_profile_picture(username, file_storage):
    # On prépare le fichier pour l'envoi via requests
    files = {'photo': (file_storage.filename, file_storage.stream, file_storage.mimetype)}
    try:
        r = requests.post(f"{BASE_URL}/users/{username}/photo", files=files)
        return r.status_code == 200
    except Exception:
        return False