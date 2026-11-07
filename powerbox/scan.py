"""Recherche des boîtiers à portée, avec l'outil bluetoothctl de BlueZ (aucune dépendance Python).

    python3 -m powerbox.scan          # liste les powerbox à portée

Un boîtier déjà connecté (au PC ou à un téléphone) n'émet plus d'annonces : il n'apparaît donc
pas dans le scan. On ajoute les « powerbox » déjà connues de BlueZ, marquées « pas vue ».
"""
from __future__ import annotations

import re
import shutil
import subprocess
import threading

NOM_BOITIER = "powerbox"
MAC = re.compile(r"^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")
_ANSI = re.compile(r"\x1b\[[0-9;]*m|\x01|\x02")
_DEVICE = re.compile(r"Device ([0-9A-F:]{17})(?: (.*))?$")
_RSSI = re.compile(r"RSSI: (?:0x[0-9a-f]+ \()?(-?\d+)")

_verrou = threading.Lock()


class ScanImpossible(RuntimeError):
    pass


def adresse_valide(adresse: str) -> bool:
    return bool(MAC.match(str(adresse).upper()))


def _bluetoothctl(*args: str, timeout: float) -> str:
    if not shutil.which("bluetoothctl"):
        raise ScanImpossible("bluetoothctl est introuvable (paquet bluez)")
    try:
        r = subprocess.run(["bluetoothctl", *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        r = e
    out = r.stdout or ""
    if isinstance(out, bytes):
        out = out.decode(errors="replace")
    return _ANSI.sub("", out)


def scanner(duree: float = 5.0, tous: bool = False) -> list[dict]:
    """Liste [{"adresse", "nom", "rssi", "vue"}], les plus proches d'abord.

    tous=True : tous les appareils BLE, pas seulement ceux qui s'appellent « powerbox ».
    """
    with _verrou:   # un seul scan à la fois
        sortie = _bluetoothctl("--timeout", str(int(duree)), "scan", "le", timeout=duree + 5)
        if "No default controller" in sortie or "not available" in sortie:
            raise ScanImpossible("pas d'adaptateur Bluetooth disponible")
        connus = _bluetoothctl("devices", timeout=5)

    noms: dict[str, str] = {}
    vus: dict[str, int | None] = {}
    # appareils connus : « Device AA:BB:… nom »
    for ligne in connus.splitlines():
        m = _DEVICE.search(ligne)
        if m and m.group(2):
            noms[m.group(1)] = m.group(2).strip()
    # pendant le scan : « [NEW] Device AA:… nom », « [CHG] Device AA:… RSSI: … », « … Name: nom »
    for ligne in sortie.splitlines():
        m = _DEVICE.search(ligne)
        if not m or not ("[NEW]" in ligne or "[CHG]" in ligne):
            continue
        adr, reste = m.group(1), (m.group(2) or "").strip()
        r = _RSSI.search(reste)
        if r:
            vus[adr] = int(r.group(1))
        elif "[NEW]" in ligne:
            vus.setdefault(adr, None)
        if "[NEW]" in ligne and reste:
            noms[adr] = reste
        elif reste.startswith(("Name: ", "Alias: ")):
            noms[adr] = reste.split(": ", 1)[1]

    resultat = []
    for adr in set(vus) | set(noms):
        nom = noms.get(adr, "")
        est_boitier = NOM_BOITIER in nom.lower()
        if not (est_boitier or (tous and adr in vus)):
            continue
        resultat.append({"adresse": adr, "nom": nom or "?", "rssi": vus.get(adr), "vue": adr in vus})
    resultat.sort(key=lambda d: (not d["vue"], -(d["rssi"] if d["rssi"] is not None else -999)))
    return resultat


def main() -> None:
    print("Recherche des boîtiers (5 s)…", flush=True)
    try:
        liste = scanner()
    except ScanImpossible as e:
        raise SystemExit(f"Scan impossible : {e}")
    if not liste:
        print("Aucun boîtier trouvé.")
    for d in liste:
        signal = f"{d['rssi']} dBm" if d["rssi"] is not None else ("vu" if d["vue"] else "pas vu (connecté ailleurs ?)")
        print(f"  {d['adresse']}  {d['nom']:<12} {signal}")


if __name__ == "__main__":
    main()
