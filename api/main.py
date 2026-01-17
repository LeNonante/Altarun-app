from flask import Flask, request, jsonify, send_file
import io
import os
from database.extensions import db
from database.models import User, Club, Team  # Importer les modèles pour qu'ils soient enregistrés
from werkzeug.security import generate_password_hash, check_password_hash
import random

basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'instance', 'Altarun-api.db') # Le fichier sera créé dansu n dossier instance/
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False # Pour économiser de la mémoire

db.init_app(app)

# Création des tables
with app.app_context():
    # S'assure que le dossier instance existe
    if not os.path.exists(os.path.join(basedir, 'instance')):
        os.makedirs(os.path.join(basedir, 'instance'))
    db.create_all()

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
        'email': user.email
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

@app.route('/auth', methods=['POST'])
def authenticate():
    data = request.get_json()
    user = User.query.filter_by(username=data['username']).first()
    if user and check_password_hash(user.password_hash, data['password']):
        return {'message': 'Authentication successful'}, 200
    return {'message': 'Invalid credentials'}, 401

# --- ROUTES CLUBS ---

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
        'id': c.id, 'name': c.name, 'admin': c.admin.username, 'members_count': c.members.count(), 'code': c.code
    } for c in clubs])

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
    return {'message': f'{user.username} a rejoint {club.name}'}

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