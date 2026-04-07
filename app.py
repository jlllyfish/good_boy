import json
import logging
import os
import re
import sys
import webbrowser
from pathlib import Path
from threading import Timer

import requests
import urllib3
from flask import Flask, jsonify, render_template, request

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Import pour le proxy RIE (optionnel)
try:
    from pypac import PACSession, get_pac
    from pypac.resolver import ProxyResolver
    PYPAC_AVAILABLE = True
except ImportError:
    PYPAC_AVAILABLE = False
    print("⚠️ pypac non installé - Le proxy RIE ne sera pas disponible")

# Désactiver le cache de tldextract pour PyInstaller
os.environ['TLDEXTRACT_CACHE'] = 'no'

# --- Chargement de la configuration externe ---
def get_app_dir():
    """Retourne le dossier contenant l'exe (PyInstaller) ou le script (dev)"""
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    return Path(__file__).parent

def load_config():
    config_path = get_app_dir() / "config.json"
    if config_path.exists():
        try:
            with open(config_path, encoding="utf-8") as f:
                data = json.load(f)
            print(f"✅ config.json chargé depuis {config_path}")
            return data
        except Exception as e:
            print(f"⚠️ Erreur lecture config.json : {e}")
    else:
        print(f"ℹ️ config.json absent — proxy désactivé par défaut")
    return {}

CONFIG = load_config()

# Variables globales de cache
_cached_session = None
_cached_use_proxy = None
_cached_token = None
_ssl_verify = True

app = Flask(__name__, 
            static_folder='static',
            template_folder='templates')

DS_API_URL = "https://demarche.numerique.gouv.fr/api/v2/graphql"
PAC_URL = CONFIG.get("pac_urls", [""])[0]
DOWNLOAD_FOLDER = Path("./downloads")

def get_session(token=None, use_proxy=False):
    """Crée une session HTTP avec ou sans proxy RIE"""
    global _cached_session, _cached_use_proxy, _cached_token
    
    # Invalider le cache si le token a changé
    if token and _cached_token != token:
        print(f"🔄 Token changé, réinitialisation de la session")
        _cached_session = None
        _cached_token = token
    
    # Réutiliser la session en cache si les paramètres sont identiques
    if _cached_session and _cached_use_proxy == use_proxy:
        if token and 'Authorization' not in _cached_session.headers:
            _cached_session.headers.update({
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}"
            })
        return _cached_session
    
    print(f"🔍 DEBUG get_session: use_proxy={use_proxy}, PYPAC_AVAILABLE={PYPAC_AVAILABLE}")
    
    if use_proxy and PYPAC_AVAILABLE:
        # Liste des URLs PAC à tester
        PAC_URLS = CONFIG.get("pac_urls", [])
        
        session = None
        for pac_url in PAC_URLS:
            try:
                print(f"🔍 Test proxy PAC: {pac_url}")
                
                # Récupérer le fichier PAC
                pac = get_pac(url=pac_url)
                resolver = ProxyResolver(pac=pac)
                
                # Vérifier les proxies configurés
                proxies = resolver.get_proxy_for_requests(CONFIG.get("pac_test_url", "https://demarche.numerique.gouv.fr"))
                print(f"  📋 Proxies détectés: {proxies}")
                
                # Si pas de proxy configuré (DIRECT), on skip
                if not proxies or proxies.get('https') == 'DIRECT' or not proxies.get('https'):
                    print(f"  ⚠️ PAC indique DIRECT (pas de proxy) - Skip")
                    continue
                
                # Créer la session avec ce resolver
                test_session = PACSession(proxy_resolver=resolver)
                
                # TEST RÉEL de connectivité
                print(f"  🌐 Test de connexion via proxy...")
                test_response = test_session.get(CONFIG.get("pac_test_url", "https://demarche.numerique.gouv.fr"), timeout=5)
                test_response.raise_for_status()
                
                print(f"✅ Proxy {pac_url} fonctionnel ! (HTTP {test_response.status_code})")
                session = test_session
                break
                
            except Exception as e:
                print(f"❌ Proxy {pac_url} non fonctionnel: {str(e)}")
                continue
        
        # Si aucun proxy ne fonctionne, connexion directe
        if session is None:
            print("⚠️ Aucun proxy PAC fonctionnel - Connexion directe")
            session = requests.Session()
        
        # Mettre en cache
        _cached_session = session
        _cached_use_proxy = use_proxy
        
    else:
        print("ℹ️ Utilisation connexion directe (pas de proxy)")
        session = requests.Session()
        _cached_session = session
        _cached_use_proxy = use_proxy
    
    if token:
        _cached_session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        })
    
    return _cached_session

