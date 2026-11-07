# Rétro-ingénierie : comment le protocole a été retrouvé

Ce document permet de reprendre l'analyse : lumières, son, mode diffusion, trame d'état…

## 1. Observation du boîtier

| Outil | Résultat |
|---|---|
| `bluetoothctl` / blueman | appareil LE `powerbox`, `22:01:01:27:0F:7D`, connectable, sans appairage |
| bleak (Python) | connexion OK puis `TimeoutError` pendant la découverte des services |
| `sudo btmon` | après la connexion, bluetoothd envoie `ATT Exchange MTU Request (517)` ; **aucune réponse** ; déconnexion locale 32 s plus tard |
| `gatttool -I` | `connect` OK (une notification arrive sur 0x000e : `ca 01 04 … cf 00 00`), puis `primary`, `characteristics` et `char-desc` échouent |
| nRF Connect (Android) | services visibles : `ffa0` avec `ffa2` (NOTIFY, READ) et `ffa1` (WRITE) |

Conclusion : la pile ATT du boîtier ne gère pas l'échange de MTU. BlueZ attend sa réponse pour
toujours, alors qu'Android ne fait pas cet échange par défaut.

**esp-sdr** (ESPARGOS) a été envisagé pour intercepter les trames, puis écarté. Il ne fait que de la
réception, par rafales d'environ 200 µs séparées par des trous, et n'a pas de démodulateur BLE.
Il aurait fallu une clé nRF52840 avec nRF Sniffer et Wireshark.

## 2. L'APK

Les fichiers sont dans `~/Téléchargements/powerbrick/` : `powerbox.apk` et la décompilation jadx
dans `decompile/`.

```bash
jadx -d decompile powerbox.apk      # jadx 1.5.6 (Java 11+) ; « finished with errors » est normal
```

- Paquet `com.yundongjia.app.blocks_powerbox`. Le Java ne contient presque rien
  (`MainActivity extends FlutterActivity`) : c'est une appli **Flutter**.
- `resources/lib/arm64-v8a/` contient :
  - `libapp.so` : le code Dart compilé à l'avance (AOT), environ 4,9 Mo ;
  - `libflutter.so` : le moteur Flutter ;
  - `libble.so` : bibliothèque native qui exporte `get_rf_payload`, `check_crc16`, `whitening_*`
    et `invert_*` (mode diffusion de type Mould King).
- `resources/assets/flutter_assets/assets/html/` contient l'éditeur Blockly (blocs `motor_a1`…,
  `control_forward`…). C'est seulement l'interface : le programme est exporté en XML et exécuté côté
  Dart.
- Un `strings` sur `libapp.so` donne les UUID `ffa1`/`ffa2`, `sendCommand`, `setSpeed`,
  `motor_a1..d2` et les logs chinois.

## 3. Décompiler le Dart avec Blutter

