"""Protocole BLE du boîtier « powerbox » (pur Python, sans dépendance).

Voir docs/protocole.md pour le détail et l'origine de chaque élément.
"""
from __future__ import annotations

from dataclasses import dataclass

# --- Identifiants GATT ---------------------------------------------------------
SERVICE_UUID = "0000ffa0-0002-1000-8000-00805f9b34fb"
WRITE_UUID = "0000ffa1-0002-1000-8000-00805f9b34fb"   # commandes (WRITE)
NOTIFY_UUID = "0000ffa2-0002-1000-8000-00805f9b34fb"  # état (NOTIFY, READ)

# Poignées ATT observées sur le boîtier testé (22:01:01:27:0F:7D)
WRITE_HANDLE = 0x0011
NOTIFY_HANDLE = 0x000E

# --- Trame de commande -----------------------------------------------------------
FRAME_LEN = 16
HEADER = (0xFC, 0x0F, 0x01)
MOTOR_INDEX = {"a": 3, "b": 4, "c": 5, "d": 6}
INDICATOR_INDEX = 8  # utilisé seulement par la série N8 (1=avant, 2=arrière, 3=gauche, 4=droite)
MAX_SPEED = 127


def encode_speed(speed: int) -> int:
    """Vitesse -127..127 -> octet signe/magnitude (bit 7 = sens, bits 0-6 = vitesse)."""
    s = max(-MAX_SPEED, min(MAX_SPEED, int(speed)))
    return (0x80 if s < 0 else 0x00) | abs(s)


def decode_speed(byte: int) -> int:
    """Octet moteur -> vitesse -127..127."""
    v = byte & 0x7F
    return -v if byte & 0x80 else v


def checksum(data: bytes | list[int]) -> int:
    """Somme des 15 premiers octets, modulo 256."""
    return sum(data[: FRAME_LEN - 1]) & 0xFF


def build_frame(a: int = 0, b: int = 0, c: int = 0, d: int = 0, indicator: int = 0) -> bytes:
    """Construit la trame de 16 octets à écrire dans ffa1."""
    f = [0] * FRAME_LEN
    f[0:3] = HEADER
    for name, speed in zip("abcd", (a, b, c, d)):
        f[MOTOR_INDEX[name]] = encode_speed(speed)
    f[INDICATOR_INDEX] = indicator & 0xFF
    f[FRAME_LEN - 1] = checksum(f)
    return bytes(f)


STOP_FRAME = build_frame()


def parse_frame(frame: bytes) -> dict:
    """Décode une trame de commande (utile pour vérifier ou rejouer une capture)."""
    if len(frame) != FRAME_LEN or tuple(frame[:3]) != HEADER:
        raise ValueError("pas une trame de commande powerbox : " + frame.hex(" "))
    return {
        **{m: decode_speed(frame[i]) for m, i in MOTOR_INDEX.items()},
        "indicator": frame[INDICATOR_INDEX],
        "checksum_ok": frame[-1] == checksum(frame),
    }


# --- Trame d'état (notifications ffa2) -------------------------------------------------
@dataclass
class Status:
    raw: bytes
    kind: int          # octet 1 (vu : 0x01)
    value: int         # octet 2 (vu : 0x04) — signification inconnue (niveau de batterie ?)
    checksum_ok: bool  # hypothèse : octet 13 = somme des octets 0..12

    def __str__(self) -> str:
        ok = "ok" if self.checksum_ok else "?"
        return f"état type=0x{self.kind:02x} valeur=0x{self.value:02x} cs={ok}  [{self.raw.hex(' ')}]"


def parse_status(data: bytes) -> Status | None:
    """Décode une notification du boîtier (en-tête 0xCA). Format en partie supposé."""
    if len(data) < 14 or data[0] != 0xCA:
        return None
    return Status(bytes(data), data[1], data[2], (sum(data[:13]) & 0xFF) == data[13])
