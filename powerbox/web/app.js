/* PowerBox Blocs : espace de travail, exécution des programmes (utilise commun.js). */
'use strict';


function clicConnexion() {
  const e = liaison.etat;
  if (liaison.mode === 'bluetooth') {
    liaison.deconnecterBluetooth();
  } else if (liaison.mode === 'serveur' && e) {
    if (e.voulu) {
      pb.stop();
      liaison.commandeServeur('deconnecter');
    } else {
      ouvrirChoix();
    }
  } else {
    liaison.connecterBluetooth();
  }
}

// -- fenêtre « Choisir ta PowerBox » --
const surnoms = stock.lire('pb-surnoms', {});
const nomBoitier = (adr) => surnoms[adr] || adr;
const choix = $('#choix');
let numeroScan = 0;

function ouvrirChoix() {
  if (!choix.open) choix.showModal();
  chercherBoitiers();
}

async function chercherBoitiers() {
  const n = ++numeroScan;
  const dernier = stock.lire('pb-boitier', null);
  afficherBoitiers(dernier ? [{ adresse: dernier, nom: 'powerbox', rssi: null, vue: true }] : [], null, true);
  $('#btn-chercher').disabled = true;
  let rep;
  try {
    rep = await (await fetch('api/scanner' + ($('#choix-tous').checked ? '?tous=1' : ''))).json();
  } catch {
    rep = { boitiers: [], erreur: 'le serveur ne répond pas' };
  }
  if (n !== numeroScan) return;         // un autre scan a été lancé entre-temps
  $('#btn-chercher').disabled = false;
  afficherBoitiers(rep.boitiers || [], rep.erreur, false);
}

