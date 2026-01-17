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
    