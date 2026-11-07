"""Transport ATT minimal sur socket L2CAP brute (Linux uniquement, sans dépendance).

Pourquoi ne pas passer par BlueZ/bleak : à la connexion, bluetoothd envoie une requête
« Exchange MTU » à laquelle le boîtier ne répond jamais. Comme ATT n'autorise qu'une requête
en attente à la fois, toute la découverte GATT reste bloquée. On ouvre donc directement le
canal ATT (CID 4) auprès du noyau et on envoie des « Write Command » (sans réponse), que le
boîtier accepte même dans cette situation.
"""
from __future__ import annotations

import ctypes
import os
import queue
import socket
import struct
import threading
import time
from typing import Callable

AF_BLUETOOTH = 31
BTPROTO_L2CAP = 0
BDADDR_LE_PUBLIC = 1
BDADDR_LE_RANDOM = 2
ATT_CID = 4

# Opcodes ATT utilisés
ATT_ERROR_RSP = 0x01
ATT_EXCHANGE_MTU_REQ = 0x02
ATT_EXCHANGE_MTU_RSP = 0x03
ATT_READ_BY_TYPE_REQ = 0x08
ATT_READ_BY_TYPE_RSP = 0x09
ATT_WRITE_REQ = 0x12
ATT_WRITE_RSP = 0x13
ATT_HANDLE_VALUE_NTF = 0x1B
ATT_HANDLE_VALUE_IND = 0x1D
ATT_HANDLE_VALUE_CFM = 0x1E
ATT_WRITE_CMD = 0x52


class sockaddr_l2(ctypes.Structure):
    _fields_ = [
        ("l2_family", ctypes.c_ushort),
        ("l2_psm", ctypes.c_ushort),
        ("l2_bdaddr", ctypes.c_ubyte * 6),
        ("l2_cid", ctypes.c_ushort),
        ("l2_bdaddr_type", ctypes.c_ubyte),
    ]


def _sockaddr(mac: str, addr_type: int) -> sockaddr_l2:
    a = sockaddr_l2()
    a.l2_family = AF_BLUETOOTH
    raw = bytes(int(x, 16) for x in reversed(mac.split(":")))
    for i, b in enumerate(raw):
        a.l2_bdaddr[i] = b
    a.l2_cid = ATT_CID
    a.l2_bdaddr_type = addr_type
    return a


_libc = ctypes.CDLL(None, use_errno=True)


def uuid_le(uuid: str) -> bytes:
    """UUID texte -> 16 octets little-endian (format ATT)."""
    return bytes.fromhex(uuid.replace("-", ""))[::-1]


class AttConnection:
    """Connexion ATT LE avec un fil de lecture en arrière-plan."""

    def __init__(self, address: str, addr_type: int = BDADDR_LE_PUBLIC,
                 on_notify: Callable[[int, bytes], None] | None = None,
                 verbose: bool = False):
        self.address = address
        self.addr_type = addr_type
        self.on_notify = on_notify
        self.verbose = verbose
        self.sock: socket.socket | None = None
        self._responses: queue.Queue[bytes] = queue.Queue()
        self._send_lock = threading.Lock()
        self._reader: threading.Thread | None = None
        self.connected = False

    # -- connexion ---------------------------------------------------------------
    def connect(self, timeout: float = 15.0) -> None:
        deadline = time.time() + timeout
        last_err = None
        while time.time() < deadline:
            s = socket.socket(AF_BLUETOOTH, socket.SOCK_SEQPACKET, BTPROTO_L2CAP)
            src = _sockaddr("00:00:00:00:00:00", BDADDR_LE_PUBLIC)
            dst = _sockaddr(self.address, self.addr_type)
            if _libc.bind(s.fileno(), ctypes.byref(src), ctypes.sizeof(src)) != 0:
                e = ctypes.get_errno()
                s.close()
                raise OSError(e, "bind : " + os.strerror(e))
            if _libc.connect(s.fileno(), ctypes.byref(dst), ctypes.sizeof(dst)) == 0:
                self.sock = s
                self.connected = True
                self._reader = threading.Thread(target=self._read_loop, daemon=True)
                self._reader.start()
                return
            e = ctypes.get_errno()
            last_err = OSError(e, "connect : " + os.strerror(e))
            s.close()
            time.sleep(1.0)
        raise last_err or TimeoutError("connexion impossible")

    def close(self) -> None:
        self.connected = False
        if self.sock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.sock.close()
            self.sock = None

    # -- E/S -----------------------------------------------------------------------
    def _send(self, pdu: bytes) -> None:
        if not self.sock:
            raise ConnectionError("non connecté")
        if self.verbose:
            print(f"  -> {pdu.hex(' ')}")
        with self._send_lock:
            self.sock.send(pdu)

    def _read_loop(self) -> None:
        while self.connected and self.sock:
            try:
                pdu = self.sock.recv(512)
            except OSError:
                break
            if not pdu:
                break
            if self.verbose:
                print(f"  <- {pdu.hex(' ')}")
            op = pdu[0]
            if op == ATT_HANDLE_VALUE_NTF:
                if self.on_notify:
                    self.on_notify(struct.unpack_from("<H", pdu, 1)[0], pdu[3:])
            elif op == ATT_HANDLE_VALUE_IND:
                self._send(bytes([ATT_HANDLE_VALUE_CFM]))
                if self.on_notify:
                    self.on_notify(struct.unpack_from("<H", pdu, 1)[0], pdu[3:])
            elif op == ATT_EXCHANGE_MTU_REQ:  # au cas où le boîtier le demanderait
                self._send(struct.pack("<BH", ATT_EXCHANGE_MTU_RSP, 23))
            else:
                self._responses.put(pdu)
        self.connected = False

    def request(self, pdu: bytes, timeout: float = 2.0) -> bytes:
        while not self._responses.empty():
            self._responses.get_nowait()
        self._send(pdu)
        try:
            return self._responses.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError(f"pas de réponse à la requête 0x{pdu[0]:02x}") from None

    # -- opérations ATT ------------------------------------------------------------------
    def write_command(self, handle: int, value: bytes) -> None:
        self._send(struct.pack("<BH", ATT_WRITE_CMD, handle) + value)

    def write_request(self, handle: int, value: bytes, timeout: float = 2.0) -> None:
        rsp = self.request(struct.pack("<BH", ATT_WRITE_REQ, handle) + value, timeout)
        if rsp[0] != ATT_WRITE_RSP:
            raise RuntimeError("écriture refusée : " + rsp.hex(" "))

    def discover_characteristics(self, timeout: float = 2.0) -> list[tuple[int, int, int, str]]:
        """Liste (poignée décl., propriétés, poignée valeur, uuid). Le boîtier n'y répond
        pas quand bluetoothd est actif."""
        out, start = [], 0x0001
        while start <= 0xFFFF:
            rsp = self.request(struct.pack("<BHHH", ATT_READ_BY_TYPE_REQ, start, 0xFFFF, 0x2803), timeout)
            if rsp[0] == ATT_ERROR_RSP:
                break
            if rsp[0] != ATT_READ_BY_TYPE_RSP:
                raise RuntimeError("réponse inattendue : " + rsp.hex(" "))
            ln, last = rsp[1], start
            for i in range(2, len(rsp), ln):
                item = rsp[i:i + ln]
                decl, props, val = struct.unpack_from("<HBH", item)
                u = item[5:][::-1].hex()
                if len(u) == 32:
                    u = f"{u[:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:]}"
                out.append((decl, props, val, u))
                last = decl
            start = last + 1
        return out