function barres(rssi) {
  const n = rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -80 ? 2 : 1;
  return `<span class="barres" title="${rssi} dBm">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}

function afficherBoitiers(boitiers, erreur, enCours) {
  const liste = $('#choix-liste');
  const dernier = stock.lire('pb-boitier', null);
  liste.innerHTML = '';
  const message = (texte) => {
    const d = document.createElement('div');
    d.className = 'vide-liste';
    d.textContent = texte;
    liste.append(d);
  };
  for (const b of boitiers) {
    const surnom = surnoms[b.adresse];
    const etiquettes = [];
    if (b.connecte) etiquettes.push('✅ connecté');
    if (b.adresse === dernier) etiquettes.push('⭐ le dernier utilisé');
    if (!b.vue) etiquettes.push('pas vu : éteint, ou connecté ailleurs ?');
    const el = document.createElement('div');
    el.className = 'boitier' + (b.connecte ? ' actif' : '') + (b.vue ? '' : ' loin');
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.innerHTML = '<span class="robot">🤖</span><span class="infos"><span class="nom"></span>' +
      '<span class="adr"></span> <span class="etiquette"></span></span>' +
      (b.rssi != null ? barres(b.rssi) : '') +
      '<button type="button" class="renommer" title="Donner un nom à ce boîtier">✏️</button>';
    el.querySelector('.nom').textContent = surnom || b.nom;
    el.querySelector('.adr').textContent = b.adresse + (surnom ? ' · ' + b.nom : '');
    el.querySelector('.etiquette').textContent = etiquettes.join(' · ');
    el.addEventListener('click', (e) => { if (!e.target.closest('.renommer')) choisirBoitier(b.adresse); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) choisirBoitier(b.adresse); });
    el.querySelector('.renommer').addEventListener('click', () => {
      const nom = prompt('Nom de ce boîtier (par exemple « Robot de Léa ») :', surnom || '');
      if (nom === null) return;
      if (nom.trim()) surnoms[b.adresse] = nom.trim().slice(0, 30);
      else delete surnoms[b.adresse];
      stock.ecrire('pb-surnoms', surnoms);
      afficherBoitiers(boitiers, erreur, enCours);
      afficherStatut();
    });
    liste.append(el);
  }
  if (enCours) {
    liste.insertAdjacentHTML('beforeend',
      '<div class="recherche"><span class="anim">📡</span> Je cherche les boîtiers… (5 secondes)</div>');
  } else if (erreur) {
    message('😕 Recherche impossible : ' + erreur + '. Tu peux taper l’adresse à la main.');
  } else if (!boitiers.length) {
    message('Aucun boîtier trouvé. Est-il allumé ? Un téléphone y est-il encore connecté ?');
  }
}

function choisirBoitier(adresse) {
  choix.close();
  stock.ecrire('pb-boitier', adresse);
  connexionDemandee = true;
  pb.stop();
  liaison.commandeServeur('connecter', { adresse });
  toast('🔵 Connexion à « ' + nomBoitier(adresse) + ' »…');
}

$('#btn-chercher').addEventListener('click', chercherBoitiers);
$('#choix-tous').addEventListener('change', chercherBoitiers);
$('#btn-adresse').addEventListener('click', () => {
  const a = $('#choix-adresse').value.trim().toUpperCase();
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(a)) {
    toast('L’adresse doit ressembler à 22:01:01:27:0F:7D', 'erreur');
    return;
  }
  choisirBoitier(a);
});
choix.addEventListener('close', () => numeroScan++);   // ignore un scan en cours

let dernierMessage = '';
let connexionDemandee = false;      // vrai entre le clic sur un boîtier et la 1re réponse
function afficherStatut() {
  const p = $('#statut'), bouton = $('#btn-connexion');
  let cls, txt, titre = '', btn = null;    // btn : [texte, déjà connecté ?] ou null = caché
  const e = liaison.etat;
  if (liaison.mode === 'bluetooth') {
    [cls, txt, btn] = ['ok', '✅ Bluetooth direct', ['⏏ Déconnecter', true]];
  } else if (liaison.mode === 'serveur' && e) {
    if (e.simulation) {
      [cls, txt, titre] = ['simu', '🖥️ Simulation', 'Serveur lancé avec --simulation'];
    } else if (e.connecte) {
      connexionDemandee = false;
      const nom = surnoms[e.adresse] ? '✅ ' + surnoms[e.adresse] : '✅ Boîtier connecté';
      [cls, txt, titre, btn] = ['ok', nom, e.adresse + ' — clic pour changer de boîtier', ['⏏ Déconnecter', true]];
    } else if (e.voulu) {
      [cls, txt, titre, btn] = ['attente', '🔎 Connexion…', nomBoitier(e.adresse) + ' : ' + (e.message || ''), ['✖ Annuler', true]];
      // message seulement juste après un clic sur « Connecter », jamais pendant les
      // reconnexions automatiques (sinon il reviendrait sans arrêt)
      if (connexionDemandee && e.message && e.message !== dernierMessage && e.message.startsWith('boîtier introuvable')) {
        toast('😕 ' + e.message + '. Je réessaie… Le boîtier est-il allumé ?', 'erreur');
        connexionDemandee = false;
      }
    } else {
      [cls, txt, titre, btn] = ['off', '⚪ Pas connecté', 'Seul le robot virtuel bouge.', ['🔵 Connecter', false]];
    }
    dernierMessage = e.message || '';
  } else if (liaison.mode === 'local') {
    [cls, txt, titre] = ['simu', '🖥️ Simulation', 'Le serveur Python n’est pas lancé : seul le robot virtuel bouge.'];
    if (navigator.bluetooth) btn = ['🔵 Connecter (Bluetooth)', false];
  } else {
    [cls, txt] = ['attente', '…'];
  }
  p.className = 'pastille ' + cls;
  p.textContent = txt;
  p.title = titre;
  bouton.hidden = !btn;
  if (btn) {
    bouton.textContent = btn[0];
    bouton.classList.toggle('deconnecter', btn[1]);
  }
}

// =========================================================================================
// Exécution d'un programme (objet `pb` utilisé par le code généré)
// =========================================================================================
class Arret extends Error {}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const MOUV = {
  avancer: [1, 1], reculer: [-1, -1], tourner_gauche: [-1, 1], tourner_droite: [1, -1],
  virage_gauche: [0, 1], virage_droite: [1, 0],
};

const pb = {
  vitesses: { A: 0, B: 0, C: 0, D: 0 },
  vRobot: 100,
  enCours: false,
  lent: false,
  _arret: false,
  _timers: new Set(),
  _demarres: [],
  _touches: {},
  _occupees: new Set(),
  _finTouches: null,
  _repos: 0,

  // -- appelé par le code généré --
  quandDemarre(f) { this._demarres.push(f); },
  quandTouche(t, f) { (this._touches[t] = this._touches[t] || []).push(f); },

  async tic() {
    if (this._arret) throw new Arret();
    const t = performance.now();
    if (t - this._repos > 25) {          // laisse respirer la page dans les boucles rapides
      this._repos = t;
      await new Promise((r) => setTimeout(r, 0));
      if (this._arret) throw new Arret();
    }
  },

  async bloc(id) {
    await this.tic();
    espace.highlightBlock(id);
    if (this.lent) await this.attendre(0.45);
  },

  attendre(s) {
    const ms = Math.max(0, Number(s) || 0) * 1000;
    return new Promise((res, rej) => {
      if (this._arret) return rej(new Arret());
      const t = { rej };
      t.id = setTimeout(() => { this._timers.delete(t); res(); }, ms);
      this._timers.add(t);
    });
  },

  _regler(valeurs) {
    for (const [m, v] of Object.entries(valeurs)) {
      this.vitesses[m] = Math.round(Math.max(-100, Math.min(100, Number(v) || 0)));
    }
    liaison.envoyer(this.vitesses);
  },

  async moteur(port, v) { await this.tic(); this._regler({ [port]: v }); },
  async moteurPendant(port, v, s) { await this.moteur(port, v); await this.attendre(s); this._regler({ [port]: 0 }); },
  async arreter(port) {
    await this.tic();
    this._regler(port === 'tous' ? { A: 0, B: 0, C: 0, D: 0 } : { [port]: 0 });
  },
  vitesseMoteur(port) { return this.vitesses[port] || 0; },

  _roues(g, d) {
    const o = {};
    o[reglages.gauche] = g * sensRoue(reglages.invG);
    o[reglages.droite] = d * sensRoue(reglages.invD);
    this._regler(o);
  },
  async robot(action, secondes) {
    await this.tic();
    const [g, d] = MOUV[action];
    this._roues(g * this.vRobot, d * this.vRobot);
    if (secondes !== undefined) {
      await this.attendre(secondes);
      this._roues(0, 0);
    }
  },
  async arreterRobot() { await this.tic(); this._roues(0, 0); },
  async vitesseRobot(v) { await this.tic(); this.vRobot = Math.max(0, Math.min(100, Number(v) || 0)); },

  async dire(texte) { await this.tic(); terrain.dire(String(texte)); },
  async note(n, s) { await this.tic(); jouerNote(n, Number(s) || 0.5); await this.attendre(s); },

  // -- lancement / arrêt --
  async lancer() {
    if (this.enCours) return;
    let code;
    try {
      code = genererJS();
    } catch (e) {
      toast('Oups, je n’arrive pas à lire le programme : ' + e.message, 'erreur');
      return;
    }
    Object.assign(this, { enCours: true, _arret: false, _demarres: [], _touches: {}, _relachees: {},
      _attentes: [], vRobot: 100 });
    this._occupees.clear();
    majBoutons();
    try {
      await new AsyncFunction('pb', code)(this);
      const nbTouches = Object.keys(this._touches).length + Object.keys(this._relachees).length;
      if (!this._demarres.length && !nbTouches) {
        toast('Accroche tes blocs sous « 🚩 quand je clique sur Démarrer » !', 'info');
      }
      await Promise.all(this._demarres.map((f) => this._executer(f)));
      if (nbTouches && !this._arret) {
        toast('⌨️ À toi de jouer avec le clavier ! (Échap ou Stop pour finir)', 'info');
        await new Promise((r) => (this._finTouches = r));
      }
    } catch (e) {
      if (!(e instanceof Arret)) this._erreur(e);
    } finally {
      this._terminer();
    }
  },

  async _executer(f) {
    try { await f(); } catch (e) { if (!(e instanceof Arret)) { this._erreur(e); this.stop(); } }
  },

  _erreur(e) {
    console.error(e);
    toast('😕 Oups : ' + e.message, 'erreur');
  },

  // -- clavier --
  _enfoncees: new Set(),          // touches enfoncées en ce moment
  _relachees: {},                 // « quand je relâche »
  _attentes: [],                  // « attendre que j'appuie sur »

  quandRelachee(t, f) { (this._relachees[t] = this._relachees[t] || []).push(f); },
  toucheAppuyee(nom) { return this._enfoncees.has(nom); },

  attendreTouche(nom) {
    return new Promise((res, rej) => {
      if (this._arret) return rej(new Arret());
      this._attentes.push({ nom, res, rej });
    });
  },

  _lancerTouche(cle, fonctions) {   // une touche ne relance pas son script s'il tourne encore
    if (!this.enCours || this._arret || !fonctions || this._occupees.has(cle)) return;
    this._occupees.add(cle);
    (async () => {
      for (const f of fonctions) await this._executer(f);
      this._occupees.delete(cle);
    })();
  },

  _appui(nom) {
    this._enfoncees.add(nom);
    const restent = [];
    for (const a of this._attentes) {
      if (a.nom === nom || a.nom === 'nimporte') a.res(); else restent.push(a);
    }
    this._attentes = restent;
    this._lancerTouche('+' + nom, this._touches[nom]);
  },

  _relache(nom) {
    this._enfoncees.delete(nom);
    this._lancerTouche('-' + nom, this._relachees[nom]);
  },

  stop() {
    this._arret = true;
    for (const t of this._timers) { clearTimeout(t.id); t.rej(new Arret()); }
    this._timers.clear();
    for (const a of this._attentes) a.rej(new Arret());
    this._attentes = [];
    if (this._finTouches) { this._finTouches(); this._finTouches = null; }
    this._regler({ A: 0, B: 0, C: 0, D: 0 });
  },

  _terminer() {
    this.enCours = false;
    this._arret = true;
    this._regler({ A: 0, B: 0, C: 0, D: 0 });
    espace.highlightBlock(null);
    majBoutons();
  },
};

function majBoutons() {
  $('#btn-go').disabled = pb.enCours;
  $('#btn-go').classList.toggle('actif', pb.enCours);
  $('#btn-go').innerHTML = pb.enCours ? '<span class="anim">⚙️</span> En cours…' : '▶ Démarrer';
}

// =========================================================================================
// Génération du code
// =========================================================================================
function genererJS() {
  return JS.workspaceToCode(espace);
}

function genererPython() {
  let corps = PY.workspaceToCode(espace);
  const touches = ['pb_touche', 'pb_touche_relachee']
    .some((t) => espace.getBlocksByType(t, false).some((b) => b.isEnabled()));
  const r = reglages;
  let entete = '# Programme fait avec PowerBox Blocs\n' +
    '# Pour le lancer :            python3 mon_programme.py\n' +
    '# Pour essayer sans boîtier : POWERBOX_SIMULATION=1 python3 mon_programme.py\n' +
    'from powerbox.facile import *\n\n';
  if (r.gauche !== 'A' || r.droite !== 'D' || r.invG || r.invD) {
    const opts = [`gauche="${r.gauche}"`, `droite="${r.droite}"`];
    if (r.invG) opts.push('inverser_gauche=True');
    if (r.invD) opts.push('inverser_droite=True');
    entete += `roues(${opts.join(', ')})\n\n`;
  }
  if (touches) corps = corps.replace(/\s*$/, '\n\necouter_touches()\n');
  return entete + corps;
}

function colorerPython(code) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const MOTS = /\b(from|import|def|while|for|in|if|elif|else|return|global|pass|and|or|not|True|False|None|break|continue)\b/;
  const re = new RegExp(String.raw`(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|${MOTS.source}|(\b\d+(?:\.\d+)?\b)|(@\w+)`, 'gm');
  let out = '', i = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(i, m.index));
    const cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'mot' : m[4] ? 'num' : 'deco';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    i = re.lastIndex;
  }
  return out + esc(code.slice(i));
}

let pythonTimer;
function majPython() {
  clearTimeout(pythonTimer);
  pythonTimer = setTimeout(() => {
    try { $('#code-python').innerHTML = colorerPython(genererPython()); } catch (e) { console.error(e); }
  }, 150);
}

// =========================================================================================
// Engrenages des 4 sorties
// =========================================================================================
function cheminEngrenage(dents = 10, rExt = 40, rInt = 31) {
  const pts = [];
  for (let i = 0; i < dents; i++) {
    const a = (i / dents) * Math.PI * 2, d = Math.PI * 2 / dents;
    for (const [f, r] of [[0, rInt], [0.12, rExt], [0.42, rExt], [0.54, rInt]]) {
      pts.push([Math.cos(a + f * d) * r, Math.sin(a + f * d) * r]);
    }
  }
  return 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z';
}

const angles = { A: 0, B: 0, C: 0, D: 0 };
function creerMoteurs() {
  const zone = $('#moteurs');
  const chemin = cheminEngrenage();
  for (const m of MOTEURS) {
    const c = COULEUR_MOTEUR[m];
    zone.insertAdjacentHTML('beforeend', `
      <div class="moteur" id="mot-${m}" style="--c:${c}">
        <svg viewBox="-50 -50 100 100" aria-hidden="true">
          <g class="roue"><path d="${chemin}" fill="${c}"/><circle r="12" fill="#fff" opacity=".9"/>
            <rect x="-3" y="-30" width="6" height="14" rx="3" fill="#fff" opacity=".7"/></g>
          <text y="5" text-anchor="middle" class="lettre">${m}</text>
        </svg>
        <div class="vitesse"><span class="sens"></span><span class="val">0 %</span></div>
        <div class="barre"><div></div></div>
      </div>`);
  }
}

function majMoteurs(dt) {
  for (const m of MOTEURS) {
    const v = pb.vitesses[m];
    angles[m] = (angles[m] + v / 100 * 360 * dt) % 360;
    const el = document.getElementById('mot-' + m);
    el.querySelector('.roue').setAttribute('transform', `rotate(${angles[m].toFixed(1)})`);
    el.querySelector('.val').textContent = Math.abs(v) + ' %';
    el.querySelector('.sens').textContent = v > 0 ? '↻' : v < 0 ? '↺' : '';
    el.querySelector('.barre div').style.width = Math.abs(v) + '%';
    el.classList.toggle('tourne', v !== 0);
  }
}

// =========================================================================================
// Terrain : un robot virtuel qui suit les roues gauche / droite
// =========================================================================================
const terrain = {
  x: 0, y: 0, a: -Math.PI / 2, traces: [], bulle: null,
  init() {
    this.cv = $('#terrain');
    this.ctx = this.cv.getContext('2d');
    new ResizeObserver(() => this.redim()).observe(this.cv);
    this.redim();
  },
  redim() {
    const r = this.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return;            // onglet caché
    const premier = !this.w;
    this.w = r.width; this.h = r.height;
    if (premier) this.reset();
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },
  reset() {
    this.x = this.w / 2; this.y = this.h / 2 + 30; this.a = -Math.PI / 2;
    this.traces = [[{ x: this.x, y: this.y }]];
  },
  dire(texte) { this.bulle = { texte, fin: performance.now() + 3500 }; },
  pas(dt) {
    if (!this.w) return;
    // vitesse « vers l'avant » de chaque roue, en %
    const g = pb.vitesses[reglages.gauche] * sensRoue(reglages.invG);
    const d = pb.vitesses[reglages.droite] * sensRoue(reglages.invD);
    if (g || d) {
      const V = 1.1, ECART = 70;            // 100 % = 110 px/s
      const v = (g + d) / 2 * V, w = (d - g) * V / ECART;
      this.a -= w * dt;
      this.x += Math.cos(this.a) * v * dt;
      this.y += Math.sin(this.a) * v * dt;
      let saut = false;
      if (this.x < 0) { this.x += this.w; saut = true; } else if (this.x > this.w) { this.x -= this.w; saut = true; }
      if (this.y < 0) { this.y += this.h; saut = true; } else if (this.y > this.h) { this.y -= this.h; saut = true; }
      if (saut) this.traces.push([]);
      const t = this.traces[this.traces.length - 1];
      const der = t[t.length - 1];
      if (!der || Math.hypot(der.x - this.x, der.y - this.y) > 2) t.push({ x: this.x, y: this.y });
      if (this.traces.reduce((n, t) => n + t.length, 0) > 4000) this.traces.shift();
    }
    this.dessiner();
  },
  dessiner() {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    // quadrillage
    c.strokeStyle = '#E3E9F5'; c.lineWidth = 1;
    for (let x = 0; x < this.w; x += 30) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, this.h); c.stroke(); }
    for (let y = 0; y < this.h; y += 30) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(this.w, y + 0.5); c.stroke(); }
    // traces
    c.strokeStyle = '#3B8BFF'; c.lineWidth = 3; c.lineCap = c.lineJoin = 'round'; c.globalAlpha = 0.55;
    for (const t of this.traces) {
      if (t.length < 2) continue;
      c.beginPath(); c.moveTo(t[0].x, t[0].y);
      for (const p of t) c.lineTo(p.x, p.y);
      c.stroke();
    }
    c.globalAlpha = 1;
    // robot
    c.save();
    c.translate(this.x, this.y); c.rotate(this.a + Math.PI / 2);
    c.fillStyle = '#2B3550';
    c.fillRect(-21, -12, 7, 22); c.fillRect(14, -12, 7, 22);            // roues
    c.fillStyle = '#FF6B2C';
    c.beginPath(); c.roundRect(-15, -18, 30, 34, 8); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(-6, -9, 3.5, 0, 7); c.arc(6, -9, 3.5, 0, 7); c.fill();  // yeux
    c.fillStyle = '#2B3550';
    c.beginPath(); c.arc(-6, -10, 1.6, 0, 7); c.arc(6, -10, 1.6, 0, 7); c.fill();
    c.restore();
    // bulle
    if (this.bulle && performance.now() < this.bulle.fin) {
      c.font = '600 14px Fredoka, Nunito, system-ui, sans-serif';
      const tw = Math.min(c.measureText(this.bulle.texte).width, this.w - 30);
      const bw = tw + 20, bh = 30;
      const bx = Math.max(6, Math.min(this.w - bw - 6, this.x - bw / 2));
      const by = Math.max(6, this.y - 62);
      c.fillStyle = '#fff'; c.strokeStyle = '#2B3550'; c.lineWidth = 2;
      c.beginPath(); c.roundRect(bx, by, bw, bh, 12); c.fill(); c.stroke();
      c.fillStyle = '#2B3550';
      c.fillText(this.bulle.texte, bx + 10, by + 20, tw);
    }
  },
};

// =========================================================================================
// Espace de travail Blockly
// =========================================================================================
const espace = Blockly.inject('blocs', {
  toolbox: BOITE_A_OUTILS,
  theme: THEME,
  renderer: 'zelos',
  media: 'vendor/blockly/media/',
  grid: { spacing: 32, length: 4, colour: '#DCE3F0', snap: true },
  zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.4, scaleSpeed: 1.15 },
  move: { scrollbars: true, drag: true, wheel: false },
  trashcan: true,
  sounds: true,
});
if (Blockly.Events.disableOrphans) espace.addChangeListener(Blockly.Events.disableOrphans);

function charger(donnees) {
  espace.clear();
  Blockly.serialization.workspaces.load(donnees, espace);
  espace.clearUndo();
  espace.scrollCenter();
  majPython();
}

const sauvegardeAuto = stock.lire('pb-programme', null);
try {
  charger(sauvegardeAuto || EXEMPLES.premier.donnees);
} catch {
  charger(EXEMPLES.premier.donnees);
}

espace.addChangeListener((e) => {
  if (e.isUiEvent) return;
  stock.ecrire('pb-programme', Blockly.serialization.workspaces.save(espace));
  majPython();
});

// =========================================================================================
// Interface
// =========================================================================================
const sel = $('#exemples');
for (const [k, ex] of Object.entries(EXEMPLES)) sel.add(new Option(ex.titre, k));
sel.addEventListener('change', () => {
  const ex = EXEMPLES[sel.value];
  sel.value = '';
  if (!ex) return;
  if (espace.getAllBlocks(false).length > 1 && !confirm('Remplacer ton programme par l’exemple « ' + ex.titre + ' » ?')) return;
  pb.stop();
  charger(ex.donnees);
  terrain.reset();
});

$('#btn-go').addEventListener('click', () => { terrain.bulle = null; pb.lancer(); });
$('#btn-stop').addEventListener('click', () => pb.stop());
$('#btn-lent').addEventListener('click', (e) => {
  pb.lent = !pb.lent;
  e.currentTarget.setAttribute('aria-pressed', pb.lent);
  toast(pb.lent ? '🐢 Mode lent : chaque bloc s’allume quand il travaille.' : '🐇 Vitesse normale.');
});
$('#btn-effacer').addEventListener('click', () => terrain.reset());

$('#btn-nouveau').addEventListener('click', () => {
  if (!confirm('Tout effacer et commencer un nouveau programme ?')) return;
  pb.stop();
  charger(programme([[60, 60, [b('pb_demarrer')]]]));
  terrain.reset();
});

function telecharger(nom, contenu, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contenu], { type }));
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#btn-enregistrer').addEventListener('click', () => {
  telecharger('mon_programme.powerbox.json',
    JSON.stringify(Blockly.serialization.workspaces.save(espace), null, 1), 'application/json');
});
$('#btn-ouvrir').addEventListener('click', () => $('#fichier').click());
$('#fichier').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    charger(JSON.parse(await f.text()));
    toast('📂 Programme ouvert !', 'ok');
  } catch (err) {
    toast('Ce fichier n’est pas un programme PowerBox Blocs.', 'erreur');
  }
});
$('#btn-py').addEventListener('click', () => telecharger('mon_programme.py', genererPython(), 'text/x-python'));
$('#btn-copier').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(genererPython()); toast('📋 Code Python copié !', 'ok'); }
  catch { toast('Impossible de copier ici.', 'erreur'); }
});

// onglets Terrain / Python
for (const t of document.querySelectorAll('[data-onglet]')) {
  t.addEventListener('click', () => {
    for (const x of document.querySelectorAll('[data-onglet]')) x.setAttribute('aria-selected', x === t);
    for (const o of document.querySelectorAll('.onglet')) o.hidden = o.id !== 'onglet-' + t.dataset.onglet;
    stock.ecrire('pb-onglet', t.dataset.onglet);
    if (t.dataset.onglet === 'terrain') terrain.redim();
  });
}
document.querySelector(`[data-onglet="${stock.lire('pb-onglet', 'terrain')}"]`)?.click();

// réglages
const dlg = $('#reglages');
$('#btn-reglages').addEventListener('click', () => {
  $('#r-gauche').value = reglages.gauche;
  $('#r-droite').value = reglages.droite;
  $('#r-invg').checked = reglages.invG;
  $('#r-invd').checked = reglages.invD;
  dlg.showModal();
});
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'ok') return;
  Object.assign(reglages, {
    gauche: $('#r-gauche').value, droite: $('#r-droite').value,
    invG: $('#r-invg').checked, invD: $('#r-invd').checked,
  });
  stock.ecrire('pb-reglages', reglages);
  majPython();
});
$('#btn-connexion').addEventListener('click', clicConnexion);
$('#statut').addEventListener('click', () => {      // changer de boîtier
  if (liaison.mode === 'serveur' && liaison.etat && !liaison.etat.simulation) ouvrirChoix();
});

// clavier
const NOM_TOUCHE = { ArrowUp: 'haut', ArrowDown: 'bas', ArrowLeft: 'gauche', ArrowRight: 'droite', ' ': 'espace', Enter: 'entree' };
const nomTouche = (e) => NOM_TOUCHE[e.key] || (/^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : null);
const dansUnChamp = (e) => e.target.closest &&
  e.target.closest('input, textarea, select, dialog, .blocklyWidgetDiv, .blocklyDropDownDiv');

document.addEventListener('keydown', (e) => {
  if (dansUnChamp(e)) return;
  if (e.key === 'Escape' && pb.enCours) { pb.stop(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const nom = nomTouche(e);
  if (nom && pb.enCours) {
    e.preventDefault();          // pas de défilement de la page avec les flèches / espace
    pb._appui(nom);
  }
});
document.addEventListener('keyup', (e) => {
  const nom = nomTouche(e);
  if (nom && pb._enfoncees.has(nom)) pb._relache(nom);
});
window.addEventListener('blur', () => {   // fenêtre quittée : on lâche tout
  for (const nom of [...pb._enfoncees]) pb._relache(nom);
});

// sécurité : on arrête tout si la page est fermée
window.addEventListener('pagehide', () => {
  pb.stop();
  if (liaison.mode === 'serveur') {
    fetch('api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true })
      .catch(() => {});
  }
});

// --- démarrage ---
creerMoteurs();
terrain.init();
liaison.surChangement = afficherStatut;
liaison.demarrer();
majBoutons();
let tPrec = performance.now();
(function boucle(t) {
  const dt = Math.min(0.1, (t - tPrec) / 1000);
  tPrec = t;
  majMoteurs(dt);
  terrain.pas(dt);
  requestAnimationFrame(boucle);
})(tPrec);
