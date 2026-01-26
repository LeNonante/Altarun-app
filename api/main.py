from flask import Flask, request, jsonify, send_file, abort
import io
import os
from database.extensions import db
from database.models import User, Club, Team  # Importer les modèles pour qu'ils soient enregistrés
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
import random
import pyotp
from flask_mail import Mail, Message
import secrets
from datetime import datetime, timedelta

load_dotenv()

basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)
API_SECRET_KEY = os.environ.get("API_TOKEN")

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'instance', 'Altarun-api.db') # Le fichier sera créé dansu n dossier instance/
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False # Pour économiser de la mémoire

# Configuration de Flask-Mail
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USERNAME'] = os.getenv('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.getenv('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.getenv('MAIL_USERNAME')
app.config['FRONTEND_URL'] = os.getenv('APP_URL')

mail = Mail(app)

db.init_app(app)

# Création des tables
with app.app_context():
    # S'assure que le dossier instance existe
    if not os.path.exists(os.path.join(basedir, 'instance')):
        os.makedirs(os.path.join(basedir, 'instance'))
    db.create_all()


@app.before_request # Vérification de la clé API avant chaque requête
def check_api_key():        
    # On récupère la clé dans les headers
    auth_header = request.headers.get('Authorization')
    
    if auth_header and auth_header.startswith('Bearer '):
        # On coupe la chaîne pour garder juste le token après l'espace
        token = auth_header.split(" ")[1]
        
        # 3. Vérifier si le token correspond à notre secret
        if token == API_SECRET_KEY:
            return  # C'est validé, on laisse passer
            
    # Si on arrive ici, c'est que l'auth a échoué
    abort(401, description="Accès refusé : Token Bearer invalide ou manquant")


@app.route('/users', methods=['GET', 'POST'])
def get_users():
    if request.method == 'POST':
        data = request.get_json()
        photo=data.get('photo')
        if not photo:
            avatar_dir = os.path.join(basedir, 'static', 'avatars')
            if os.path.exists(avatar_dir):
                avatars = os.listdir(avatar_dir)
                if avatars:
                    photo = os.path.join('avatars', random.choice(avatars))
            if photo:
                with open(os.path.join(basedir, 'static', photo), 'rb') as f:
                    photo = f.read()

        new_user = User(
            username=data['username'],
            password_hash=generate_password_hash(data['password']),
            photo=photo,
            email=data['email']
        )
        db.session.add(new_user)
        db.session.commit()
        return {'message': 'User created successfully'}, 201
    
    users = User.query.all()
    return {'users': [user.username for user in users]}

@app.route('/users/<username>', methods=['GET', 'PUT', 'DELETE'])
def get_user(username):
    user = User.query.filter_by(username=username).first()
    if not user:
        return {'error': 'User not found'}, 404
    if request.method == 'DELETE':
        db.session.delete(user)
        db.session.commit()
        return {'message': 'User deleted successfully'}, 200
    if request.method == 'PUT':
        data = request.get_json()
        user.first_name = data.get('first_name', user.first_name)
        user.last_name = data.get('last_name', user.last_name)
        user.email = data.get('email', user.email)
        try :
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            return {'error': 'Email already in use'}, 400
        return {'message': 'User updated successfully'}, 200
    return {
        'id': user.id,
        'username': user.username,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'email': user.email,
        'is_strava_connected': user.is_strava_connected,
        'is_2fa_enabled': user.is_2fa_enabled,
        'clubs': [{
        'id': c.id, 'name': c.name, 'admin': c.admin.username, 'members_count': c.members.count(), 'teams_count': len(c.teams), 'code': c.code, "is_private": c.is_private
        } for c in user.clubs]
    }

@app.route('/users/<username>/photo', methods=['GET'])
def get_user_photo(username):
    user = User.query.filter_by(username=username).first()
    
    if not user or not user.photo:
        return jsonify({'error': 'Photo not found'}), 404

    # Convertir le binaire en fichier lisible par Flask
    return send_file(
        io.BytesIO(user.photo),
        mimetype='image/png', # Ou image/jpeg selon ce que vous stockez
        as_attachment=False,
        download_name=f'{username}.png'
    )
    
@app.route('/users/<username>/photo', methods=['POST'])
def upload_user_photo(username):
    user = User.query.filter_by(username=username).first()
    if not user:
        return {'error': 'User not found'}, 404
    
    if 'photo' not in request.files:
        return {'error': 'No file part'}, 400
        
    file = request.files['photo']
    
    if file.filename == '':
        return {'error': 'No selected file'}, 400

    # On lit le fichier binaire et on l'enregistre
    user.photo = file.read()
    db.session.commit()
    
    return {'message': 'Photo updated successfully'}, 200

@app.route('/users/<username>/password', methods=['PUT'])
def update_user_password(username):
    user = User.query.filter_by(username=username).first()
    
    if not user:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json()
    new_password = data.get('new_password')
    if not new_password:
        return jsonify({'error': 'New password is required'}), 400

    user.password_hash = generate_password_hash(new_password)
    db.session.commit()
    return {'message': 'Password updated successfully'}, 200

@app.route('/etl/stravausers', methods=['GET', 'PUT'])
def list_strava_users():
    if request.method == 'PUT':
        data = request.get_json()
        print(data)
        username = data.get('username')
        user = User.query.filter_by(username=username).first()
        if not user:
            return jsonify({'error': 'User not found'}), 404
        user.is_strava_connected = data.get('is_strava_connected', user.is_strava_connected)
        user.strava_id = data.get('strava_id', user.strava_id)
        user.strava_access_token = data.get('access_token', user.strava_access_token)
        user.strava_expires_at = data.get('expires_at', user.strava_expires_at)
        user.strava_refresh_token = data.get('refresh_token', user.strava_refresh_token)
        db.session.commit()
        return {'message': 'Strava data updated successfully'}, 200
    
    users = User.query.filter_by(is_strava_connected=True).all()
    return jsonify([{
        'username': u.username,
        'strava_id': u.strava_id,
        'access_token': u.strava_access_token,
        'expires_at': u.strava_expires_at,
        'refresh_token': u.strava_refresh_token
    } for u in users])
    

@app.route('/users/<username>/strava', methods=['GET', 'PUT', 'DELETE'])
def update_user_strava(username):
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if request.method == 'GET':
        return {
            'is_strava_connected': user.is_strava_connected,
            'strava_id': user.strava_id,
            'strava_access_token': user.strava_access_token,
            'strava_expires_at': user.strava_expires_at,
            'strava_refresh_token': user.strava_refresh_token
        }
    if request.method == 'DELETE':
        user.is_strava_connected = False
        user.strava_access_token = None
        user.strava_expires_at = None
        user.strava_refresh_token = None
        user.strava_id = None
        db.session.commit()
        return {'message': 'Strava disconnected successfully'}, 200
    if request.method == 'PUT':
        data = request.get_json()
        user.is_strava_connected = True
        user.strava_id = data.get('strava_id', user.strava_id)
        user.strava_access_token = data.get('access_token', user.strava_access_token)
        user.strava_expires_at = data.get('expires_at', user.strava_expires_at)
        user.strava_refresh_token = data.get('refresh_token', user.strava_refresh_token)
        db.session.commit()
        return {'message': 'Strava connection updated successfully'}, 200

@app.route('/auth', methods=['POST'])
def authenticate():
    data = request.get_json()
    user = User.query.filter_by(username=data['username']).first()
    if user and check_password_hash(user.password_hash, data['password']):
        return {'message': 'Authentication successful'}, 200
    return {'message': 'Invalid credentials'}, 401

@app.route('/auth/request-reset', methods=['POST'])
def request_reset_password():
    data = request.get_json()
    email = data.get('email')
    user = User.query.filter_by(email=email).first()
    
    if user:
        # Générer un token sécurisé
        token = secrets.token_urlsafe(32)
        user.reset_token = token
        # Le lien expire dans 1 heure
        user.reset_token_expiration = datetime.utcnow() + timedelta(hours=1)
        db.session.commit()
        
        # Envoyer l'email
        reset_link = f"{app.config['FRONTEND_URL']}/reset-password/{token}"
        msg = Message("Réinitialisation de votre mot de passe Altarun",
                      recipients=[email], )
        msg.body = f"Bonjour {user.username},\n\nPour réinitialiser votre mot de passe, cliquez sur le lien suivant :\n{reset_link}\n\nCe lien expire dans 1 heure.\n\nSi vous n'avez pas demandé ceci, ignorez cet e-mail."
        
        try:
            mail.send(msg)
            print(f"Sent password reset email to {email}")
        except Exception as e:
            print(f"Failed to send email: {e}")
            return {'error': str(e)}, 500

    # On retourne toujours un succès pour ne pas révéler si l'email existe ou non (sécurité)
    return {'message': 'Si cet email existe, un lien a été envoyé.'}, 200

@app.route('/auth/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    token = data.get('token')
    new_password = data.get('new_password')
    
    user = User.query.filter_by(reset_token=token).first()
    
    if not user or user.reset_token_expiration < datetime.utcnow():
        return {'error': 'Jeton invalide ou expiré'}, 400
        
    # Mise à jour du mot de passe
    user.password_hash = generate_password_hash(new_password)
    user.reset_token = None
    user.reset_token_expiration = None
    db.session.commit()
    
    return {'message': 'Mot de passe mis à jour avec succès'}, 200

@app.route('/users/<username>/2fa/status', methods=['GET'])
def check_2fa(username):
    user = User.query.filter_by(username=username).first()
    if user:
        return {'is_2fa_enabled': user.is_2fa_enabled}, 200
    return {'error': 'User not found'}, 404

@app.route('/users/<username>/2fa/enable', methods=['POST'])
def activate_2fa(username):
    secret = pyotp.random_base32()
    user = User.query.filter_by(username=username).first()
    if user:
        user.is_2fa_enabled = True
        user.two_fa_secret = secret
        db.session.commit()
        return {'message': '2FA activated', 'secret': secret}, 200
    return {'error': 'User not found'}, 404

@app.route('/users/<username>/2fa/disable', methods=['POST'])
def deactivate_2fa(username):
    user = User.query.filter_by(username=username).first()
    if user:
        user.is_2fa_enabled = False
        user.two_fa_secret = None
        db.session.commit()
        return {'message': '2FA deactivated'}, 200
    return {'error': 'User not found'}, 404

@app.route('/users/<username>/2fa/verify', methods=['POST'])
def check_2fa_code(username):
    code = request.json.get('token')
    user = User.query.filter_by(username=username).first()
    if user and user.is_2fa_enabled:
        totp = pyotp.TOTP(user.two_fa_secret)
        if totp.verify(code):
            return {'valid': True}, 200
        else:
            return {'valid': False}, 200
    return {'error': 'User not found or 2FA not enabled'}, 404

@app.route('/check_email', methods=['GET'])
def check_email():
    email = request.args.get('email')
    user = User.query.filter_by(email=email).first()
    if user:
        return {'available': False}, 200
    return {'available': True}, 200

# --- ROUTES CLUBS ---

@app.route('/clubs/auth', methods=['POST'])
def club_authenticate():
    data = request.get_json()
    club = Club.query.filter_by(id=data['id']).first()
    if club.is_private==False or (club.is_private==True and check_password_hash(club.password_hash, data['password'])):
        return {'message': 'Authentication successful'}, 200
    return {'message': 'Invalid credentials'}, 401

@app.route('/clubs', methods=['GET', 'POST'])
def handle_clubs():
    if request.method == 'POST':
        data = request.get_json()
        user_id = data.get('user_id')
        
        user = User.query.get(user_id)
        if not user: return {'error': 'User not found'}, 404
        
        code=random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', k=6) # Génération d'un code unique 
        while Club.query.filter_by(code=''.join(code)).first() is not None: # Vérification de l'unicité
            code=random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', k=6)
        
        new_club = Club(name=data['name'], admin_id=user_id, code=''.join(code))
        # L'admin rejoint automatiquement son club
        new_club.members.append(user)
        
        db.session.add(new_club)
        db.session.commit()
        return {'message': f'Club {new_club.name} créé'}, 201

    # GET : Récupérer tous les clubs
    clubs = Club.query.all()
    return jsonify([{
        'id': c.id, 'name': c.name, 'admin': c.admin.username, 'members_count': c.members.count(), 'teams_count': len(c.teams), 'code': c.code, 'is_private': c.is_private
    } for c in clubs])

@app.route('/clubs/<int:club_id>', methods=['GET'])
def get_club(club_id):
    club = Club.query.get_or_404(club_id)
    return {
        'id': club.id,
        'name': club.name,
        'admin': club.admin.username,
        'members_count': club.members.count(),
        'teams_count': len(club.teams),
        'code': club.code,
        'is_private': club.is_private
    }
    
    
# --- ROUTE JOIN (Rejoindre un club) ---

@app.route('/clubs/<int:club_id>/join', methods=['POST'])
def join_club(club_id):
    data = request.get_json()
    user_id = data.get('user_id') # Qui veut rejoindre ?
    
    club = Club.query.get_or_404(club_id)
    user = User.query.get(user_id)
    
    if not user: return {'error': 'User not found'}, 404
    if club in user.clubs: return {'error': 'Déjà membre'}, 400

    user.clubs.append(club)
    db.session.commit()
    return {'message': f'{user.username} a rejoint {club.name}'}, 200

# --- ROUTES TEAMS ---

@app.route('/clubs/<int:club_id>/teams', methods=['GET', 'POST'])
def handle_teams(club_id):
    club = Club.query.get_or_404(club_id)

    if request.method == 'POST':
        data = request.get_json()
        # Seul l'admin du club (vérifié via user_id du JSON) peut créer
        if club.admin_id != data.get('user_id'):
            return {'error': 'Action réservée à l\'admin'}, 403
        
        new_team = Team(name=data['name'], club_id=club_id)
        db.session.add(new_team)
        db.session.commit()
        return {'message': 'Team créée'}, 201

    # GET : Récupérer les teams du club
    return jsonify([{'id': t.id, 'name': t.name} for t in club.teams])

# --- ROUTE MEMBRES DU CLUB AVEC LEUR TEAM ---

@app.route('/clubs/<int:club_id>/members', methods=['GET'])
def get_club_members(club_id):
    club = Club.query.get_or_404(club_id)
    results = []

    for member in club.members:
        # On cherche la team du membre dans CE club précis
        user_team = next((t.name for t in member.teams if t.club_id == club_id), "Aucune")
        results.append({
            'username': member.username,
            'team': user_team
        })
    return jsonify(results)

@app.route('/clubs/<int:club_id>/teams/<int:team_id>/add-member', methods=['POST'])
def add_member_to_team(club_id, team_id):
    data = request.get_json()
    user_id = data.get('user_id')
    admin_id = data.get('admin_id') # vérifier que c'est l'admin qui fait l'action

    # Récupération des objets ou erreur 404 si l'ID n'existe pas
    user = User.query.get_or_404(user_id)
    club = Club.query.get_or_404(club_id)
    team = Team.query.get_or_404(team_id)

    # 1. VERIFICATION : Est-ce que l'utilisateur est membre du club ?
    # On utilise "club.members" car c'est le backref défini dans ton modèle
    if user not in club.members:
        return {
            'error': 'Forbidden',
            'message': f'L utilisateur {user.username} doit d abord rejoindre le club {club.name} avant d integrer une equipe.'
        }, 403

    # 2. VERIFICATION : Est-ce qu'il est déjà dans une autre équipe de CE club ?
    already_in_a_team = any(t.club_id == club_id for t in user.teams)
    if already_in_a_team:
        return {
            'error': 'Conflict',
            'message': 'Cet utilisateur est deja affecte a une autre equipe dans ce club.'
        }, 409

    # 3. AJOUT A L'EQUIPE
    if user not in team.members:
        team.members.append(user)
        db.session.commit()
        return {'message': f'{user.username} a ete ajoute avec succes a l equipe {team.name}'}, 200
    
    return {'message': 'L utilisateur est deja dans cette equipe.'}, 200



if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)