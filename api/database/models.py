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
    
    clubs = db.relationship(
        'Club',
        secondary='club_members',
        back_populates='members'
    )
    
    teams = db.relationship(
        'Team',
        secondary='team_members',
        back_populates='members'
    )
    
class Club(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    admin_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    admin = db.relationship('User', backref='admin_of_clubs')

    members = db.relationship(
        'User',
        secondary='club_members',
        back_populates='clubs'
    )
    
class Team(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    club_id = db.Column(db.Integer, db.ForeignKey('club.id'), nullable=False)

    club = db.relationship('Club', backref='teams')

    members = db.relationship(
        'User',
        secondary='team_members',
        back_populates='teams'
    )

class TeamMember(db.Model):
    __tablename__ = "team_members"
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), primary_key=True)
    team_id = db.Column(db.Integer, db.ForeignKey('team.id'), primary_key=True)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)


class ClubMember(db.Model):
    __tablename__ = "club_members"
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), primary_key=True)
    club_id = db.Column(db.Integer, db.ForeignKey('club.id'), primary_key=True)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    role = db.Column(db.String(50), default="member")