def is_on_rie():
    """Détecte si l'utilisateur est sur le RIE en testant l'accès au proxy PAC"""
    try:
        response = requests.get(PAC_URL, timeout=2)
        return response.status_code == 200
    except:
        return False

def graphql_query(query, variables=None, token=None, use_proxy=False):
    """Exécute une requête GraphQL sur DS avec le token fourni"""
    if not token:
        raise ValueError("Token API manquant")
    
    print(f"[DEBUG] === DEBUT graphql_query ===")
    print(f"[DEBUG] use_proxy: {use_proxy}")
    
    session = get_session(token, use_proxy)
    
    try:
        print(f"[DEBUG] Tentative POST vers {DS_API_URL}")
        print(f"[DEBUG] Proxies configurés: {session.proxies if hasattr(session, 'proxies') else 'Session PACSession'}")
        
        response = session.post(
            DS_API_URL, 
            json={"query": query, "variables": variables},
            timeout=30
        )
        
        print(f"[DEBUG] Status code reçu: {response.status_code}")
        response.raise_for_status()
        return response.json()
        
    except requests.exceptions.ProxyError as e:
        print(f"[ERROR] Erreur proxy: {e}")
        raise Exception(f"Erreur proxy: {str(e)}")
    except requests.exceptions.Timeout:
        print(f"[ERROR] Timeout après 30s")
        raise Exception("Délai d'attente dépassé lors de la connexion à l'API DS")
    except requests.exceptions.ConnectionError as e:
        print(f"[ERROR] ConnectionError: {e}")
        raise Exception("Impossible de se connecter à l'API DS")
    except requests.exceptions.HTTPError as e:
        print(f"[ERROR] HTTPError {response.status_code}: {e}")
        raise Exception(f"Erreur HTTP {response.status_code}: {str(e)}")
    except ValueError as e:
        print(f"[ERROR] ValueError (JSON invalide): {e}")
        raise Exception(f"Réponse invalide de l'API: {str(e)}")
    finally:
        session.close()

def extract_demandeur_info(demandeur):
    if not demandeur:
        return {}
    
    typename = demandeur['__typename']
    info = {'type': typename}
    
    if typename == 'PersonnePhysique':
        info.update({
            'civilite': demandeur.get('civilite'),
            'nom': demandeur.get('nom'),
            'prenom': demandeur.get('prenom'),
            'email': demandeur.get('email'),
        })
    elif typename == 'PersonneMorale':
        info.update({'siret': demandeur.get('siret'), 'naf': demandeur.get('naf')})
        if demandeur.get('entreprise'):
            ent = demandeur['entreprise']
            info.update({
                'siren': ent.get('siren'),
                'raisonSociale': ent.get('raisonSociale'),
                'formeJuridique': ent.get('formeJuridique'),
                'nomCommercial': ent.get('nomCommercial'),
            })
        if demandeur.get('association'):
            asso = demandeur['association']
            info.update({'rna': asso.get('rna'), 'titre': asso.get('titre')})
        if demandeur.get('address'):
            addr = demandeur['address']
            info.update({'ville': addr.get('cityName'), 'codePostal': addr.get('postalCode')})
    elif typename == 'PersonneMoraleIncomplete':
        info['siret'] = demandeur.get('siret')
    
    return info

