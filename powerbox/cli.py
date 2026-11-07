"""Ligne de commande : python3 -m powerbox  (ou  powerbox  après pip install -e .)"""
from __future__ import annotations

import argparse
import sys
import time

from . import protocol as P
from .device import DEFAULT_ADDRESS, PowerBox

HELP = """Commandes :
  a 100 | b -60 | c 0 | d 127   règle une sortie (-127..127, le signe = sens)
  all 50                        règle les 4 sorties
  stop                          arrête tout
  raw FC0F01...                 envoie une trame brute de 16 octets (somme recalculée)
  status                        affiche le dernier état reçu
  help | q"""


def _assign(items: list[str]) -> dict:
    out = {}
    for it in items:
        k, _, v = it.partition("=")
        k = k.strip().lower()
        if k not in "abcd" or not v:
            raise SystemExit(f"argument invalide : {it!r} (attendu a=100, d=-50…)")
        out[k] = int(v)
    return out


def _interactive(box: PowerBox) -> None:
    print(HELP)
    while True:
        try:
            line = input("powerbox> ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not line:
            continue
        parts = line.split()
        cmd = parts[0]
        try:
            if cmd in ("q", "quit", "exit"):
                return
            if cmd in ("h", "help", "?"):
                print(HELP)
            elif cmd == "stop":
                box.stop()
            elif cmd == "all" and len(parts) == 2:
                v = int(parts[1])
                box.set(v, v, v, v)
            elif cmd in ("a", "b", "c", "d") and len(parts) == 2:
                box.motor(cmd, int(parts[1]))
            elif cmd == "raw" and len(parts) >= 2:
                fr = bytearray(bytes.fromhex("".join(parts[1:])))
                if len(fr) == P.FRAME_LEN:
                    fr[-1] = P.checksum(fr)
                box.send_frame(bytes(fr))
                print("  envoyé", bytes(fr).hex(" "))
                continue
            elif cmd == "status":
                print(" ", box.last_status or "aucun état reçu")
                continue
            else:
                print("?  (help pour l'aide)")
                continue
            print("  ", box.speeds, " trame", box.frame().hex(" "))
        except ValueError as e:
            print("  valeur invalide :", e)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="powerbox", description="Pilote le boîtier BLE « powerbox » depuis Linux.")
    p.add_argument("--address", default=DEFAULT_ADDRESS, help=f"adresse du boîtier (défaut {DEFAULT_ADDRESS})")
    p.add_argument("--handle", type=lambda x: int(x, 0), default=P.WRITE_HANDLE,
                   help="poignée ATT de ffa1 (défaut 0x0011)")
    p.add_argument("--set", nargs="+", metavar="M=V", help="ex. a=100 d=-100 puis arrêt après --duration")
    p.add_argument("--duration", type=float, default=2.0, help="durée en secondes avec --set (défaut 2)")
    p.add_argument("--repeat", type=float, default=0.2,
                   help="renvoi périodique de la trame en s (défaut 0.2, 0 = jamais)")
    p.add_argument("--req", action="store_true",
                   help="écritures avec réponse (Write Request) au lieu de Write Command")
    p.add_argument("--status", action="store_true", help="affiche les trames d'état reçues")
    p.add_argument("--discover", action="store_true",
                   help="liste les caractéristiques (ne marche que si bluetoothd est arrêté)")
    p.add_argument("-v", "--verbose", action="store_true", help="affiche tous les paquets ATT")
    args = p.parse_args(argv)

    on_status = (lambda st: print(" ", st)) if args.status else None
    box = PowerBox(args.address, handle=args.handle, with_response=args.req,
                   keepalive=args.repeat, on_status=on_status, verbose=args.verbose)
    print(f"Connexion à {args.address} …", flush=True)
    try:
        box.connect()
    except OSError as e:
        sys.exit(f"Connexion impossible : {e}\n(boîtier allumé ? hors de portée ? déjà connecté au téléphone ?)")
    print("Connecté.")
    try:
        if args.discover:
            for decl, props, val, uuid in box.conn.discover_characteristics():
                print(f"  décl 0x{decl:04x}  valeur 0x{val:04x}  props 0x{props:02x}  {uuid}")
        elif args.set:
            box.set(**_assign(args.set))
            print("  ", box.speeds, " trame", box.frame().hex(" "))
            time.sleep(args.duration)
        else:
            _interactive(box)
    except TimeoutError as e:
        print("Délai dépassé :", e)
    finally:
        box.close()
        print("Moteurs arrêtés, déconnecté.")


if __name__ == "__main__":
    main()
