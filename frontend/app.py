from flask import Flask, request, session, redirect, url_for, render_template
import os
from services.config import *

basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)


app.config["APP_VERSION"] = get_git_version()
load_dotenv()


if not isThereASecretKey(): #Si pas de clef secrete (utilisée pour les sessions)
    # Générer une clé secrète aléatoire et la stocker dans le .env
    secret_key = os.urandom(24).hex()
    setSecretKey(".env",secret_key)#Enregistrer la clef dans le .env
    app.secret_key=secret_key #Enregistrer la clef dans l'app
else :
    app.secret_key=getSecretKey() #Lire la clef dans le .env et l'enregistrer dans l'app
    

@app.route('/login')
def login():
    context = {}
    context["version"] = app.config["APP_VERSION"]
    if request.method == "POST":
        context["erreur"] = "Nom d'utilisateur ou mot de passe incorrect."
            
    return render_template('login.html', **context)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)