def extract_champ_value(champ):
    typename = champ['__typename']
    
    # Champs avec stringValue (TextChamp couvre email, phone, iban, etc.)
    if typename == 'TextChamp':
        return champ.get('stringValue')
    
    # Champs numériques
    if typename == 'IntegerNumberChamp':
        return champ.get('integerNumber')
    if typename == 'DecimalNumberChamp':
        return champ.get('decimalNumber')
    
    # Champs dates
    if typename == 'DateChamp':
        return champ.get('date')
    if typename == 'DatetimeChamp':
        return champ.get('datetime')
    
    # Champs booléens
    if typename == 'CheckboxChamp':
        return 'Oui' if champ.get('checked') else 'Non'
    if typename == 'YesNoChamp':
        return champ.get('selected')
    
    # Champs de sélection
    if typename == 'CiviliteChamp':
        return champ.get('civilite')
    if typename == 'DropDownListChamp':
        return champ.get('value')
    if typename == 'MultipleDropDownListChamp':
        return ', '.join(champ.get('values', []))
    if typename == 'LinkedDropDownListChamp':
        primary = champ.get('primaryValue', '')
        secondary = champ.get('secondaryValue', '')
        return f"{primary} - {secondary}" if secondary else primary
    
    # Champs géographiques
    if typename == 'AddressChamp':
        address = champ.get('address')
        return address.get('label') if address else None
    if typename == 'CommuneChamp':
        commune = champ.get('commune')
        return commune.get('name') if commune else None
    if typename == 'DepartementChamp':
        departement = champ.get('departement')
        return departement.get('name') if departement else None
    if typename == 'RegionChamp':
        region = champ.get('region')
        return region.get('name') if region else None
    if typename == 'PaysChamp':
        pays = champ.get('pays')
        return pays.get('name') if pays else None
    if typename == 'EpciChamp':
        epci = champ.get('epci')
        return epci.get('name') if epci else None
    
    # Champs entreprise
    if typename == 'SiretChamp':
        etablissement = champ.get('etablissement')
        if etablissement:
            return etablissement.get('siret')
        return None
    
    # Champs spéciaux
    if typename == 'RNFChamp':
        rnf = champ.get('rnf')
        return rnf.get('title') if rnf else None
    if typename == 'DossierLinkChamp':
        dossier = champ.get('dossier')
        return dossier.get('number') if dossier else None
    if typename == 'EngagementJuridiqueChamp':
        ej = champ.get('engagementJuridique')
        if ej:
            return f"{ej.get('montantEngage')} / {ej.get('montantPaye')}"
        return None
    
    return None

def extract_all_champs_values(champs):
    """
    Extrait toutes les valeurs de champs.
    Pour les répétitions : crée AUSSI des clés plates avec index.
    """
    champs_values = {}
    repetition_rows = []
    
    for champ in champs:
        if champ.get("__typename") == "RepetitionChamp":
            rows = champ.get("rows", [])
            for row_index, row in enumerate(rows):
                row_data = {"__row_index": row_index}
                for sub_champ in row.get("champs", []):
                    label = sub_champ.get("label")
                    value = extract_champ_value(sub_champ)
                    row_data[label] = value
                    
                    # Créer aussi des clés plates pour le renommage
                    # Format: "Label[0]", "Label[1]", etc.
                    champs_values[f"{label}[{row_index}]"] = value
                
                repetition_rows.append(row_data)
        else:
            if champ.get("__typename") != "PieceJustificativeChamp":
                value = extract_champ_value(champ)
                if value:
                    champs_values[champ.get("label")] = value
    
    if repetition_rows:
        champs_values["__repetition_rows"] = repetition_rows
    
    return champs_values

