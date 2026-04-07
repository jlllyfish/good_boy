# Good Boy! 🐕

Application de téléchargement automatique de pièces jointes depuis Démarches Simplifiées avec renommage intelligent.

## 🎯 Fonctionnalités

- Téléchargement par lot de pièces jointes depuis l'API Démarches Simplifiées
- Renommage intelligent basé sur les champs du formulaire
- Support du proxy RIE (Réseau Interministériel de l'État)
- Interface DSFR (Système de Design du Gouvernement Français)
- Gestion des blocs répétables et champs complexes
- Filtrage par dates de dépôt
- Téléchargement parallèle (6 fichiers simultanés)

## 🚀 Installation

### Prérequis

- Python 3.9+
- Token API Démarches Simplifiées

### Installation des dépendances

```bash
pip install -r requirements.txt
```

## 💻 Utilisation

### Mode développement

```bash
python app.py
```

L'application s'ouvre automatiquement dans votre navigateur sur http://127.0.0.1:5000

### Build exécutable Windows

```bash
pyinstaller goodboy.spec --clean
```

L'exécutable sera dans `dist/Good_Boy/Good_Boy.exe`

Après le build, copier `config.json` dans le dossier `dist/Good_Boy/` :

```
dist/
  Good_Boy/
    Good_Boy.exe
    config.json   ← à copier ici
    _internal/
```

C'est ce dossier `Good_Boy/` entier qui est distribué aux utilisateurs.

## ⚙️ Configuration

### Fichier config.json

Le fichier `config.json` doit être placé dans le même dossier que `Good_Boy.exe`. Il permet de configurer les URLs de proxy sans recompiler l'exécutable.

```json
{
  "_commentaire": "Configuration Good Boy ! — à placer dans le même dossier que l'exe",

  "ds_api_url": "https://demarche.numerique.gouv.fr/api/v2/graphql",

  "pac_urls": [
    "http://conf.proxy.national.agri/?sf",
    "http://configate.interieur.rie.gouv.fr:8888/config-ATE-DDT.pl"
  ],

  "pac_test_url": "https://www.demarches-simplifiees.fr"
}
```

**Paramètres :**

- `ds_api_url` : URL de l'API Démarches Simplifiées (ne pas modifier sauf changement officiel)
- `pac_urls` : liste des URLs de fichiers PAC à tester pour la configuration proxy, dans l'ordre de priorité. L'application teste chaque URL jusqu'à trouver un proxy fonctionnel.
- `pac_test_url` : URL utilisée pour vérifier la connectivité via le proxy

Si `config.json` est absent, le proxy est désactivé et l'application fonctionne en connexion directe.

### Proxy RIE

- Cochez "Utiliser le proxy" dans l'interface si vous êtes sur le réseau RIE Agriculture ou DDT
- Décochez si vous utilisez Mercure VPN (routage direct)
- Les URLs de proxy sont lues depuis `config.json` — modifier ce fichier pour ajouter ou changer un proxy sans recompiler l'exe

### Token API

Obtenez votre token sur https://www.demarches-simplifiees.fr/profil

## 🔒 Sécurité

- Le fichier `config.json` est exclu du dépôt Git (`.gitignore`) — les URLs de proxy ne sont jamais publiées
- Les tokens API ne sont jamais stockés par l'application
- La vérification SSL est active par défaut ; en cas d'inspection SSL par un antivirus/EDR réseau, l'application bascule automatiquement en mode non-vérifié pour ce poste

## 🏛️ Conformité

- Interface conforme DSFR 1.12
- Compatible réseau RIE Agriculture et DDT
- Détection automatique de proxy PAC

## 📝 License

Usage interne administration française

## 🤝 Contribution

Application développée pour les DRAAF/DDT  
DRAAF Occitanie 2026
