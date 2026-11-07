# Protocole BLE du boîtier « powerbox »

Chaque information est marquée selon son origine :

- **[vérifié]** : constaté sur le boîtier ;
- **[code]** : lu dans le code de l'appli Android, pas encore essayé sur le boîtier ;
- **[hypothèse]** : déduction à confirmer.

Appli de référence : `com.yundongjia.app.blocks_powerbox`, une appli Flutter (Dart 3.12.2) qui
utilise `flutter_blue_plus`.

## 1. Annonces (advertising)

| Élément | Valeur |
|---|---|
| Adresse | `22:01:01:27:0F:7D`, type **public** [vérifié] |
| Type d'annonce | `ADV_IND` (connectable) + `SCAN_RSP` [vérifié] |
| Flags | `0x05` (LE Limited Discoverable, BR/EDR non supporté) [vérifié] |
| Nom | `powerbox` (dans l'annonce et la réponse de scan) [vérifié] |
| UUID de service annoncé | aucun [vérifié] |
| Fonctions LE du contrôleur | seulement « LE Encryption » [vérifié] |

## 2. Table GATT

| Poignée | Contenu | Source |
|---|---|---|
| 0x0001–0x0004 | service 0x1801 (Generic Attribute) : Service Changed (INDICATE) + CCCD | [hypothèse] ordre vu dans nRF Connect |
| 0x0005–0x000b | service 0x1800 (Generic Access) : Device Name, Appearance, PPCP | [hypothèse] |
| 0x000c | service `0000ffa0-0002-1000-8000-00805f9b34fb` | [hypothèse] |
| 0x000d | déclaration de `…ffa2…` (NOTIFY, READ) | [hypothèse] |
| **0x000e** | **valeur de `ffa2` : trames d'état** | [vérifié] (notifications reçues) |
| 0x000f | CCCD de `ffa2` | [hypothèse] |
| 0x0010 | déclaration de `…ffa1…` (WRITE) | [hypothèse] |
| **0x0011** | **valeur de `ffa1` : commandes** | [vérifié] (les moteurs tournent) |

Attention, les UUID ne suivent pas la base Bluetooth standard : le 3ᵉ groupe vaut `0002` au lieu de
`0000`. Il faut donc toujours les écrire en entier (pas de raccourci `0xFFA1`).

### Particularité de la pile BLE du boîtier

- Il **ne répond jamais** à `Exchange MTU Request` (opcode 0x02) [vérifié avec btmon]. Le
  `bluetoothd` de BlueZ l'envoie systématiquement à la connexion, puis attend 30 s et coupe. Pendant
  ce temps, plus aucune requête ATT n'aboutit : découverte, lecture, Write Request (0x12).
- Il **accepte les Write Command** (opcode 0x52, sans réponse) sur 0x0011 même dans cette
  situation [vérifié].
- Il envoie une trame d'état sur 0x000e dès la connexion, sans qu'on ait activé les notifications
  [vérifié].
- Android (nRF Connect) découvre les services sans problème, et le boîtier y apparaît « BONDED »
  [vérifié]. Le code de l'appli n'exige pourtant ni appairage ni chiffrement [code].

## 3. Trame de commande (écriture sur `ffa1`)

16 octets [code + vérifié] :

| Index | Valeur | Rôle |
|---|---|---|
| 0 | `0xFC` | en-tête |
| 1 | `0x0F` | en-tête |
| 2 | `0x01` | en-tête |
| 3 | A | sortie A |
| 4 | B | sortie B |
| 5 | C | sortie C |
| 6 | D | sortie D |
| 7 | `0x00` | inutilisé |
| 8 | `0x00` | indicateur de direction, série N8 uniquement : 1 avant, 2 arrière, 3 gauche, 4 droite [code] |
| 9–14 | `0x00` | inutilisés |
| 15 | CS | `(octets 0..14 additionnés) & 0xFF` |

Codage d'une sortie, en signe + magnitude :

- bit 7 = sens ;
- bits 0–6 = vitesse de 0 à 127 ;
- `0x00` = arrêt. Le modèle de départ de l'appli met toutes les sorties à 0.

Valeurs utilisées par l'appli [code] :

| Valeur | Usage |
|---|---|
| `0x7F` / `0xFF` | plein régime dans un sens ou dans l'autre (blocs `motor_a1`/`motor_a2`…, avancer, reculer) |
| `0x60` / `0xE0` | vitesse 96 : virages en arc, une roue arrêtée et l'autre à 96 |

Commandes « voiture » de l'appli (moteurs de traction sur **A et D**) [code] :

Valeurs par défaut. Un paramètre interne (nommé `Esc` dans le code, sans doute « inverser le
sens ») échange `7F` et `FF`.

| Commande | A | D |
|---|---|---|
| avancer | `FF` | `FF` |
| reculer | `7F` | `7F` |
| gauche (sur place) | `7F` | `FF` |
| droite (sur place) | `FF` | `7F` |
| virages en arc | `00` et `E0`/`60` | ou l'inverse, selon le côté |

Exemples :

```
FC 0F 01 00 00 00 00 00 00 00 00 00 00 00 00 0C   tout arrêter
FC 0F 01 7F 00 00 00 00 00 00 00 00 00 00 00 8B   A = 0x7F
FC 0F 01 FF 00 00 00 00 00 00 00 00 00 00 00 0B   A = 0xFF
FC 0F 01 64 00 00 E4 00 00 00 00 00 00 00 00 54   A = +100, D = -100  [vérifié]
```

Renvoi périodique : l'appli utilise des minuteries côté Blockly, mais on ne sait pas si le boîtier
coupe les moteurs sans commande. Le script renvoie la trame toutes les 0,2 s par précaution.

## 4. Trame d'état (notifications sur `ffa2`, poignée 0x000e)

Seule trame observée, reçue à chaque connexion [vérifié] :

```
CA 01 04 00 00 00 00 00 00 00 00 00 00 CF 00 00
```

| Index | Valeur | Rôle |
|---|---|---|
| 0 | `CA` | en-tête |
| 1 | `01` | type ? |
| 2 | `04` | inconnu (niveau de batterie sur 4 ? nombre de sorties ?) [hypothèse] |
| 13 | `CF` | somme des octets 0..12 (`CA+01+04`) [hypothèse, cohérente avec la seule trame vue] |
| 14–15 | `00 00` | inconnus |

Dans l'appli, le traitement de ces trames est en `0x29cba4` (log « 蓝牙收到数据 », « données
Bluetooth reçues »). Il n'a pas été analysé.

