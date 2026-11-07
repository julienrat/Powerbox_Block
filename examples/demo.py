#!/usr/bin/env python3
"""Petite démo : chaque sortie tourne dans un sens puis dans l'autre, puis montée en vitesse.

    cd ~/Developpement/powerbox
    python3 examples/demo.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from powerbox import PowerBox  # noqa: E402

with PowerBox(on_status=lambda st: print("  ", st)) as box:
    for m in "abcd":
        for speed in (80, -80):
            print(f"sortie {m.upper()} à {speed:+d}")
            box.motor(m, speed)
            time.sleep(1.5)
        box.motor(m, 0)

    print("rampe sur A")
    for v in range(0, 128, 8):
        box.set(a=v)
        time.sleep(0.2)
    box.stop()
print("fini")
