"""Faux boîtier : même interface que PowerBox, mais affiche les vitesses au lieu de les envoyer.

Pratique pour essayer un programme sans le boîtier (ou sans Bluetooth).
"""
from __future__ import annotations

from . import protocol as P


class SimulatedPowerBox:
    def __init__(self, verbose: bool = True, **_ignored):
        self.verbose = verbose
        self.speeds = {"a": 0, "b": 0, "c": 0, "d": 0}
        self.indicator = 0
        self.last_status = None
        self.connected = False
        self._last_shown: dict | None = None

    def connect(self, timeout: float = 0) -> "SimulatedPowerBox":
        self.connected = True
        return self

    def close(self) -> None:
        self.stop()
        self.connected = False

    def __enter__(self):
        return self.connect()

    def __exit__(self, *exc):
        self.close()

    def frame(self) -> bytes:
        return P.build_frame(**self.speeds, indicator=self.indicator)

    def send_frame(self, frame: bytes) -> None:
        d = P.parse_frame(frame)
        self.speeds = {m: d[m] for m in "abcd"}
        self._show()

    def set(self, a=None, b=None, c=None, d=None) -> None:
        for k, v in (("a", a), ("b", b), ("c", c), ("d", d)):
            if v is not None:
                self.speeds[k] = max(-P.MAX_SPEED, min(P.MAX_SPEED, int(v)))
        self._show()

    def motor(self, name: str, speed: int) -> None:
        self.set(**{name.lower(): speed})

    def stop(self) -> None:
        self.speeds = dict.fromkeys(self.speeds, 0)
        self._show()

    def _show(self) -> None:
        if not self.verbose or self.speeds == self._last_shown:
            return
        self._last_shown = dict(self.speeds)
        parts = []
        for m, v in self.speeds.items():
            pct = round(v * 100 / P.MAX_SPEED)
            parts.append(f"{m.upper()}={pct:+d}%" if pct else f"{m.upper()}=0")
        print("   ⚙  " + "  ".join(parts), flush=True)
