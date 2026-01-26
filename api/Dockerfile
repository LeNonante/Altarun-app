# 1. Python déjà installé
FROM python:3.10-slim

# 2. On crée un dossier de travail dans le conteneur (comme un "cd /app")
WORKDIR /app

# 3. On copie le fichier des dépendances de votre PC vers le conteneur
COPY requirements.txt .

# 4. On installe les librairies nécessaires DANS le conteneur
RUN pip install -r requirements.txt

#CAR API DERRIERE TUNNEL SSL :
# Baisse le niveau de sécurité SSL pour accepter les certificats des tunnels/dev
RUN sed -i 's/SECLEVEL=2/SECLEVEL=1/g' /etc/ssl/openssl.cnf

# 5. On copie tout le reste de votre code (le script python) dans le conteneur
COPY . .

# 6. Exposition du port 5000
EXPOSE 5000

# 7. La commande finale : ce que le conteneur fait quand il démarre
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "main:app"]