def get_dossiers_with_pj(demarche_number, token, use_proxy=False, date_debut=None, date_fin=None):
    """Récupère les dossiers avec leurs PJ et TOUS les champs"""
    query = """
    query getDossiers($demarcheNumber: Int!, $after: String) {
      demarche(number: $demarcheNumber) {
        dossiers(first: 1000, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            number
            state
            archived
            dateDepot
            attestation {
              filename
              contentType
              checksum
              byteSize: byteSizeBigInt
              url
            }
            datePassageEnConstruction
            datePassageEnInstruction
            dateTraitement
            dateDerniereModification
            usager {
              email
            }
            demandeur {
              __typename
              ... on PersonnePhysique {
                civilite
                nom
                prenom
                email
              }
              ... on PersonneMorale {
                siret
                siegeSocial
                naf
                libelleNaf
                address {
                  label
                  streetAddress
                  postalCode
                  cityName
                  cityCode
                }
                entreprise {
                  siren
                  raisonSociale
                  formeJuridique
                  siretSiegeSocial
                  nomCommercial
                }
                association {
                  rna
                  titre
                  objet
                }
              }
              ... on PersonneMoraleIncomplete {
                siret
              }
            }
            champs {
              id
              label
              __typename
              stringValue
              prefilled
              ... on DateChamp {
                date
              }
              ... on DatetimeChamp {
                datetime
              }
              ... on CheckboxChamp {
                checked: value
              }
              ... on YesNoChamp {
                selected: value
              }
              ... on DecimalNumberChamp {
                decimalNumber: value
              }
              ... on IntegerNumberChamp {
                integerNumber: value
              }
              ... on CiviliteChamp {
                civilite: value
              }
              ... on LinkedDropDownListChamp {
                primaryValue
                secondaryValue
              }
              ... on DropDownListChamp {
                value
              }
              ... on MultipleDropDownListChamp {
                values
              }
              ... on PieceJustificativeChamp {
                files {
                  filename
                  contentType
                  checksum
                  byteSize: byteSizeBigInt
                  url
                }
              }
              ... on AddressChamp {
                address {
                  label
                  streetAddress
                  postalCode
                  cityName
                }
              }
              ... on CommuneChamp {
                commune {
                  name
                  code
                  postalCode
                }
              }
              ... on DepartementChamp {
                departement {
                  name
                  code
                }
              }
              ... on RegionChamp {
                region {
                  name
                  code
                }
              }
              ... on PaysChamp {
                pays {
                  name
                  code
                }
              }
              ... on EpciChamp {
                epci {
                  name
                  code
                }
              }
              ... on SiretChamp {
                etablissement {
                  siret
                  entreprise {
                    siren
                    raisonSociale
                  }
                }
              }
              ... on RNFChamp {
                rnf {
                  id
                  title
                }
              }
              ... on TextChamp {
                stringValue
              }
              ... on DossierLinkChamp {
                dossier {
                  number
                }
              }
              ... on RepetitionChamp {
                rows {
                  id
                  champs {
                    id
                    label
                    __typename
                    stringValue
                    ... on DateChamp {
                      date
                    }
                    ... on DatetimeChamp {
                      datetime
                    }
                    ... on CheckboxChamp {
                      checked: value
                    }
                    ... on YesNoChamp {
                      selected: value
                    }
                    ... on DecimalNumberChamp {
                      decimalNumber: value
                    }
                    ... on IntegerNumberChamp {
                      integerNumber: value
                    }
                    ... on CiviliteChamp {
                      civilite: value
                    }
                    ... on LinkedDropDownListChamp {
                      primaryValue
                      secondaryValue
                    }
                    ... on DropDownListChamp {
                      value
                    }
                    ... on MultipleDropDownListChamp {
                      values
                    }
                    ... on PieceJustificativeChamp {
                      files {
                        filename
                        contentType
                        checksum
                        byteSize: byteSizeBigInt
                        url
                      }
                    }
                    ... on AddressChamp {
                      address {
                        label
                        streetAddress
                        postalCode
                        cityName
                      }
                    }
                    ... on CommuneChamp {
                      commune {
                        name
                        code
                        postalCode
                      }
                    }
                    ... on DepartementChamp {
                      departement {
                        name
                        code
                      }
                    }
                    ... on RegionChamp {
                      region {
                        name
                        code
                      }
                    }
                    ... on PaysChamp {
                      pays {
                        name
                        code
                      }
                    }
                  }
                }
              }
              ... on EngagementJuridiqueChamp {
                engagementJuridique {
                  montantEngage
                  montantPaye
                }
              }
              ... on CarteChamp {
                geoAreas {
                  id
                  description
                }
              }
            }
          }
        }
      }
    }
    """
    
    all_dossiers = []
    has_next = True
    cursor = None
    
    while has_next:
        # Construire les variables avec filtres de dates optionnels
        variables = {
            "demarcheNumber": demarche_number, 
            "after": cursor
        }
        result = graphql_query(query, variables, token, use_proxy)
        
        if result is None:
            raise Exception("Aucune réponse de l'API DS")
        
        if 'errors' in result:
            raise Exception(result['errors'][0]['message'])
        
        if 'data' not in result or result['data'] is None:
            raise Exception("Données manquantes dans la réponse de l'API")
        
        if result['data'].get('demarche') is None:
            raise Exception("Démarche introuvable ou accès refusé")
        
        if result['data']['demarche'].get('dossiers') is None:
            raise Exception("Impossible de récupérer les dossiers")
            
        dossiers_data = result['data']['demarche']['dossiers']
        
        if dossiers_data.get('nodes'):
            all_dossiers.extend(dossiers_data['nodes'])
        
        page_info = dossiers_data.get('pageInfo', {})
        has_next = page_info.get('hasNextPage', False)
        cursor = page_info.get('endCursor')

    # Filtrer par dates de dépôt si demandé
    if date_debut or date_fin:
        from datetime import datetime
        filtered_dossiers = []
        
        for dossier in all_dossiers:
            date_depot = dossier.get('dateDepot')
            if not date_depot:
                continue
            
            try:
                depot_date = datetime.fromisoformat(date_depot.replace('Z', '+00:00')).date()
            except:
                continue
            
            if date_debut:
                debut = datetime.fromisoformat(date_debut).date()
                if depot_date < debut:
                    continue
            
            if date_fin:
                fin = datetime.fromisoformat(date_fin).date()
                if depot_date > fin:
                    continue
            
            filtered_dossiers.append(dossier)
        
        return filtered_dossiers
    
    return all_dossiers

