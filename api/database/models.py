from .extensions import db
from datetime import datetime

# Table pour les utilisateurs
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    is_2fa_enabled = db.Column(db.Boolean, default=False)
    two_fa_secret = db.Column(db.String(100))
    photo = db.Column(db.LargeBinary)
    strava_client_id = db.Column(db.String(100))
    strava_client_secret = db.Column(db.String(100))
    strava_refresh_token = db.Column(db.String(200))
    