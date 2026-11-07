#!/usr/bin/env python3
"""Petit outil d'analyse d'un libapp.so Flutter (arm64) à partir d'une sortie Blutter.

Pré-requis : pip install capstone pyelftools
             + une sortie Blutter produite avec tools/blutter-dispatch-dump.patch
               (fichiers pp.txt, ida_script/addNames.py, dispatch.txt, classes.txt)

Exemples :
  dart_re.py --lib lib/arm64-v8a/libapp.so --out re-out index          # à faire une fois
  dart_re.py ... refs "sendCommand"           # code qui charge une chaîne du pool
  dart_re.py ... dis 0x24b6b0                 # désassemblage annoté d'une fonction
  dart_re.py ... callers 0x4150f8             # appels directs (bl) vers une adresse
  dart_re.py ... sel 0xe60 1334 1336 1340     # cible d'un appel virtuel pour des classes
  dart_re.py ... cls FE                       # chercher une classe par nom

Repères Dart AOT arm64 : x15 = pile Dart, x26 = THR, x27 = PP (pool d'objets),
x28 = base du tas (pointeurs compressés), x21 = table de répartition, x22 = null,
true = null+0x20 / false = null+0x30 (bit 4), entier Smi = valeur << 1,
élément i d'une liste = [tableau, #0xf + 4*i], champ statique = [THR.field_table, #off*2].
Appel virtuel : cid = bits 12..31 de l'en-tête ; cible = dispatch[cid + sélecteur].
"""
import argparse
import bisect
import os
import pickle
import re
import sys

import capstone
from elftools.elf.elffile import ELFFile


class Ctx:
    def __init__(self, lib, out):
        self.out = out
        self.f = open(lib, "rb")
        self.elf = ELFFile(self.f)
        self.segs = [(s["p_vaddr"], s["p_offset"], s["p_filesz"])
                     for s in self.elf.iter_segments() if s["p_type"] == "PT_LOAD"]
        self.md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
        self.md.skipdata = True
        self.names = {}
        p = os.path.join(out, "ida_script", "addNames.py")
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                m = re.match(r'idaapi\.set_name\((0x[0-9a-f]+), "(.*)"\)', line)
                if m and not m.group(2).endswith("_check"):
                    self.names[int(m.group(1), 16)] = m.group(2)
        self.pp = {}
        for line in open(os.path.join(out, "pp.txt"), encoding="utf-8"):
            m = re.match(r"\[pp\+(0x[0-9a-f]+)\] (.*)", line)
            if m:
                self.pp[int(m.group(1), 16)] = m.group(2)[:120]
        self.index_path = os.path.join(out, "re_index.pkl")
        self.refs, self.prologues, self.calls = ({}, [], {})
        if os.path.exists(self.index_path):
            self.refs, self.prologues, self.calls = pickle.load(open(self.index_path, "rb"))
        self.starts = sorted(set(self.names) | set(self.prologues))

    def read(self, va, n):
        for v, o, sz in self.segs:
            if v <= va < v + sz:
                self.f.seek(o + va - v)
                return self.f.read(min(n, v + sz - va))
        raise ValueError(hex(va))

    def text(self):
        t = [s for s in self.elf.iter_sections() if s.name == ".text"][0]
        return t["sh_addr"], self.read(t["sh_addr"], t["sh_size"])

    def func_of(self, a):
        i = bisect.bisect_right(self.prologues, a)
        return self.prologues[i - 1] if i else None


def cmd_index(c, _):
    va, data = c.text()
    refs, pro, calls, base = {}, [], {}, {}
    for a, sz, mn, ops in c.md.disasm_lite(data, va):
        if mn == "stp" and ops in ("x29, x30, [x15, #-0x10]!", "x29, x30, [sp, #-0x10]!"):
            pro.append(a)
        m = re.match(r"(x\d+), x27, #(0x[0-9a-f]+|\d+), lsl #12", ops)
        if mn == "add" and m:
            base[m.group(1)] = int(m.group(2), 0) << 12
        elif mn in ("ldr", "ldur"):
            m = re.match(r"[xw]\d+, \[(x\d+), #(0x[0-9a-f]+|\d+)\]", ops)
            if m:
                b, off = m.group(1), int(m.group(2), 0)
                if b == "x27":
                    refs.setdefault(off, []).append(a)
                elif b in base:
                    refs.setdefault(base[b] + off, []).append(a)
        elif mn == "bl":
            calls.setdefault(int(ops.lstrip("#"), 16), []).append(a)
    pickle.dump((refs, sorted(pro), calls), open(c.index_path, "wb"))
    print(f"index : {len(refs)} entrées du pool référencées, {len(pro)} fonctions, {len(calls)} cibles d'appel")


