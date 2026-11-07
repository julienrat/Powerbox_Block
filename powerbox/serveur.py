"""Serveur de l'interface « PowerBox Blocs » (programmation par blocs dans le navigateur).

    python3 -m powerbox.serveur                 # ouvre http://localhost:8080
    python3 -m powerbox.serveur --simulation    # sans boîtier

Le programme fait de blocs est exécuté dans le navigateur. Le serveur reçoit seulement les
vitesses des moteurs (en %) et les transmet au boîtier. Il n'exécute aucun code envoyé par la page.

API :
    GET  /api/etat                      -> {"connecte", "simulation", "adresse", "message", "vitesses"}
    POST /api/moteurs  {"a": 80, ...}   -> règle une ou plusieurs sorties (-100..100 %)
    POST /api/stop                      -> arrête tout
    GET  /api/scanner[?tous=1]          -> boîtiers à portée (5 s, via bluetoothctl)
    POST /api/connecter {"adresse": …}  -> se connecte à ce boîtier (adresse facultative) et se
                                           reconnecte si besoin
    POST /api/deconnecter               -> arrête les moteurs et libère le boîtier

Sécurité : les POST doivent être en application/json. Une autre page web ouverte dans le
navigateur ne peut donc pas piloter les moteurs (le navigateur bloque ces requêtes entre sites).
Si aucune requête n'arrive pendant 3 s alors que des moteurs tournent (page fermée, onglet
planté), tout s'arrête.
"""
from __future__ import annotations

if __name__ == "__main__" and not __package__:
    # lancé directement (python3 serveur.py) : on se rattache au paquet powerbox
    import os
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import powerbox  # noqa: F401
    __package__ = "powerbox"

import argparse
import json
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .device import DEFAULT_ADDRESS, PowerBox
from .facile import brut_vers_pourcent, pourcent_vers_brut
from .scan import ScanImpossible, adresse_valide, scanner
from .simulation import SimulatedPowerBox

WEB_DIR = Path(__file__).with_name("web")
WATCHDOG_S = 3.0     # plus de nouvelles de la page : moteurs arrêtés
GRACE_S = 12.0       # coupure courte cachée à la page pendant la reconnexion
VEILLE_S = 60.0      # plus aucune page : le boîtier est libéré