## 5. Séries de produits dans l'appli

L'appli gère 17 « séries » : N8, N7, L2, L, R, M2, MP, K, F, E, D, C, B, M, N3, N, A. Chacune associe :

- une classe de commande **BLE**, connexion GATT comme ci-dessus ;
- une classe de commande **diffusion**, sans connexion, par annonces BLE (voir §6).

| Série | Classe BLE | Classe diffusion |
|---|---|---|
| N8 | DE (+ octet 8 = indicateur) | BE |
| N7, M2, N3 | xE | BE |
| L2 | xE | EE |
| L | xE | IE |
| MP | xE | CE |
| F, D, M, A | xE | HE |
| R | FE | GE |
| K, E, C, B, N | FE | BE |

Les trois classes BLE (DE, FE, xE) partagent la même trame (`FC 0F 01 …`) et la même affectation
A→3, B→4, C→5, D→6 [code]. Le modèle exact de ton boîtier n'a pas d'importance tant qu'il est en
mode BLE.

Logique de connexion de l'appli [code] :

1. elle cherche d'abord un appareil BLE (« 先尝试蓝牙连接 BLE », « essayer d'abord la connexion
   BLE ») et s'y connecte si elle le trouve ;
2. sinon, après expiration du délai de recherche, elle passe en mode diffusion (« 降级广播连接 »,
   « repli sur la connexion par diffusion »), sauf pour les séries « BLE-only ».

## 6. Mode diffusion (non utilisé ici)

[code, non vérifié]

- Le Dart envoie la trame de la classe « diffusion » à un plugin Android par le canal
  `bluetooth_advertise` (méthodes `start` avec un `type`, `stop`, `sendCommand`).
- Le plugin appelle la bibliothèque native `libble.so`,
  `com.example.nirjon.bledemo4_advertising.util.BLEUtil.get_rf_payload(addr, addrLen, data, dataLen, out)`,
  puis diffuse le résultat dans une annonce BLE.
- `libble.so` exporte `check_crc16`, `whitening_init`, `whitenging_encode` (sic), `invert_8` et
  `invert_16`. C'est la même famille que le protocole des boîtiers Mould King : une trame
  nRF24/XN297 déguisée en annonce BLE, avec le « blanchiment » BLE compensé à l'avance. Voir
  l'implémentation Espruino `mouldking.js` pour un équivalent.
- Les classes « diffusion » (BE, HE…) utilisent un autre codage. Par exemple, HE met l'octet 3 à
  `0x70 | vitesse` ou `0xF0 | vitesse`. Ce mode n'a pas été décodé plus loin.
- Valeurs de configuration par défaut trouvées dans l'appli : `powerbox`, `BLOCK_BLUE_PLUS`, et les
  UUID `ffa1`/`ffa2`.