def cmd_dis(c, args):
    for spec in args.addr:
        addr, _, ln = spec.partition(":")
        addr = int(addr, 16)
        i = bisect.bisect_right(c.starts, addr)
        end = c.starts[i] if i < len(c.starts) else addr + 0x400
        if ln:
            end = addr + int(ln, 16)
        print(f"===== {c.names.get(addr, hex(addr))}  [{addr:#x}..{end:#x}]")
        base = {}
        for ins in c.md.disasm(c.read(addr, end - addr), addr):
            ops, note = ins.op_str, ""
            m = re.match(r"(x\d+), x27, #(0x[0-9a-f]+|\d+), lsl #12", ops)
            if ins.mnemonic == "add" and m:
                base[m.group(1)] = int(m.group(2), 0) << 12
            m = re.match(r"[xw]\d+, \[(x\d+), #(0x[0-9a-f]+|\d+)\]", ops)
            if ins.mnemonic in ("ldr", "ldur") and m:
                b, off = m.group(1), int(m.group(2), 0)
                if b == "x27":
                    note = f"PP[{off:#x}] {c.pp.get(off, '?')}"
                elif b in base:
                    note = f"PP[{base[b] + off:#x}] {c.pp.get(base[b] + off, '?')}"
            if ins.mnemonic in ("bl", "b"):
                t = int(ops.lstrip("#"), 16)
                note = c.names.get(t, "")
            m = re.match(r"[xw]\d+, #(0x[0-9a-f]+|\d+)$", ops)
            if ins.mnemonic in ("mov", "movz") and m:
                v = int(m.group(1), 0)
                note = f"Smi {v >> 1}" if v % 2 == 0 else ""
            print(f"  {ins.address:#08x}: {ins.mnemonic:8s} {ops:40s} {'; ' + note if note else ''}")


def cmd_refs(c, args):
    q = args.query
    offs = [int(q, 16)] if re.fullmatch(r"0x[0-9a-f]+", q) else [o for o, t in c.pp.items() if q in t]
    for o in offs:
        for a in c.refs.get(o, []):
            f = c.func_of(a)
            print(f"PP[{o:#x}] {c.pp.get(o, '')[:60]!s:60s}  utilisé en {a:#x}  (fonction {f:#x} {c.names.get(f, '')})")


def cmd_callers(c, args):
    t = int(args.addr, 16)
    for a in c.calls.get(t, []):
        f = c.func_of(a)
        print(f"{a:#x}  dans {f:#x} {c.names.get(f, '')}")


def _tables(c):
    D, C = {}, {}
    for line in open(os.path.join(c.out, "dispatch.txt")):
        i, v = line.split()
        D[int(i)] = int(v, 16)
    for line in open(os.path.join(c.out, "classes.txt"), encoding="utf-8"):
        m = re.match(r"(\d+) (.*)", line.strip())
        if m:
            C[int(m.group(1))] = m.group(2)
    return D, C


def cmd_sel(c, args):
    D, C = _tables(c)
    s = int(args.selector, 0)
    for cid in args.cids:
        cid = int(cid, 0)
        t = D.get(cid + s, 0)
        print(f"cid {cid:5d} {C.get(cid, '?')[:70]:70s} -> {t:#x} {c.names.get(t, '')}")


def cmd_cls(c, args):
    _, C = _tables(c)
    for cid, txt in sorted(C.items()):
        if re.search(rf"Class: {re.escape(args.name)}\b", txt):
            print(cid, txt)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lib", required=True, help="chemin de libapp.so")
    p.add_argument("--out", required=True, help="dossier de sortie Blutter (patché)")
    sp = p.add_subparsers(dest="cmd", required=True)
    sp.add_parser("index")
    d = sp.add_parser("dis"); d.add_argument("addr", nargs="+", help="0xADDR ou 0xADDR:0xLONGUEUR")
    r = sp.add_parser("refs"); r.add_argument("query", help="texte d'une entrée du pool, ou 0xOFFSET")
    k = sp.add_parser("callers"); k.add_argument("addr")
    s = sp.add_parser("sel"); s.add_argument("selector"); s.add_argument("cids", nargs="+")
    n = sp.add_parser("cls"); n.add_argument("name")
    a = p.parse_args()
    c = Ctx(a.lib, a.out)
    if a.cmd != "index" and not c.prologues:
        sys.exit("lance d'abord la sous-commande « index »")
    {"index": cmd_index, "dis": cmd_dis, "refs": cmd_refs, "callers": cmd_callers,
     "sel": cmd_sel, "cls": cmd_cls}[a.cmd](c, a)


if __name__ == "__main__":
    main()
