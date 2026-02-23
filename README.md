# Good Boy! 🐕

Application de téléchargement automatique de pièces jointes depuis Démarches Simplifiées avec renommage intelligent.

## 🎯 Fonctionnalités

- Téléchargement par lot de pièces jointes depuis l'API Démarches Simplifiées
- Renommage intelligent basé sur les champs du formulaire
- Support du proxy RIE (Réseau Interministériel de l'État)
- Interface DSFR (Système de Design du Gouvernement Français)
- Gestion des blocs répétables et champs complexes
- Filtrage par dates de dépôt

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
pyinstaller GoodBoy.spec
```

L'exécutable sera dans `dist/Good_Boy/Good_Boy.exe`

## ⚙️ Configuration

### Proxy RIE

- Cochez "Utiliser le proxy RIE" si vous êtes sur le réseau Agriculture
- Décochez si vous utilisez Mercure VPN (routage direct)

### Token API

Obtenez votre token sur https://www.demarches-simplifiees.fr/profil

## 🏛️ Conformité

- Interface conforme DSFR 1.12
- Compatible réseau RIE Agriculture (DRaaf) et RIE DDT
- Détection automatique de proxy PAC

## 📝 License

Usage interne administration française

## 🤝 Contribution

Application développée pour les DRAAF/DDT
- DRAAF Occitanie 2026
