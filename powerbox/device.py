"""Classe haut niveau pour piloter le boîtier."""
from __future__ import annotations

import threading
import time
from typing import Callable

from . import protocol as P
from .att import AttConnection, BDADDR_LE_PUBLIC

DEFAULT_ADDRESS = "22:01:01:27:0F:7D"


class PowerBox:
    """Pilote du boîtier « powerbox ».

    >>> with PowerBox() as box:
    ...     box.set(a=100, d=-100)
    ...     time.sleep(2)
    ...     box.stop()
    """

    def __init__(self, address: str = DEFAULT_ADDRESS, handle: int = P.WRITE_HANDLE,
                 with_response: bool = False, keepalive: float = 0.2,
                 on_status: Callable[[P.Status], None] | None = None,
                 addr_type: int = BDADDR_LE_PUBLIC, verbose: bool = False):
        self.handle = handle
        self.with_response = with_response
        self.keepalive = keepalive
        self.on_status = on_status
        self.verbose = verbose
        self.speeds = {"a": 0, "b": 0, "c": 0, "d": 0}
        self.indicator = 0
        self.last_status: P.Status | None = None
        self._lock = threading.Lock()
        self._stop_evt = threading.Event()
        self._ka_thread: threading.Thread | None = None
        self.conn = AttConnection(address, addr_type, on_notify=self._on_notify, verbose=verbose)

    # -- cycle de vie -----------------------------------------------------------------
    def connect(self, timeout: float = 15.0) -> "PowerBox":
        self.conn.connect(timeout)
        self.send_current()
        if self.keepalive and self.keepalive > 0:
            self._stop_evt.clear()
            self._ka_thread = threading.Thread(target=self._keepalive_loop, daemon=True)
            self._ka_thread.start()
        return self

    def close(self) -> None:
        self._stop_evt.set()
        try:
            if self.conn.connected:
                self.speeds = dict.fromkeys(self.speeds, 0)
                self.indicator = 0
                self.send_current()
        finally:
            self.conn.close()

    @property
    def connected(self) -> bool:
        return self.conn.connected

    def __enter__(self):
        return self.connect()

    def __exit__(self, *exc):
        self.close()

    # -- commandes ----------------------------------------------------------------------
    def frame(self) -> bytes:
        return P.build_frame(**self.speeds, indicator=self.indicator)

    def send_frame(self, frame: bytes) -> None:
        with self._lock:
            if self.with_response:
                try:
                    self.conn.write_request(self.handle, frame)
                    return
                except TimeoutError:
                    if self.verbose:
                        print("  pas de réponse : passage en Write Command")
                    self.with_response = False
            self.conn.write_command(self.handle, frame)

    def send_current(self) -> None:
        self.send_frame(self.frame())

    def set(self, a: int | None = None, b: int | None = None,
            c: int | None = None, d: int | None = None) -> None:
        """Règle une ou plusieurs sorties (-127..127) et envoie la trame."""
        for k, v in (("a", a), ("b", b), ("c", c), ("d", d)):
            if v is not None:
                self.speeds[k] = int(v)
        self.send_current()

    def motor(self, name: str, speed: int) -> None:
        self.set(**{name.lower(): speed})

    def stop(self) -> None:
        self.speeds = dict.fromkeys(self.speeds, 0)
        self.send_current()

    # -- interne ------------------------------------------------------------------------
    def _keepalive_loop(self) -> None:
        while not self._stop_evt.wait(self.keepalive):
            if not self.conn.connected:
                break
            try:
                self.send_current()
            except OSError:
                break

    def _on_notify(self, handle: int, value: bytes) -> None:
        st = P.parse_status(value)
        if st:
            self.last_status = st
            if self.on_status:
                self.on_status(st)
        elif self.verbose:
            print(f"  notification 0x{handle:04x} : {value.hex(' ')}")