[Blutter](https://github.com/worawit/blutter) recompile la machine virtuelle Dart de la bonne version
et relit le snapshot de l'appli.

L'appli utilise **Dart 3.12.2**, détecté automatiquement depuis `libflutter.so`. Le snapshot a les
options `product`, `compressed-pointers` et `dedup_instructions`, et les noms de classes et de
méthodes sont obfusqués.

Dépendances sous Debian/Ubuntu/Mint : `python3-pyelftools python3-requests git cmake ninja-build
build-essential pkg-config libicu-dev libcapstone-dev`, avec g++ ≥ 13.

```bash
git clone https://github.com/worawit/blutter && cd blutter
git apply ~/Developpement/powerbox/tools/blutter-dispatch-dump.patch   # voir ci-dessous
python3 blutter.py ~/Téléchargements/powerbrick/decompile/resources/lib/arm64-v8a ~/Developpement/powerbox/re-out
```

Avec cette version de Dart, Blutter n'écrit le corps que d'une petite partie des fonctions. Les
autres apparaissent avec `size: -0x1`. Ce qu'il fournit quand même :

- `pp.txt`, le **pool d'objets** : chaînes, constantes, champs ;
- `ida_script/addNames.py` : les adresses de nombreuses fonctions et fermetures (closures).

**Le patch `tools/blutter-dispatch-dump.patch`** ajoute deux fichiers de sortie :

- `dispatch.txt` : la **table de répartition** Dart (index → adresse de la fonction) ;
- `classes.txt` : l'identifiant de chaque classe (cid), son nom et sa super-classe.

Sans eux, on ne peut pas savoir quelle fonction est appelée lors d'un appel virtuel.

## 4. Analyse avec `tools/re/dart_re.py`

```bash
pip install capstone pyelftools
T="python3 tools/re/dart_re.py --lib ~/Téléchargements/powerbrick/decompile/resources/lib/arm64-v8a/libapp.so --out re-out"
$T index                       # une fois
$T refs "发送数据BLE"           # où une chaîne est utilisée
$T dis 0x24b6b0                # désassemblage annoté (pool, appels, entiers Smi)
$T callers 0x4150f8            # appels directs
$T sel 0xe60 1334 1336 1340    # cible de l'appel virtuel (sélecteur 0xe60) pour ces classes
$T cls FE                      # cid d'une classe
```

Repères de l'assembleur Dart AOT arm64 :

| Registre ou convention | Rôle |
|---|---|
| `x15` | pile Dart (`SP` chez Blutter) ; prologue `stp x29, x30, [x15, #-0x10]!` |
| `x26` | THR : thread courant ; `[x26,#0x78]` = table des champs statiques |
| `x27` | PP : pool d'objets ; `ldr xN, [x27, #off]` = `pp.txt[off]` |
| `x28` | base du tas (pointeurs compressés sur 32 bits) |
| `x21` | table de répartition ; appel virtuel = `ldr x30, [x21, (cid + sélecteur) << 3]` |
| `x22` | `null` ; `true` = `null+0x20`, `false` = `null+0x30` (test sur le bit 4) |
| entiers Smi | valeur décalée d'un bit (`mov x2, #6` = 3) |
| élément `i` d'une liste | `[tableau, #0xf + 4*i]` |
| identifiant de classe (cid) | `ubfx x0, x0, #0xc, #0x14` sur l'en-tête de l'objet |

## 5. Chemin suivi dans le code

| Adresse | Rôle |
|---|---|
| `0x2a8098` | exécution Blockly (`playClickAction`). Pour chaque bloc : `AE._data.<méthode>()` renvoie la trame, puis `sendCommand(trame)`. Sélecteurs : `control_forward` −0xfbe, `control_backward` +0x779, `control_left` −0xfec, `control_right` −0xfdd, `motor_a*` +0xe60, `motor_b*` +0xcd8, `motor_c*` +0xdc2, `motor_d*` +0xe2c |
| `0x24b6b0` | `sendCommand(data)` : copie la liste ; si le transport est la classe `jE` (cid 1559, diffusion), envoi par le canal `bluetooth_advertise`, sinon appel virtuel vers le transport BLE |
| `0x49e2d4` | `iE.sendCommand` (cid 1560, BLE) → `0x49d968` (« 发送数据BLE=== », « envoi des données BLE ») → `0x49db84` → écriture `flutter_blue_plus` |
| `0x29cecc…0x29d394` | constructeurs des 17 séries (N8, N7, L2…, A), chacun appelant `0x298468` |
| `0x298468` | initialisation de la page : sélecteur 0x666d → objet « diffusion » (champ statique `0x16a0`), sélecteur 0x68e9 → objet « BLE » (`0x16a8`) |
| `0x2ab6e8` | choix de l'objet commande selon le mode : `Ble` → `0x16a8` (xE par défaut), `BroadCast` → `0x16a0` (BE par défaut) ; stocké dans `AE._data` (`0x1698`) |
| `0x254c18` / `0x254d54` | constructeurs DE/FE et xE : **modèle `[FC, 0F, 01, 0×13]`** (liste de 16) |
| `0x4150f8` | `setByte(i, v)` : `data[i] = v & 0xFF`, puis `data[15] = somme(data[0..14]) & 0xFF` |
| `0x3986b4` / `0x3986f4` / `0x398784` | moteur A pour xE / DE / FE : `setByte(3, vrai ? 0x7F : 0xFF)` |
| `0x39fb40…`, `0x39c47c…`, `0x39a42c…` | moteurs B, C, D : octets 4, 5, 6 |
| `0x412ab8`, `0x412e10`, `0x413050` | avancer (xE, DE, FE) : octets 3 et 6, DE met aussi l'octet 8 à 1 |

Classes de commande (cid) : `yE` 1330 (base), `IE` 1331, `HE` 1332, `GE` 1333, `FE` 1334, `EE` 1335,
`DE` 1336, `CE` 1337, `BE` 1338, `zE` 1339, `xE` 1340. Transports : `_lz` 1558, `jE` 1559
(diffusion), `iE` 1560 (BLE). Les cid des séries vont de 2600 à 2618.

## 6. Pistes non explorées

- `0x29cba4` : traitement des trames d'état reçues.
- Méthodes de vitesse proportionnelle (`setSpeed`, curseur « 命令 level = … v = … », « commande
  niveau = … »), aux adresses `0x379658` et `0x37ab04`.
- Classes « diffusion » (BE, HE, EE…) et plugin Java `bluetooth_advertise`, obfusqué dans
  `decompile/sources/`. Chercher `get_rf_payload` ou `bluetooth_advertise`.
- Lumières et sons (icônes `light_front`, `light_back`, `sound_*` dans l'appli).
