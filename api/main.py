from flask import Flask, request
import os
from database.extensions import db
from database.models import User, Club, Team  # Importer les modèles pour qu'ils soient enregistrés
from werkzeug.security import generate_password_hash, check_password_hash

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
        new_user = User(
            username=data['username'],
            password_hash=generate_password_hash(data['password_hash'])
        )
        db.session.add(new_user)
        db.session.commit()
        return {'message': 'User created successfully'}, 201
    
    users = User.query.all()
    return {'users': [user.username for user in users]}

@app.route('/auth', methods=['POST'])
def authenticate():
    data = request.get_json()
    user = User.query.filter_by(username=data['username']).first()
    if user and check_password_hash(user.password_hash, data['password_hash']):
        return {'message': 'Authentication successful'}, 200
    return {'message': 'Invalid credentials'}, 401

@app.route('/clubs', methods=['GET', 'POST'])
def manage_clubs():
    if request.method == 'POST':
        data = request.get_json()
        new_club = Club(
            name=data['name'],
            admin_id=data['admin_id']
        )
        db.session.add(new_club)
        db.session.commit()
        return {'message': 'Club created successfully'}, 201
    
    clubs = Club.query.all()
    return {'clubs': [club.name for club in clubs]}

@app.route('/teams', methods=['GET', 'POST'])
def manage_teams():
    if request.method == 'POST':
        data = request.get_json()
        new_team = Team(
            name=data['name'],
            club_id=data['club_id']
        )
        db.session.add(new_team)
        db.session.commit()
        return {'message': 'Team created successfully'}, 201
    
    teams = Team.query.all()
    return {'teams': [team.name for team in teams]}


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)