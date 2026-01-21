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

# Configuration pour Strava OAuth
CLIENT_ID = os.getenv("STRAVA_CLIENT_ID")
CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET")
URL=os.getenv("APP_URL")
URL_LOGIN_STRAVA = f"https://www.strava.com/oauth/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={URL}/exchange_token&approval_prompt=force&scope=read,activity:read_all"


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
            if 'profile_picture' in request.files:
                file = request.files['profile_picture']
                if file.filename != '':
                    update_profile_picture(current_user.id, file)
                    
            first_name = request.form.get("first_name")
            last_name = request.form.get("last_name")
            email = request.form.get("email")
            result = update_profile_info(current_user.id, first_name, last_name, email)
            if result:
                context["first_name"] = first_name
                context["last_name"] = last_name
                context["email"] = email
                context["message"] = "Profil mis à jour avec succès."
            else:
                context["error"] = "Échec de la mise à jour du profil. L'adresse e-mail est peut-être déjà utilisée."
        if request.form.get("action") == "update_password":
            current_password = request.form.get("current_password")
            new_password = request.form.get("new_password")
            confirm_password = request.form.get("confirm_password")
            if new_password != confirm_password:
                context["error_password"] = "Le nouveau mot de passe et la confirmation ne correspondent pas."
            elif not check_password(current_user.id, current_password):
                context["error_password"] = "Le mot de passe actuel est incorrect."
            else:
                if update_password(current_user.id, current_password, new_password):
                    context["message_password"] = "Mot de passe mis à jour avec succès."
                else:
                    context["error_password"] = "Échec de la mise à jour du mot de passe."
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
    context = {}
    context["version"] = app.config["APP_VERSION"]
    return render_template('index.html', **context)

@app.route('/clubs', methods=['GET', 'POST'])
@login_required
def clubs():
    context = {"version": app.config["APP_VERSION"]}
    clubs = get_profile_info(current_user.id).get("clubs", [])
    # Statistiques simples
    context["clubs"] = clubs
    context["total_clubs"] = len(clubs)
    context["active_members"] = sum(c.get("members_count", 0) for c in clubs)
    
    if request.method=="POST":
        action = request.form.get("action")
        if action == "join_club": # Rejoindre un club via code
            club_code = request.form.get("club_code")
            club_id=get_club_id_by_code(club_code)
            club_details=get_club_details(club_id)
            password = request.form.get("club_password")
            
            if club_details==404:
                context["error"] = f"Échec pour rejoindre le club : code invalide."
                return render_template('clubs.html', **context)
            else :
                is_private = club_details.get("is_private", False) # Club privé, demande de mot de passe
                
                # Cas 1: Club Privé ET pas de mot de passe fourni -> On ouvre la modale
                if is_private and not password:
                    context["ask_password"] = True       # Flag pour le template
                    context["target_code"] = club_code   # Pour pré-remplir la modale
                
                # Cas 2: Club Privé AVEC mot de passe -> On vérifie puis on rejoint
                elif is_private and password:
                    if check_club_password(club_id, password):
                        r = join_club(current_user.id, club_id)
                        if r == 200:
                            context["message"] = "Vous avez rejoint le club privé avec succès."
                            context["clubs"] = get_profile_info(current_user.id).get("clubs", [])
                        elif r == 400:
                            context["error"] = "Vous êtes déjà membre de ce club."
                    else:
                        context["error"] = "Mot de passe incorrect."
                        context["ask_password"] = True      # On rouvre la modale en cas d'erreur
                        context["target_code"] = club_code

                # Cas 3: Club Public -> On rejoint direct
                else:
                    r = join_club(current_user.id, club_id)
                    if r == 200:
                        context["message"] = "Vous avez rejoint le club avec succès."
                        context["clubs"] = get_profile_info(current_user.id).get("clubs", [])
                    elif r == 400:
                        context["error"] = "Vous êtes déjà membre de ce club."
                
        elif action == "create_club":
            club_name = request.form.get("club_name")
            if create_club(current_user.id, club_name):
                context["message"] = f"Le club '{club_name}' a été créé avec succès."
                # On recharge la liste des clubs
                context["clubs"] = get_profile_info(current_user.id).get("clubs", [])
            else:
                context["error"] = "Erreur lors de la création du club (le nom est peut-être déjà pris)."
                
    return render_template('clubs.html', **context)

@app.route('/coach')
@login_required
def coach():
    context = {}
    context["version"] = app.config["APP_VERSION"]
    return render_template('coach.html', **context)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    session.clear()  # Nettoie complètement la session
    response = redirect(url_for('login'))
    return response

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    context = {}
    context["version"] = app.config["APP_VERSION"]
    if request.method == "POST":
        if request.form.get("action") == "signup":
            username = request.form.get("username")
            password = request.form.get("password")
            confirm_password = request.form.get("confirm_password")
            email = request.form.get("email")
            if check_email_availability(email):
                if password != confirm_password:
                    context["erreur"] = "Le mot de passe et la confirmation ne correspondent pas."
                else :
                    result = create_user(username, email, password)
                    if result:
                        user = User(username)
                        login_user(user)
                        session['username'] = username  # Stocke le nom d'utilisateur dans la session
                        return redirect(url_for('index'))
                    else:
                        context["erreur"] = "Échec de la création du compte. Le nom d'utilisateur est peut-être déjà pris."
            else:
                context["erreur"] = "L'adresse e-mail est déjà utilisée."
    return render_template('signup.html', **context)

@app.route('/exchange_token')
def exchange_token():    
    # 1. Strava a renvoyé ton pote ici avec un code dans l'URL
    # ex: http://localhost:5000/exchange_token?code=a1b2c3d4...
    code = request.args.get('code')
    if not code:
        return "Erreur : Pas de code reçu de Strava."
    else :
        print(f"Code reçu de Strava : {code}")
        
    # 2. On échange ce code contre le TOKEN final
    token_response = requests.post(
        'https://www.strava.com/oauth/token',
        data={
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET,
            'code': code,
            'grant_type': 'authorization_code'
        }
    )
    
    # Convertir en JSON
    data = token_response.json()

    # --- C'EST ICI QUE TU PRINT ---
    print("\n--- NOUVEL UTILISATEUR CONNECTÉ ---")
    print(data) # Affiche tout le JSON dans ta console (terminal)
    print(f"Access Token : {data.get('access_token')}")
    print(f"Utilisateur : {data.get('athlete', {}).get('firstname')}")
    print("-----------------------------------\n")

    # 3. (Important) C'est ici que tu devrais sauvegarder le 'refresh_token' 
    # dans ta base de données associé au nom de ton pote.

    return f"Merci {data['athlete']['firstname']} ! Ton token a été reçu. Regarde la console du serveur."

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