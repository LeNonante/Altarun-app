from .extensions import db
from datetime import datetime

# Table pour lier les membres aux clubs
club_membership = db.Table('club_membership',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id'), primary_key=True),
    db.Column('club_id', db.Integer, db.ForeignKey('club.id'), primary_key=True),
    db.Column('joined_at', db.DateTime, default=datetime.utcnow)
)

# Table pour lier les membres aux équipes
team_membership = db.Table('team_membership',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id'), primary_key=True),
    db.Column('team_id', db.Integer, db.ForeignKey('team.id'), primary_key=True),
    db.Column('joined_at', db.DateTime, default=datetime.utcnow)
)

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
    
    # Relations d'administration
    managed_clubs = db.relationship('Club', backref='admin', lazy=True)

    # Relations d'adhésion (Many-to-Many)
    clubs = db.relationship('Club', secondary=club_membership, backref=db.backref('members', lazy='dynamic'))
    teams = db.relationship('Team', secondary=team_membership, backref=db.backref('members', lazy='dynamic'))
    
class Club(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # L'admin (créateur) du club
    admin_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    # Relation One-to-Many vers les équipes
    teams = db.relationship('Team', backref='club', lazy=True)


class Team(db.Model):
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False)
    
    # L'ID du club parent
    club_id = db.Column(db.Integer, db.ForeignKey('club.id'), nullable=False)
    
    # Contrainte d'unicité : un club ne peut pas avoir deux équipes avec le même nom
    __table_args__ = (db.UniqueConstraint('name', 'club_id', name='unique_team_name_per_club'),)