@app.route('/api/stats')
def stats_sink():
    """Route muette pour absorber les polls externes"""
    return jsonify({}), 200

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/demarche/<int:demarche_number>/info', methods=['POST'])
def demarche_info(demarche_number):
    """Retourne les infos de la démarche avec le schéma des répétitions"""
    data = request.json
    token = data.get('token')
    use_proxy = data.get('use_proxy', False)
    
    if not token:
        return jsonify({'error': 'Token manquant'}), 400
    
    query = """
    query getDemarche($demarcheNumber: Int!) {
      demarche(number: $demarcheNumber) {
        id
        number
        title
        state
        champDescriptors {
          id
          label
          type
          __typename
          ... on RepetitionChampDescriptor {
            champDescriptors {
              id
              label
              type
              __typename
            }
          }
        }
        annotationDescriptors {
          id
          label
          type
          __typename
        }
      }
    }
    """
    
    try:
        result = graphql_query(query, {"demarcheNumber": demarche_number}, token, use_proxy)
        
        if result is None:
            return jsonify({'error': 'Aucune réponse de l\'API'}), 500
            
        if 'errors' in result:
            return jsonify({'error': result['errors'][0]['message']}), 400
            
        if 'data' not in result or result['data'] is None:
            return jsonify({'error': 'Données manquantes dans la réponse'}), 500
            
        if result['data'].get('demarche') is None:
            return jsonify({'error': 'Démarche introuvable ou accès refusé'}), 404
            
        return jsonify(result['data']['demarche'])
    except Exception as e:
      error_msg = str(e)
      
      # Si timeout et pas de proxy, suggérer d'activer le proxy
      if "Délai d'attente" in error_msg and not use_proxy:
          if is_on_rie():
              error_msg += " | 💡 Vous semblez être sur le RIE. Essayez de cocher 'Utiliser le proxy RIE'."
          else:
              error_msg += " | Vérifiez votre connexion internet."
      
      # Si proxy activé mais ne fonctionne pas
      if "Délai d'attente" in error_msg and use_proxy:
          error_msg += " | ⚠️ Le proxy RIE ne répond pas. Vérifiez que vous êtes bien connecté au réseau RIE Agriculture."
      
      return jsonify({'error': error_msg}), 500

