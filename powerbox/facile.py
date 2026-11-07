"""Bibliothèque « facile » : programmer la powerbox avec des mots simples.

    from powerbox.facile import *

    avancer(2)              # le robot avance pendant 2 secondes
    tourner_droite(1)
    moteur("B", 50)         # le moteur B tourne à 50 %
    attendre(3)
    arreter()               # tout s'arrête

Les vitesses sont en pourcentage, de -100 à 100. Le signe donne le sens de rotation.

Le robot a deux roues : par défaut la gauche sur la sortie A et la droite sur la sortie D,
comme dans l'appli du boîtier. On peut changer ça avec roues(gauche="B", droite="C").

Sans boîtier, on peut essayer son programme en simulation :

    POWERBOX_SIMULATION=1 python3 mon_programme.py

La connexion se fait toute seule à la première commande, et les moteurs s'arrêtent tout seuls
à la fin du programme.
"""
from __future__ import annotations

import atexit
import os
import sys
import threading
import time
from typing import Callable

from .device import DEFAULT_ADDRESS, PowerBox
from .protocol import MAX_SPEED
from .simulation import SimulatedPowerBox

__all__ = [
    "connecter", "deconnecter",
    "moteur", "moteur_pendant", "arreter", "stop", "vitesse_moteur",
    "roues", "vitesse_robot", "avancer", "reculer", "tourner_gauche", "tourner_droite",
    "virage_gauche", "virage_droite", "arreter_robot", "robot",
    "attendre", "dire", "note",
    "quand_touche", "quand_touche_relachee", "touche_appuyee", "attendre_touche", "ecouter_touches",
]

PORTS = ("a", "b", "c", "d")

_box = None
_lock = threading.RLock()
_robot = {"gauche": "a", "droite": "d", "sens_gauche": -1, "sens_droite": -1, "vitesse": 100}

# (roue gauche, roue droite) pour chaque mouvement du robot, en fraction de la vitesse
MOUVEMENTS = {
    "avancer": (1, 1),
    "reculer": (-1, -1),
    "tourner_gauche": (-1, 1),   # sur place
    "tourner_droite": (1, -1),
    "virage_gauche": (0, 1),     # en arc : une roue arrêtée
    "virage_droite": (1, 0),
}


# --- conversions ------------------------------------------------------------------------
def pourcent_vers_brut(pourcent: float) -> int:
    """-100..100 % -> -127..127 (valeur envoyée au boîtier)."""
    p = max(-100.0, min(100.0, float(pourcent)))
    return round(p * MAX_SPEED / 100)


def brut_vers_pourcent(valeur: int) -> int:
    return round(valeur * 100 / MAX_SPEED)


def _port(nom: str) -> str:
    p = str(nom).strip().lower()
    if p not in PORTS:
        raise ValueError(f"le moteur doit être A, B, C ou D (pas {nom!r})")
    return p


# --- connexion --------------------------------------------------------------------------
def connecter(adresse: str | None = None, simulation: bool | None = None):
    """Se connecte au boîtier. Appelé tout seul par la première commande.

    simulation=True (ou la variable d'environnement POWERBOX_SIMULATION=1) : pas de boîtier,
    les vitesses sont affichées à l'écran.
    """
    global _box
    with _lock:
        if _box is not None:
            return _box
        if simulation is None:
            simulation = os.environ.get("POWERBOX_SIMULATION", "") not in ("", "0")
        adresse = adresse or os.environ.get("POWERBOX_ADRESSE") or DEFAULT_ADDRESS
        if simulation:
            print("🖥  Mode simulation : pas de boîtier, j'affiche les vitesses des moteurs.", flush=True)
            box = SimulatedPowerBox().connect()
        else:
            print(f"🔌 Connexion au boîtier {adresse}…", flush=True)
            box = PowerBox(adresse)
            try:
                box.connect()
            except OSError as e:
                raise SystemExit(
                    f"😕 Je ne trouve pas le boîtier ({e}).\n"
                    "   Vérifie qu'il est allumé et qu'aucun téléphone n'y est connecté.\n"
                    f"   Pour essayer sans boîtier : POWERBOX_SIMULATION=1 python3 {sys.argv[0]}"
                ) from None
            print("✅ Connecté !", flush=True)
        _box = box
        atexit.register(deconnecter)
        return box


def deconnecter() -> None:
    """Arrête les moteurs et se déconnecte (fait tout seul à la fin du programme)."""
    global _box
    with _lock:
        if _box is not None:
            try:
                _box.close()
            finally:
                _box = None


# --- moteurs ----------------------------------------------------------------------------
def moteur(nom: str, vitesse: float) -> None:
    """Fait tourner un moteur : moteur("A", 80). Vitesse de -100 à 100 %, 0 = arrêt."""
    p = _port(nom)
    box = connecter()
    with _lock:
        box.set(**{p: pourcent_vers_brut(vitesse)})


def moteur_pendant(nom: str, vitesse: float, secondes: float) -> None:
    """Fait tourner un moteur pendant un moment, puis l'arrête."""
    moteur(nom, vitesse)
    attendre(secondes)
    moteur(nom, 0)


