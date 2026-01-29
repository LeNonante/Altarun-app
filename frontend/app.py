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
URL_PUBLIC=os.getenv("APP_PUBLIC_URL")
URL_LOGIN_STRAVA = f"https://www.strava.com/oauth/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={URL_PUBLIC}/exchange_token&approval_prompt=force&scope=read,activity:read_all"

API_KEY = os.environ.get("API_TOKEN")

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
    context["strava_login_url"] = URL_LOGIN_STRAVA
    infos = get_profile_info(current_user.id)
    context["is_admin"] = infos.get("is_admin", False)
    is_strava_connected = infos.get("is_strava_connected", False)
    
    # Récupérer les messages d'erreur et de succès
    context["error"] = request.args.get('error')
    context["message"] = request.args.get('message')
    
    context["is_strava_connected"] = is_strava_connected
    context["is_2fa_enabled"] = infos.get("is_2fa_enabled", False)
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
        if request.form.get("action") == "toggle_2fa":
            enable_flag = request.form.get("enable_2fa") == "true"
            if enable_flag:
                secret = enable_2fa(current_user.id)
                if secret:
                    context["is_2fa_enabled"] = True
                    context["img_qr_code"] = create_qr_code(current_user.id, secret)
                    context["secret_2fa"] = secret
                else:
                    context["error"] = "Impossible d'activer la 2FA pour le moment."
            else:
                if disable_2fa(current_user.id):
                    context["is_2fa_enabled"] = False
                    context["message"] = "2FA désactivée."
                else:
                    context["error"] = "Impossible de désactiver la 2FA pour le moment."
        if request.form.get("action") == "disconnect_strava":
            if disconnect_strava(current_user.id):
                context["is_strava_connected"] = False
                context["message"] = "Déconnexion de Strava réussie."
            else:
                context["error"] = "Échec de la déconnexion de Strava."
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
                is_2fa_enabled_flag = is_2fa_enabled(username)
                if is_2fa_enabled_flag:
                    # SI 2FA : STOCKAGE TEMPORAIRE DANS LA SESSION
                    # On ne connecte pas encore l'utilisateur, on le met "en attente"
                    session['pre_2fa_user'] = username
                    return redirect(url_for('two_fa'))
                else :
                    user = User(username)
                    login_user(user)
                    session['username'] = username  # Stocke le nom d'utilisateur dans la session
                    session.pop('pre_2fa_user', None) # Nettoyage de sécurité
                    return redirect(url_for('index'))
            else:
                context["erreur"] = "Nom d'utilisateur ou mot de passe incorrect."
            
    return render_template('login.html', **context)

@app.route('/two_fa', methods=["GET", "POST"])
def two_fa():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    context = {}
    context["version"] = app.config["APP_VERSION"]
    username = session.get('pre_2fa_user')
    if not username:
        return redirect(url_for('login'))
    context["username"] = username
    if request.method == "POST":
        if request.form.get("action")=="loginUser":
            code_2fa = request.form.get("2fa_code")
            if verify_2fa_token(username, code_2fa):
                # Code 2FA correct, on connecte l'utilisateur
                login_user(User(username))
                session.pop('pre_2fa_user', None) # Nettoyage de sécurité
                return redirect(url_for('index'))
            else:
                context["erreur"] = "Code 2FA incorrect. Veuillez réessayer."
                return render_template('login_a2f.html',  **context)
    return render_template('login_a2f.html', **context)

@app.route('/')
@login_required
def index():
    context = {}
    context["version"] = app.config["APP_VERSION"]
    infos = get_profile_info(current_user.id)
    context["is_admin"] = infos.get("is_admin", False)
    context["is_strava_connected"] = infos.get("is_strava_connected", False)
    context["strava_login_url"] = URL_LOGIN_STRAVA
    return render_template('index.html', **context)