class Pilote:
    """Garde la connexion au boîtier (reconnexion automatique) et l'état des moteurs."""

    def __init__(self, adresse: str, simulation: bool):
        self.adresse = adresse.upper()
        self.simulation = simulation
        self.vitesses = {"a": 0, "b": 0, "c": 0, "d": 0}   # en %, ce que la page a demandé
        self.message = ""
        self.box = SimulatedPowerBox(verbose=False).connect() if simulation else None
        self.voulu = False            # l'utilisateur a demandé la connexion (bouton Connecter)
        self.dernier_contact = time.monotonic()
        self.en_veille = False
        self._connecte_depuis = 0.0
        self._coupe_a: float | None = None    # moment de la dernière coupure d'un lien établi
        self._echecs = 0
        self._lock = threading.Lock()
        self._fin = threading.Event()
        self._reveil = threading.Event()

    # -- connexion -------------------------------------------------------------------------
    @property
    def connecte(self) -> bool:
        return self.box is not None and self.box.connected

    def demarrer(self) -> None:
        if not self.simulation:
            threading.Thread(target=self._boucle_connexion, daemon=True).start()
        threading.Thread(target=self._boucle_securite, daemon=True).start()

    def connecter(self, adresse: str | None = None) -> None:
        if adresse:
            adresse = adresse.upper()
            if adresse != self.adresse:
                self.adresse = adresse
                print(f"  🎯 boîtier choisi : {adresse}", flush=True)
        self.voulu = True
        self.message = "recherche du boîtier…"
        self._echecs = 0
        self._coupe_a = None
        self._reveil.set()

    def deconnecter(self) -> None:
        self.voulu = False
        self.message = ""
        self._coupe_a = None
        self._reveil.set()

    def _attendre(self, s: float) -> None:
        self._reveil.wait(s)
        self._reveil.clear()

    def _page_active(self, secondes: float) -> bool:
        return time.monotonic() - self.dernier_contact < secondes

    def _liberer(self, raison: str) -> None:
        with self._lock:
            box, self.box = self.box, None
        if box is not None:
            box.close()
            print(f"  ⏏  boîtier {box.conn.address} libéré ({raison})", flush=True)

    def _boucle_connexion(self) -> None:
        """Tant que la connexion est voulue : se connecte, et se reconnecte si le lien tombe.

        - coupure courte : reconnexion immédiate ; la page continue d'afficher « connecté »
          (GRACE_S) pour éviter les clignotements et les messages à répétition ;
        - échecs répétés : on espace les essais (2, 4, 8, puis 15 s) ;
        - plus aucune page ouverte depuis VEILLE_S : on libère le boîtier et on ne réessaie plus
          (la connexion reprend toute seule quand une page revient).
        """
        while not self._fin.is_set():
            # pas voulu, ou connecté à un autre boîtier que celui choisi : on libère
            autre = self.box is not None and self.box.conn.address.upper() != self.adresse
            if not self.voulu or autre:
                self._liberer("déconnexion demandée" if not self.voulu else "autre boîtier choisi")
                self._coupe_a = None
                if not self.voulu:
                    self._attendre(1)
                continue
            if not self._page_active(VEILLE_S):
                if self.box is not None:
                    self._liberer("plus aucune page ouverte, reconnexion au retour de la page")
                self.en_veille = True
                self._coupe_a = None
                self._attendre(1)
                continue
            self.en_veille = False
            if self.connecte:
                self._attendre(0.3)
                continue
            if self.box is not None:      # le lien vient de tomber
                duree = time.monotonic() - self._connecte_depuis
                print(f"  ⚡ liaison coupée après {duree:.0f} s, reconnexion…", flush=True)
                self._liberer("liaison coupée")
                self._coupe_a = time.monotonic()
            box = PowerBox(self.adresse)
            try:
                box.connect(timeout=8)
            except OSError as e:
                if self.voulu:
                    self._echecs += 1
                    delai = min(15, 2 ** self._echecs)
                    if not self._en_reconnexion():
                        self.message = f"boîtier introuvable ({e.strerror or e})"
                    print(f"  … boîtier introuvable ({e.strerror or e}), nouvel essai dans {delai} s", flush=True)
                    self._attendre(delai)
                continue
            if not self.voulu or box.conn.address.upper() != self.adresse:   # annulé / changé
                box.close()
                continue
            with self._lock:
                if not self._page_active(WATCHDOG_S):    # sécurité : personne ne pilote
                    self.vitesses = dict.fromkeys(self.vitesses, 0)
                self.box = box
                self._envoyer()
            reconnexion = self._coupe_a is not None
            self._connecte_depuis = time.monotonic()
            self._coupe_a = None
            self._echecs = 0
            self.message = "connecté"
            print(f"  ✅ boîtier {self.adresse} {'reconnecté' if reconnexion else 'connecté'}", flush=True)

    def _en_reconnexion(self) -> bool:
        """Coupure récente d'un lien qui marchait : on la cache à la page pendant GRACE_S."""
        return (self.voulu and not self.connecte and self._coupe_a is not None
                and time.monotonic() - self._coupe_a < GRACE_S)

    def _boucle_securite(self) -> None:
        while not self._fin.wait(0.5):
            if any(self.vitesses.values()) and time.monotonic() - self.dernier_contact > WATCHDOG_S:
                print("  ⏱  plus de nouvelles de la page : arrêt des moteurs", flush=True)
                self.regler(dict.fromkeys("abcd", 0), contact=False)

    def fermer(self) -> None:
        self._fin.set()
        if self.box is not None:
            self.box.close()

    # -- commandes -----------------------------------------------------------------------
    def regler(self, valeurs: dict, contact: bool = True) -> None:
        with self._lock:
            for k, v in valeurs.items():
                k = str(k).lower()
                if k in self.vitesses:
                    self.vitesses[k] = brut_vers_pourcent(pourcent_vers_brut(v))
            self._envoyer()
        if contact:
            self.touche()

    def _envoyer(self) -> None:
        if self.connecte:
            try:
                self.box.set(**{k: pourcent_vers_brut(v) for k, v in self.vitesses.items()})
            except OSError as e:
                self.message = f"erreur d'envoi ({e})"

    def touche(self) -> None:
        self.dernier_contact = time.monotonic()

    def etat(self) -> dict:
        reconnexion = self._en_reconnexion()
        return {"connecte": self.connecte or reconnexion, "reconnexion": reconnexion,
                "simulation": self.simulation, "adresse": self.adresse, "voulu": self.voulu,
                "message": "connecté" if reconnexion else self.message,
                "vitesses": {k.upper(): v for k, v in self.vitesses.items()}}