def arreter(nom: str | None = None) -> None:
    """Arrête un moteur : arreter("B"). Sans rien (ou "tous") : arrête tout."""
    box = connecter()
    with _lock:
        if nom is None or str(nom).lower() == "tous":
            box.stop()
        else:
            box.set(**{_port(nom): 0})


stop = arreter


def vitesse_moteur(nom: str) -> int:
    """Vitesse actuelle d'un moteur, en %."""
    p = _port(nom)
    return brut_vers_pourcent(_box.speeds[p]) if _box else 0


# --- robot ------------------------------------------------------------------------------
def roues(gauche: str = "A", droite: str = "D",
          inverser_gauche: bool = False, inverser_droite: bool = False) -> None:
    """Indique sur quelles sorties sont branchées les roues du robot.

    Si une roue tourne à l'envers quand le robot doit avancer, mets inverser_…=True.
    """
    with _lock:
        _robot["gauche"], _robot["droite"] = _port(gauche), _port(droite)
        _robot["sens_gauche"] = 1 if inverser_gauche else -1
        _robot["sens_droite"] = 1 if inverser_droite else -1


def vitesse_robot(pourcent: float) -> None:
    """Vitesse des déplacements du robot (de 0 à 100 %, 100 au départ)."""
    _robot["vitesse"] = max(0.0, min(100.0, float(pourcent)))


def _roues(pct_gauche: float, pct_droite: float) -> None:
    box = connecter()
    with _lock:
        vals = {_robot["gauche"]: pourcent_vers_brut(pct_gauche * _robot["sens_gauche"])}
        vals[_robot["droite"]] = pourcent_vers_brut(pct_droite * _robot["sens_droite"])
        box.set(**vals)


def robot(mouvement: str, secondes: float | None = None) -> None:
    """robot("avancer", 2). Sans durée, le robot continue jusqu'au prochain ordre."""
    if mouvement not in MOUVEMENTS:
        raise ValueError(f"mouvement inconnu : {mouvement!r} (possibles : {', '.join(MOUVEMENTS)})")
    g, d = MOUVEMENTS[mouvement]
    v = _robot["vitesse"]
    _roues(g * v, d * v)
    if secondes is not None:
        attendre(secondes)
        arreter_robot()


def avancer(secondes: float | None = None) -> None:
    """Le robot avance. avancer(2) : pendant 2 secondes. avancer() : sans s'arrêter."""
    robot("avancer", secondes)


def reculer(secondes: float | None = None) -> None:
    robot("reculer", secondes)


def tourner_gauche(secondes: float | None = None) -> None:
    """Tourne sur place vers la gauche."""
    robot("tourner_gauche", secondes)


def tourner_droite(secondes: float | None = None) -> None:
    robot("tourner_droite", secondes)


def virage_gauche(secondes: float | None = None) -> None:
    """Tourne en avançant (la roue gauche s'arrête)."""
    robot("virage_gauche", secondes)


def virage_droite(secondes: float | None = None) -> None:
    robot("virage_droite", secondes)


def arreter_robot() -> None:
    _roues(0, 0)


# --- temps, messages, sons ----------------------------------------------------------------
def attendre(secondes: float) -> None:
    """Attend un moment ; les moteurs continuent de faire ce qu'ils faisaient."""
    time.sleep(max(0.0, float(secondes)))


def dire(texte) -> None:
    print(f"💬 {texte}", flush=True)


def note(nom: str = "do", secondes: float = 0.5) -> None:
    """Affiche une note de musique et attend sa durée (le son ne sort que dans l'interface web)."""
    print(f"🎵 {nom}", flush=True)
    attendre(secondes)


# --- touches du clavier ---------------------------------------------------------------------
# Un terminal ne dit pas quand une touche est relâchée : une touche tenue envoie des répétitions
# (la 1re après ~0,5 s, puis toutes les ~30 ms). On la considère relâchée quand les répétitions
# s'arrêtent pendant RELACHE_S secondes.
RELACHE_S = 0.6

_touches: dict[str, list[Callable[[], None]]] = {}
_relachees: dict[str, list[Callable[[], None]]] = {}
_derniers_appuis: dict[str, float] = {}
_enfoncees: set = set()
_occupees: set = set()
_nouvel_appui = threading.Condition()
_fin = threading.Event()
_ecoute: threading.Thread | None = None

_SEQUENCES = {b"\x1b[A": "haut", b"\x1b[B": "bas", b"\x1b[C": "droite", b"\x1b[D": "gauche",
              b" ": "espace", b"\r": "entree", b"\n": "entree"}


def quand_touche(touche: str):
    """Décorateur : la fonction est lancée à chaque appui sur la touche.

        @quand_touche("haut")
        def en_avant():
            avancer(0.3)

        ecouter_touches()      # à la fin du programme

    Touches : "haut", "bas", "gauche", "droite" (flèches), "espace", "entree", ou une lettre.
    """
    nom = str(touche).lower()

    def deco(fonction):
        _touches.setdefault(nom, []).append(fonction)
        _demarrer_ecoute()
        return fonction
    return deco


