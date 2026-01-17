from flask import Flask, request, jsonify
import os
from database.extensions import db
from database.models import User
from werkzeug.security import check_password_hash, generate_password_hash

basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)

# Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'instance', 'Altarun-api.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = 'change-ce-secret-en-prod' # Clé pour signer les tokens

db.init_app(app)

with app.app_context():
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


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(username=data.get('username')).first()

    # On vérifie manuellement ici
    if user and check_password_hash(user.password_hash, data.get('password')):
        return {'message': 'Login successful'}, 200
    
    return {'error': 'Invalid credentials'}, 401


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)