class Gestionnaire(SimpleHTTPRequestHandler):
    pilote: Pilote

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # pas de ligne par requête dans le terminal
        pass

    def _json(self, data: dict, code: int = 200) -> None:
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        chemin, _, params = self.path.partition("?")
        if chemin == "/api/etat":
            self.pilote.touche()
            return self._json(self.pilote.etat())
        if chemin == "/api/scanner":
            return self._scanner("tous=1" in params)
        return super().do_GET()

    def _scanner(self, tous: bool) -> None:
        p = self.pilote
        if p.simulation:
            return self._json({"boitiers": [], "erreur": "mode simulation"})
        try:
            liste = scanner(5, tous)
        except ScanImpossible as e:
            return self._json({"boitiers": [], "erreur": str(e)})
        # le boîtier connecté n'émet plus d'annonces : on l'ajoute
        if p.connecte and not any(d["adresse"] == p.adresse for d in liste):
            liste.insert(0, {"adresse": p.adresse, "nom": "powerbox", "rssi": None, "vue": True})
        for d in liste:
            d["connecte"] = p.connecte and d["adresse"] == p.adresse
        return self._json({"boitiers": liste})

    def do_POST(self):
        chemin = self.path.split("?")[0]
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return self._json({"erreur": "Content-Type application/json attendu"}, 415)
        try:
            n = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(n) or b"{}") if n else {}
        except (ValueError, json.JSONDecodeError):
            return self._json({"erreur": "JSON invalide"}, 400)
        if chemin == "/api/moteurs" and isinstance(data, dict):
            try:
                self.pilote.regler(data)
            except (TypeError, ValueError):
                return self._json({"erreur": "vitesses invalides"}, 400)
        elif chemin == "/api/stop":
            self.pilote.regler(dict.fromkeys("abcd", 0))
        elif chemin == "/api/connecter":
            adresse = data.get("adresse") if isinstance(data, dict) else None
            if adresse is not None and not adresse_valide(adresse):
                return self._json({"erreur": "adresse invalide (format AA:BB:CC:DD:EE:FF)"}, 400)
            self.pilote.connecter(adresse)
        elif chemin == "/api/deconnecter":
            self.pilote.regler(dict.fromkeys("abcd", 0))
            self.pilote.deconnecter()
        else:
            return self._json({"erreur": "inconnu"}, 404)
        return self._json(self.pilote.etat())


def _creer_serveur(host: str, port: int, handler):
    """Ouvre le serveur sur `port`, ou le suivant s'il est pris par un autre programme.
    Renvoie (None, port) si PowerBox Blocs tourne déjà sur ce port."""
    import urllib.request
    for essai in range(port, port + 10):
        try:
            return ThreadingHTTPServer((host, essai), handler), essai
        except OSError:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{essai}/api/etat", timeout=1) as r:
                    if "vitesses" in json.load(r):
                        return None, essai
            except (OSError, ValueError):
                pass
    raise SystemExit(f"Aucun port libre entre {port} et {port + 9}")


def _quitter_sans_page(serveur, pilote: Pilote) -> None:
    """Mode application : quand plus aucune page n'interroge le serveur, on s'arrête.
    (Les onglets en arrière-plan peuvent n'interroger qu'une fois par minute : marge large.)"""
    debut = time.monotonic()
    while True:
        time.sleep(2)
        vu = pilote.dernier_contact > debut
        silence = time.monotonic() - (pilote.dernier_contact if vu else debut)
        if silence > (120 if vu else 180):
            print("  plus aucune page ouverte : arrêt", flush=True)
            serveur.shutdown()
            return


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="powerbox-blocs",
                                description="Interface de programmation par blocs pour la powerbox.")
    p.add_argument("--address", "--adresse", default=DEFAULT_ADDRESS, help="adresse du boîtier")
    p.add_argument("--simulation", action="store_true", help="sans boîtier")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--host", default="127.0.0.1",
                   help="0.0.0.0 pour ouvrir l'interface depuis d'autres appareils du réseau")
    p.add_argument("--pas-de-navigateur", action="store_true", help="n'ouvre pas le navigateur")
    p.add_argument("--auto", action="store_true",
                   help="se connecte au boîtier dès le démarrage (sinon : bouton Connecter de la page)")
    p.add_argument("--app", action="store_true",
                   help="mode application (AppImage) : s'arrête tout seul quand la page est fermée")
    args = p.parse_args(argv)

    pilote = Pilote(args.address, args.simulation)
    if args.auto and not args.simulation:
        pilote.connecter()
    handler = partial(type("G", (Gestionnaire,), {"pilote": pilote}), directory=str(WEB_DIR))
    serveur, port = _creer_serveur(args.host, args.port, handler)
    if serveur is None:               # PowerBox Blocs tourne déjà : on rouvre juste la page
        url = f"http://localhost:{port}/"
        print(f"PowerBox Blocs est déjà ouvert : {url}")
        if not args.pas_de_navigateur:
            webbrowser.open(url)
        return
    serveur.daemon_threads = True
    url = f"http://localhost:{port}/"
    print(f"🧩 PowerBox Blocs : {url}")
    if args.host not in ("127.0.0.1", "localhost"):
        print("   ⚠  accessible depuis le réseau : n'importe qui sur ce réseau peut piloter les moteurs")
    print("   (Ctrl+C pour arrêter)" + ("  — mode simulation" if args.simulation else ""), flush=True)
    pilote.demarrer()
    if args.app:
        threading.Thread(target=_quitter_sans_page, args=(serveur, pilote), daemon=True).start()
    if not args.pas_de_navigateur:
        threading.Timer(0.5, webbrowser.open, (url,)).start()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        serveur.server_close()
        pilote.fermer()
        print("Moteurs arrêtés. À bientôt !")


if __name__ == "__main__":
    main()