def quand_touche_relachee(touche: str):
    """Décorateur : la fonction est lancée quand on lâche la touche (environ 0,6 s plus tard
    dans un terminal)."""
    nom = str(touche).lower()

    def deco(fonction):
        _relachees.setdefault(nom, []).append(fonction)
        _demarrer_ecoute()
        return fonction
    return deco


def touche_appuyee(touche: str) -> bool:
    """Vrai tant que la touche est tenue enfoncée.

        while True:
            if touche_appuyee("haut"):
                avancer()
            else:
                arreter_robot()
            attendre(0.05)
    """
    _demarrer_ecoute()
    return str(touche).lower() in _enfoncees


def attendre_touche(touche: str | None = None) -> None:
    """Attend qu'on appuie sur la touche (ou sur n'importe laquelle si on n'en donne pas)."""
    if not _demarrer_ecoute():
        print("⚠  Pas de clavier disponible : je n'attends pas.", flush=True)
        return
    voulu = None if touche in (None, "nimporte") else str(touche).lower()
    with _nouvel_appui:
        _nouvel_appui.touche = None        # on oublie les appuis d'avant
        while not _fin.is_set():
            _nouvel_appui.wait(0.2)
            dernier = getattr(_nouvel_appui, "touche", None)
            if dernier and (voulu is None or dernier == voulu):
                _nouvel_appui.touche = None
                return
    raise KeyboardInterrupt


def ecouter_touches() -> None:
    """Attend les appuis sur les touches jusqu'à Échap (ou Ctrl+C)."""
    if not _touches and not _relachees:
        return
    if _ecoute is None:
        print("⚠  Pas de clavier disponible (lance le programme dans un terminal).")
        return
    print("⌨  Appuie sur les touches ! (Échap pour quitter)", flush=True)
    try:
        while not _fin.wait(0.2):
            pass
    except KeyboardInterrupt:
        pass


def _lancer(cle: str, fonctions: list) -> None:
    if not fonctions or cle in _occupees:   # déjà en train de faire son travail
        return
    _occupees.add(cle)

    def tache():
        try:
            for f in fonctions:
                f()
        except Exception as e:  # on ne veut pas que le clavier s'arrête pour une erreur
            print(f"😕 Erreur dans la touche « {cle[1:]} » : {e}", flush=True)
        finally:
            _occupees.discard(cle)
    threading.Thread(target=tache, daemon=True).start()


def _appui(nom: str) -> None:
    _derniers_appuis[nom] = time.monotonic()
    _enfoncees.add(nom)
    with _nouvel_appui:
        _nouvel_appui.touche = nom
        _nouvel_appui.notify_all()
    _lancer("+" + nom, _touches.get(nom))


def _surveiller_relaches() -> None:
    while not _fin.wait(0.05):
        maintenant = time.monotonic()
        for nom in list(_enfoncees):
            if maintenant - _derniers_appuis.get(nom, 0) > RELACHE_S:
                _enfoncees.discard(nom)
                _lancer("-" + nom, _relachees.get(nom))


def _sortie_propre(type_, valeur, trace) -> None:
    if issubclass(type_, KeyboardInterrupt):   # Ctrl+C ou Échap : pas de message d'erreur effrayant
        print("\n👋 Programme arrêté.", flush=True)
    else:
        sys.__excepthook__(type_, valeur, trace)


def _demarrer_ecoute() -> bool:
    """Démarre la lecture du clavier (une seule fois). Faux s'il n'y a pas de terminal."""
    global _ecoute
    if _ecoute is not None:
        return True
    if not sys.stdin.isatty():
        return False
    import _thread
    import termios
    import tty

    fd = sys.stdin.fileno()
    ancien = termios.tcgetattr(fd)
    tty.setcbreak(fd)
    atexit.register(termios.tcsetattr, fd, termios.TCSADRAIN, ancien)
    sys.excepthook = _sortie_propre

    def boucle():
        while not _fin.is_set():
            data = os.read(fd, 16)
            if not data:
                break
            if data == b"\x1b":          # Échap : on arrête tout le programme
                _fin.set()
                _thread.interrupt_main()
                break
            # plusieurs répétitions peuvent arriver d'un coup : on découpe
            for morceau in _decouper(data):
                nom = _SEQUENCES.get(morceau)
                if nom is None and len(morceau) == 1 and morceau.isalnum():
                    nom = morceau.decode().lower()
                if nom:
                    _appui(nom)

    _ecoute = threading.Thread(target=boucle, daemon=True)
    _ecoute.start()
    threading.Thread(target=_surveiller_relaches, daemon=True).start()
    return True


def _decouper(data: bytes) -> list[bytes]:
    out, i = [], 0
    while i < len(data):
        if data[i:i + 2] == b"\x1b[" and i + 2 < len(data):
            out.append(data[i:i + 3])
            i += 3
        else:
            out.append(data[i:i + 1])
            i += 1
    return out
