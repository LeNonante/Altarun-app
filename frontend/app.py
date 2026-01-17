from flask import Flask, request, session, redirect, url_for, render_template, Response
import os
from services.config import *
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_wtf.csrf import CSRFProtect

basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)
csrf = CSRFProtect(app) # Active la protection sur toute l'app. Permet d'ajouter des tokens CSRF uniques dans les formulaires.

app.config["APP_VERSION"] = get_git_version()
load_dotenv()

#Gestion de la clef secrete pour les sessions
if not isThereASecretKey(): #Si pas de clef secrete (utilisée pour les sessions)
    # Générer une clé secrète aléatoire et la stocker dans le .env
    secret_key = os.urandom(24).hex()
    setSecretKey(".env",secret_key)#Enregistrer la clef dans le .env
    app.secret_key=secret_key #Enregistrer la clef dans l'app
else :
    app.secret_key=getSecretKey() #Lire la clef dans le .env et l'enregistrer dans l'app

# Gestion des utilisateurs avec Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"      # page vers laquelle rediriger si pas connecté
class User(UserMixin):
    def __init__(self, username):
        self.id = username

@login_manager.user_loader
def load_user(user_id):
    return User(user_id)


@app.route('/settings', methods=['GET', 'POST'])
@login_required
def settings():
    context = {}
    context["version"] = app.config["APP_VERSION"]
    infos = get_profile_info(current_user.id)
    if infos:
        context["first_name"] = infos.get("first_name", "")
        context["last_name"] = infos.get("last_name", "")
        context["email"] = infos.get("email", "")
        context["username"] = infos.get("username", "")
    if request.method == "POST":
        if request.form.get("action") == "update_settings":
            first_name = request.form.get("first_name")
            last_name = request.form.get("last_name")
            email = request.form.get("email")
            if update_profile_info(current_user.id, first_name, last_name, email):
                context["first_name"] = first_name
                context["last_name"] = last_name
                context["email"] = email
            else:
                context["error"] = "Failed to update profile information."
    return render_template('settings.html', **context)


@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    context = {}
    context["version"] = app.config["APP_VERSION"]
    
    if request.method == "POST":
        if request.form.get("action") == "login":
            username = request.form.get("username")
            password = request.form.get("password")
            if check_password(username, password):
                user = User(username)
                login_user(user)
                session['username'] = username  # Stocke le nom d'utilisateur dans la session
                return redirect(url_for('index'))
            else:
                context["erreur"] = "Nom d'utilisateur ou mot de passe incorrect."
            
    return render_template('login.html', **context)


@app.route('/')
@login_required
def index():
    return f"Bonjour, {current_user.id}! Vous êtes connecté."

@app.route('/clubs')
@login_required
def clubs():
    return f"Voici la liste des clubs pour {current_user.id}."

@app.route('/coach')
@login_required
def coach():
    return f"Bienvenue dans l'espace coach, {current_user.id}."

@app.route('/logout')
@login_required
def logout():
    logout_user()
    session.clear()  # Nettoie complètement la session
    response = redirect(url_for('login'))
    return response

@app.route('/profile-picture/<username>')
@login_required
def profile_picture(username):
    # Le frontend demande l'image à l'API
    api_url = f"{BASE_URL}/users/{username}/photo"
    
    try:
        # On récupère l'image depuis l'API (stream=True est important pour la mémoire)
        resp = requests.get(api_url, stream=True)
        
        if resp.status_code == 200:
            # On renvoie l'image au navigateur exactement comme on l'a reçue
            return Response(
                resp.iter_content(chunk_size=1024), 
                content_type=resp.headers['Content-Type']
            )
        else:
            # Si pas d'image, redirection vers l'avatar par défaut statique du front
            return redirect(url_for('static', filename='images/logo.svg'))
            
    except Exception:
        return redirect(url_for('static', filename='images/logo.svg'))


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)