@app.route('/api/demarche/<int:demarche_number>/dossiers', methods=['POST'])
def dossiers_list(demarche_number):
    """Retourne les dossiers avec leurs PJ"""
    data = request.json
    token = data.get('token')
    use_proxy = data.get('use_proxy', False)
    date_debut = data.get('date_debut')  # AJOUTE
    date_fin = data.get('date_fin')      # AJOUTE
    
    if not token:
        return jsonify({'error': 'Token manquant'}), 400
    
    try:
        dossiers = get_dossiers_with_pj(demarche_number, token, use_proxy, date_debut, date_fin)  # MODIFIE
        
        if not dossiers:
            return jsonify([])
        
        formatted = []
        for dossier in dossiers:
            try:
                pj_list = []
                
                # Extraire les infos du demandeur
                demandeur_info = extract_demandeur_info(dossier.get('demandeur'))
                
                # Infos système du dossier
                dossier_info = {
                    'numero': dossier.get('number'),
                    'state': dossier.get('state'),
                    'dateDepot': dossier.get('dateDepot'),
                    'email_usager': dossier.get('usager', {}).get('email') if dossier.get('usager') else None,
                }
                
                # Extraire toutes les valeurs de champs (y compris répétitions)
                champs_values = extract_all_champs_values(dossier.get('champs', []))
                
                # Ajouter les infos système et demandeur aux champs
                champs_values.update(dossier_info)
                champs_values.update(demandeur_info)
                
                # Extraire les PJ (y compris dans les répétitions)
                for champ in dossier.get('champs', []):
                    if champ.get('__typename') == 'PieceJustificativeChamp' and champ.get('files'):
                        for file in champ.get('files', []):
                            pj_list.append({
                                'champ_id': champ.get('id'),
                                'champ_label': champ.get('label'),
                                'filename': file.get('filename'),
                                'url': file.get('url'),
                                'content_type': file.get('contentType'),
                                'size': file.get('byteSize'),
                                'row_index': None  # Pas dans une répétition
                            })
                    # Gérer les PJ dans les blocs répétables
                    elif champ.get('__typename') == 'RepetitionChamp':
                        for row_index, row in enumerate(champ.get('rows', [])):
                            for sub_champ in row.get('champs', []):
                                if sub_champ.get('__typename') == 'PieceJustificativeChamp' and sub_champ.get('files'):
                                    for file in sub_champ.get('files', []):
                                        pj_list.append({
                                            'champ_id': sub_champ.get('id'),
                                            'champ_label': sub_champ.get('label'),
                                            'filename': file.get('filename'),
                                            'url': file.get('url'),
                                            'content_type': file.get('contentType'),
                                            'size': file.get('byteSize'),
                                            'row_index': row_index  # Index de la ligne dans la répétition
                                        })
                # Ajouter l'attestation si elle existe
                if dossier.get('attestation'):
                    attestation = dossier.get('attestation')
                    pj_list.append({
                        'champ_id': 'attestation',
                        'champ_label': '📄 Attestation',
                        'filename': attestation.get('filename', 'attestation.pdf'),
                        'url': attestation.get('url'),
                        'content_type': attestation.get('contentType', 'application/pdf'),
                        'size': attestation.get('byteSize'),
                        'row_index': None
                    })
                
                formatted.append({
                    'number': dossier.get('number'),
                    'id': dossier.get('id'),
                    'state': dossier.get('state'),
                    'pieces_jointes': pj_list,
                    'champs_values': champs_values,
                    'demandeur': demandeur_info
                })
            except Exception as e:
                print(f"Erreur lors du traitement du dossier {dossier.get('number', 'inconnu')}: {str(e)}")
                import traceback
                traceback.print_exc()
                # Continuer avec les autres dossiers
                continue
        
        return jsonify(formatted)
    except Exception as e:
        print(f"Erreur globale dans dossiers_list: {str(e)}")
        import traceback
        traceback.print_exc()
        
        error_msg = str(e)
        
        # Si timeout et pas de proxy, suggérer d'activer le proxy
        if "Délai d'attente" in error_msg and not use_proxy:
            if is_on_rie():
                error_msg += " | 💡 Vous semblez être sur le RIE. Essayez de cocher 'Utiliser le proxy RIE'."
            else:
                error_msg += " | Vérifiez votre connexion internet."
        
        # Si proxy activé mais ne fonctionne pas
        if "Délai d'attente" in error_msg and use_proxy:
            error_msg += " | ⚠️ Le proxy RIE ne répond pas. Vérifiez que vous êtes bien connecté au réseau RIE Agriculture."
        
        return jsonify({'error': error_msg}), 500

