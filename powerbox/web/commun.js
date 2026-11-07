/* Partagé par les deux pages (Blocs et Petits) : stockage, réglages, sons, liaison au boîtier. */
'use strict';

const $ = (s) => document.querySelector(s);
const MOTEURS = ['A', 'B', 'C', 'D'];
const COULEUR_MOTEUR = { A: '#FF5A5F', B: '#3B8BFF', C: '#FFB400', D: '#1FAF6B' };

// --- stockage local (protégé : peut être indisponible) -------------------------------------
const stock = {
  lire(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* tant pis */ } },
};

// --- Réglages du robot ------------------------------------------------------------------
const REGLAGES_DEFAUT = { gauche: 'A', droite: 'D', invG: false, invD: false };
const reglages = { ...REGLAGES_DEFAUT, ...stock.lire('pb-reglages', {}) };

// sens « avant » de chaque roue : -1 par défaut (comme l'appli du boîtier), +1 si inversée
const sensRoue = (inv) => (inv ? 1 : -1);

// --- Petits messages ----------------------------------------------------------------------
let toastTimer;
function toast(texte, type = 'info') {
  const t = $('#toast');
  t.textContent = texte;
  t.className = 'visible ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), type === 'erreur' ? 6000 : 3000);
}

// --- Sons ---------------------------------------------------------------------------------
const FREQ = { do: 261.6, re: 293.7, mi: 329.6, fa: 349.2, sol: 392.0, la: 440.0, si: 493.9, do2: 523.3 };
let audio;
function jouerNote(note, secondes) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = 'triangle';
    o.frequency.value = FREQ[note] || 440;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.08, secondes));
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + Math.max(0.1, secondes) + 0.05);
  } catch { /* pas de son */ }
}

// =========================================================================================
// Liaison avec le boîtier : par le serveur Python, en Bluetooth direct, ou simulation seule
// =========================================================================================
const SERVICE_UUID = '0000ffa0-0002-1000-8000-00805f9b34fb';
const WRITE_UUID = '0000ffa1-0002-1000-8000-00805f9b34fb';

function trame(v) {                 // même trame que powerbox/protocol.py
  const f = new Uint8Array(16);
  f.set([0xFC, 0x0F, 0x01]);
  MOTEURS.forEach((m, i) => {
    const s = Math.round(Math.max(-100, Math.min(100, v[m] || 0)) * 127 / 100);
    f[3 + i] = (s < 0 ? 0x80 : 0) | Math.abs(s);
  });
  f[15] = f.slice(0, 15).reduce((a, b) => a + b, 0) & 0xFF;
  return f;
}

const liaison = {
  mode: 'recherche',      // 'serveur' | 'bluetooth' | 'local' | 'recherche'
  vitesses: { A: 0, B: 0, C: 0, D: 0 },   // dernières vitesses envoyées (%)
  surChangement() {},     // remplacé par chaque page pour afficher l'état de la connexion
  etat: null,             // dernier état renvoyé par le serveur
  _aEnvoyer: null,
  _occupe: false,
  _bt: null,

  demarrer() {
    this.sonder();
    setInterval(() => this.sonder(), 1000);
  },

  async sonder() {
    if (this.mode === 'bluetooth') return;
    try {
      const r = await fetch('api/etat', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      this.etat = await r.json();
      this.mode = 'serveur';
    } catch {
      this.mode = 'local';
      this.etat = null;
    }
    this.surChangement();
  },

  envoyer(vitesses) {
    this.vitesses = { ...vitesses };
    if (this.mode === 'bluetooth') return this._envoyerBt(vitesses);
    if (this.mode !== 'serveur') return;
    this._aEnvoyer = { ...vitesses };
    if (!this._occupe) this._vider();
  },

  async _vider() {                  // on n'envoie que la dernière valeur si ça va trop vite
    this._occupe = true;
    while (this._aEnvoyer) {
      const v = this._aEnvoyer;
      this._aEnvoyer = null;
      try {
        const r = await fetch('api/moteurs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v),
        });
        this.etat = await r.json();
      } catch {
        this.mode = 'local';
        this.surChangement();
      }
    }
    this._occupe = false;
  },

  // -- Bluetooth direct (Web Bluetooth : Chrome / Edge, Android, ChromeOS…) --
  async connecterBluetooth() {
    if (!navigator.bluetooth) {
      toast('Ce navigateur ne sait pas faire de Bluetooth. Essaie Chrome.', 'erreur');
      return;
    }
    try {
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'powerbox' }], optionalServices: [SERVICE_UUID],
      });
      toast('Connexion à ' + dev.name + '…');
      const gatt = await dev.gatt.connect();
      const carac = await (await gatt.getPrimaryService(SERVICE_UUID)).getCharacteristic(WRITE_UUID);
      this._bt = { dev, carac, occupe: false, derniere: trame(this.vitesses) };
      dev.addEventListener('gattserverdisconnected', () => {
        clearInterval(this._bt?.timer);
        this._bt = null;
        this.mode = 'recherche';
        toast('Bluetooth déconnecté', 'erreur');
        this.sonder();
      });
      this._bt.timer = setInterval(() => this._ecrireBt(), 200);   // renvoi régulier
      this.mode = 'bluetooth';
      this.surChangement();
      toast('✅ Connecté en Bluetooth direct !', 'ok');
    } catch (e) {
      if (e.name !== 'NotFoundError') toast('Bluetooth : ' + e.message, 'erreur');
    }
  },

  _envoyerBt(vitesses) {
    if (!this._bt) return;
    this._bt.derniere = trame(vitesses);
    this._ecrireBt();
  },

  async _ecrireBt() {
    const bt = this._bt;
    if (!bt || bt.occupe) return;
    bt.occupe = true;
    try { await bt.carac.writeValueWithoutResponse(bt.derniere); } catch { /* on réessaiera */ }
    bt.occupe = false;
  },

  deconnecterBluetooth() {
    if (this._bt) this._bt.dev.gatt.disconnect();
  },
};

// -- bouton Connecter : par le serveur (Linux) ou, sans serveur, en Web Bluetooth --
liaison.commandeServeur = async function (action, corps = {}) {
  try {
    const r = await fetch('api/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
    });
    const rep = await r.json();
    if (rep.erreur) toast('😕 ' + rep.erreur, 'erreur');
    else this.etat = rep;
  } catch {
    this.mode = 'local';
  }
  this.surChangement();
};
