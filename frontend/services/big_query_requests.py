import os
from dotenv import load_dotenv, set_key, dotenv_values
import subprocess
import requests


load_dotenv()
BASE_URL = os.environ.get("API_URL")

API_KEY = os.environ.get("API_TOKEN")

# C'est ici que ça change : format standard
HEADERS = {
    "Authorization": f"Bearer {API_KEY}"
}

def get_last_elt_executions():
    """récupere les 10 dernières exécutions de l'ETL Strava depuis BigQuery"""
    try:
        r = requests.get(f"{BASE_URL}/bigquery-data/last-executions", 
                         headers=HEADERS)
        r.raise_for_status()  # Lève une exception si code != 200
        return r.json()
    except requests.exceptions.HTTPError as e:
        return False
    except Exception as e:
        return False