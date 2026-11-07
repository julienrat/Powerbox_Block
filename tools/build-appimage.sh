#!/usr/bin/env bash
# Construit dist/PowerBox-x86_64.AppImage : un seul fichier, Python 3.12 embarqué, rien à installer.
#
#   tools/build-appimage.sh
#
# Télécharge (une fois, dans build/appimage-cache/) :
#   - un Python « AppImage » prêt à l'emploi : https://github.com/niess/python-appimage
#   - appimagetool : https://github.com/AppImage/appimagetool
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$RACINE/build/appimage-cache"
APPDIR="$RACINE/build/PowerBox.AppDir"
DIST="$RACINE/dist"
SORTIE="$DIST/PowerBox-x86_64.AppImage"
SERIE=3.12
mkdir -p "$CACHE" "$DIST"

# --- 1. Python embarqué ------------------------------------------------------------------
PY_AI="$(ls "$CACHE"/python${SERIE}.*-manylinux2014_x86_64.AppImage 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$PY_AI" ]; then
  echo "→ recherche du Python $SERIE AppImage…"
  URL="$(curl -fsSL "https://api.github.com/repos/niess/python-appimage/releases/tags/python$SERIE" |
    python3 -c 'import json,sys
for a in json.load(sys.stdin)["assets"]:
    n = a["name"]
    if "manylinux2014_x86_64" in n and n.endswith(".AppImage"):
        print(a["browser_download_url"]); break')"
  PY_AI="$CACHE/$(basename "$URL")"
  curl -fL --progress-bar -o "$PY_AI" "$URL"
fi
chmod +x "$PY_AI"
echo "→ Python : $(basename "$PY_AI")"

# --- 2. appimagetool ---------------------------------------------------------------------
OUTIL="$CACHE/appimagetool-x86_64.AppImage"
if [ ! -f "$OUTIL" ]; then
  echo "→ téléchargement d'appimagetool…"
  curl -fL --progress-bar -o "$OUTIL" \
    https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
fi
chmod +x "$OUTIL"

# --- 3. AppDir ---------------------------------------------------------------------------
echo "→ préparation de l'AppDir…"
rm -rf "$APPDIR" "$CACHE/squashfs-root"
(cd "$CACHE" && "$PY_AI" --appimage-extract >/dev/null)
mv "$CACHE/squashfs-root" "$APPDIR"

LIB="$APPDIR/opt/python$SERIE/lib/python$SERIE"
# on retire ce qui ne sert pas (Tk, IDLE, pip, démos, fichiers du Python d'origine)
rm -rf "$LIB"/{idlelib,tkinter,turtledemo,ensurepip} "$LIB"/lib-dynload/_tkinter* \
       "$LIB"/site-packages/pip* "$APPDIR"/usr/share/tcltk "$APPDIR"/usr/lib/libt{cl,k}* \
       "$APPDIR"/usr/bin/pip* "$APPDIR"/*.desktop "$APPDIR"/python.png "$APPDIR"/.DirIcon \
       "$APPDIR"/usr/share/metainfo "$APPDIR"/AppRun
find "$APPDIR" -name __pycache__ -prune -exec rm -rf {} +

# notre paquet
cp -r "$RACINE/powerbox" "$LIB/site-packages/powerbox"
find "$LIB/site-packages/powerbox" -name __pycache__ -prune -exec rm -rf {} +
"$APPDIR/opt/python$SERIE/bin/python$SERIE" -m compileall -q "$LIB/site-packages/powerbox" >/dev/null

# lanceur, raccourci, icône
install -m 755 "$RACINE/tools/appimage/AppRun" "$APPDIR/AppRun"
cp "$RACINE/tools/appimage/powerbox.desktop" "$RACINE/tools/appimage/powerbox.svg" "$APPDIR/"
cp "$APPDIR/powerbox.svg" "$APPDIR/.DirIcon"

# lisible par tous les utilisateurs de la machine (certains dossiers sortent en 0700)
chmod -R a+rX "$APPDIR"

# vérification rapide avant d'empaqueter
"$APPDIR/AppRun" python -c "import powerbox.serveur, powerbox.facile; print('→ paquet importé, version', powerbox.__version__)"

# --- 4. AppImage -------------------------------------------------------------------------
echo "→ construction de $(basename "$SORTIE")…"
ARCH=x86_64 "$OUTIL" --appimage-extract-and-run --no-appstream "$APPDIR" "$SORTIE" >/dev/null
echo "✅ $SORTIE ($(du -h "$SORTIE" | cut -f1))"