@app.route('/clubs', methods=['GET', 'POST'])
@login_required
def clubs():
    context = {"version": app.config["APP_VERSION"]}
    infos = get_profile_info(current_user.id)
    clubs = infos.get("clubs", [])
    # Statistiques simples
    context["clubs"] = clubs
    context["total_clubs"] = len(clubs)
    context["active_members"] = sum(c.get("members_count", 0) for c in clubs)
    context["is_strava_connected"] = infos.get("is_strava_connected", False)
    context["strava_login_url"] = URL_LOGIN_STRAVA
    
    context["is_admin"] = infos.get("is_admin", False)
    
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
    infos = get_profile_info(current_user.id)
    context["is_admin"] = infos.get("is_admin", False)
    context["is_strava_connected"] = infos.get("is_strava_connected", False)
    context["strava_login_url"] = URL_LOGIN_STRAVA
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
            context["username"] = request.form.get("username")
            context["password"] = request.form.get("password")
            confirm_password = request.form.get("confirm_password")
            context["email"] = request.form.get("email")
            if check_email_availability(context["email"]):
                if context["password"] != confirm_password:
                    context["erreur"] = "Le mot de passe et la confirmation ne correspondent pas."
                else :
                    result = create_user(context["username"], context["email"], context["password"])
                    if result:
                        user = User(context["username"])
                        login_user(user)
                        session['username'] = context["username"]  # Stocke le nom d'utilisateur dans la session
                        return redirect(url_for('index'))
                    else:
                        context["erreur"] = "Échec de la création du compte. Le nom d'utilisateur est peut-être déjà pris."
            else:
                context["erreur"] = "L'adresse e-mail est déjà utilisée."
    return render_template('signup.html', **context)


@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    context = {"version": app.config["APP_VERSION"]}
    
    if request.method == 'POST':
        email = request.form.get('email')
        request_password_reset(email)
        # On affiche le message quoi qu'il arrive
        context["message"] = "Si un compte est associé à cet email, vous recevrez un lien de réinitialisation."
        
    return render_template('forgot_password.html', **context)

@app.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password_view(token):
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    context = {"version": app.config["APP_VERSION"]}
    
    if request.method == 'POST':
        password = request.form.get('password')
        confirm = request.form.get('confirm_password')
        
        if password != confirm:
            context["erreur"] = "Les mots de passe ne correspondent pas."
        else:
            success, msg = reset_password_with_token(token, password)
            if success:
                return redirect(url_for('login', message="Mot de passe réinitialisé. Connectez-vous."))
            else:
                context["erreur"] = msg
                
    return render_template('reset_password.html', **context)


@app.route('/exchange_token')
@login_required
def exchange_token():
    code = request.args.get('code')
    if not code:
        return "Erreur : Pas de code reçu de Strava."
    
    token_response = requests.post(
        'https://www.strava.com/oauth/token',
        data={
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET,
            'code': code,
            'grant_type': 'authorization_code'
        }
    )
    
    data = token_response.json()
    access_token = data.get('access_token')
    refresh_token = data.get('refresh_token')
    strava_id = data.get('athlete', {}).get('id')
    expires_at = data.get('expires_at')
    
    if not access_token or not refresh_token:
        return redirect(url_for('settings', error="Erreur lors de l'échange du token avec Strava."))

    r = update_strava_connection(current_user.id, strava_id,access_token, expires_at, refresh_token)
    if r:
        return redirect(url_for('settings', message="Connexion à Strava réussie !"))
    else:
        return redirect(url_for('settings', error="Échec de la connexion à Strava dans votre profil."))

@app.route('/admin')
@login_required
def admin():
    context = {}
    context["version"] = app.config["APP_VERSION"]
    infos = get_profile_info(current_user.id)
    if not infos.get("is_admin", False):
        return redirect(url_for('index'))
    context["is_strava_connected"] = infos.get("is_strava_connected", False)
    context["strava_login_url"] = URL_LOGIN_STRAVA
    return render_template('admin.html', **context)

@app.route('/profile-picture/<username>')
@login_required
def profile_picture(username):
    # Le frontend demande l'image à l'API
    api_url = f"{BASE_URL}/users/{username}/photo"

    # C'est ici que ça change : format standard
    HEADERS = {
        "Authorization": f"Bearer {API_KEY}"
    }
    
    try:
        # On récupère l'image depuis l'API (stream=True est important pour la mémoire)
        resp = requests.get(api_url, stream=True, headers=HEADERS)
        
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