@app.route('/api/download-file', methods=['POST'])
def download_file_proxy():
    """Télécharge un fichier depuis DS et le renvoie au client"""
    data = request.json
    url = data.get('url')
    use_proxy = data.get('use_proxy', False)
    
    if not url:
        return jsonify({'error': 'URL manquante'}), 400
    
    try:
        # Session fraîche dédiée — jamais la session GraphQL partagée
        if use_proxy and PYPAC_AVAILABLE:
            pac = get_pac(url=PAC_URL)
            resolver = ProxyResolver(pac=pac)
            session = PACSession(proxy_resolver=resolver)
        else:
            session = requests.Session()

        global _ssl_verify
        try:
            response = session.get(url, timeout=60, verify=_ssl_verify)
        except (requests.exceptions.SSLError, requests.exceptions.ConnectionError):
            print("⚠️ Connexion échouée, retry avec verify=False (mémorisé)")
            _ssl_verify = False
            response = session.get(url, timeout=60, verify=False)
        
        response.raise_for_status()
        session.close()
        
        # Renvoyer le fichier au client
        return response.content, 200, {
            'Content-Type': response.headers.get('Content-Type', 'application/octet-stream')
        }
    except Exception as e:
        print(f"❌ ERREUR download_file: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/quit', methods=['POST'])
def quit_app():
    """Ferme proprement l'application"""
    def shutdown():
        import os
        import signal

        # Tuer proprement le processus Flask
        os.kill(os.getpid(), signal.SIGTERM)
    
    # Attendre 0.5s pour envoyer la réponse avant de tuer
    Timer(0.5, shutdown).start()
    return jsonify({'status': 'ok'})
    
if __name__ == '__main__':
    DOWNLOAD_FOLDER.mkdir(exist_ok=True)
    
    def open_browser():
        import os
        import subprocess

        # Chemins possibles pour Chrome
        chrome_paths = [
            r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        ]
        
        # Chemins possibles pour Edge
        edge_paths = [
            r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
            r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        ]
        
        # Essayer Chrome
        for chrome in chrome_paths:
            if os.path.exists(chrome):
                subprocess.Popen([chrome, 'http://127.0.0.1:5000'])
                return
        
        # Essayer Edge
        for edge in edge_paths:
            if os.path.exists(edge):
                subprocess.Popen([edge, 'http://127.0.0.1:5000'])
                return
        
        # Fallback : navigateur par défaut
        webbrowser.open('http://127.0.0.1:5000')
    
    Timer(1.5, open_browser).start()
    app.run(debug=False, host='127.0.0.1', port=5000)