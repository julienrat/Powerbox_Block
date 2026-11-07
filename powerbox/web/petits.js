/* PowerBox Petits : programmer le robot avec de grosses tuiles, lues de gauche à droite.
 * Pour les enfants qui ne lisent pas encore (dès 3 ans) : aucune lecture nécessaire, une voix
 * dit chaque tuile, le robot virtuel avance case par case comme un robot-abeille.
 * Utilise commun.js (liaison avec le boîtier, réglages des roues, sons).
 */
'use strict';

// --- les tuiles --------------------------------------------------------------------------
const COURBE = 'M66 90 V52 Q66 30 44 30 H40 V12 L10 40 L40 68 V50 H44 Q48 50 48 54 V90 Z';
const DROITE = 'M50 10 L88 50 H64 V90 H36 V50 H12 Z';
const svg = (d, t = '') => `<svg viewBox="0 0 100 100"><path d="${d}" fill="#fff" transform="${t}"/></svg>`;

const ACTIONS = {
  avancer: { c: '#22C55E', c2: '#15803D', icone: svg(DROITE), mot: 'Avance', note: 'do' },
  reculer: { c: '#F97316', c2: '#C2410C', icone: svg(DROITE, 'rotate(180 50 50)'), mot: 'Recule', note: 're' },
  gauche: { c: '#3B82F6', c2: '#1D4ED8', icone: svg(COURBE), mot: 'Tourne à gauche', note: 'mi' },
  droite: { c: '#A855F7', c2: '#7E22CE', icone: svg(COURBE, 'translate(100 0) scale(-1 1)'), mot: 'Tourne à droite', note: 'fa' },
  musique: { c: '#EC4899', c2: '#BE185D', icone: '🎵', mot: 'Musique !', note: 'sol' },
  danse: { c: '#EAB308', c2: '#A16207', icone: '💃', mot: 'Danse !', note: 'la' },
};
const MAX_TUILES = 12;
const COLS = 7, LIGNES = 4;
const DEPART = { col: 1, ligne: LIGNES - 1, dir: 0 };
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // haut, droite, bas, gauche

const opts = { pas: 1, quart: 0.55, vitesse: 70, voix: true, ...stock.lire('pb-petits', {}) };
let programme = stock.lire('pb-petits-prog', []).filter((a) => ACTIONS[a]).slice(0, MAX_TUILES);
let enCours = false;

// --- voix --------------------------------------------------------------------------------
let voixFr = null;
function chercherVoix() {
  const v = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  voixFr = v.find((x) => x.lang === 'fr-FR') || v.find((x) => x.lang && x.lang.startsWith('fr')) || null;
}
if (window.speechSynthesis) {
  chercherVoix();
  speechSynthesis.addEventListener?.('voiceschanged', chercherVoix);
}
function parler(texte) {
  if (!opts.voix || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texte);
    u.lang = 'fr-FR';
    if (voixFr) u.voice = voixFr;
    u.rate = 0.95;
    u.pitch = 1.25;
    speechSynthesis.speak(u);
  } catch { /* pas de voix */ }
}

function melodie(notes, duree = 0.18) {
  notes.forEach((n, i) => setTimeout(() => jouerNote(n, duree), i * duree * 1000));
}

// --- attente interruptible ------------------------------------------------------------------
class Arret extends Error {}
const attentes = new Set();
function dormir(s) {
  return new Promise((res, rej) => {
    if (!enCours) return rej(new Arret());
    const t = { rej };
    t.id = setTimeout(() => { attentes.delete(t); res(); }, Math.max(0, s) * 1000);
    attentes.add(t);
  });
}

// --- vrai robot -----------------------------------------------------------------------------
function roues(g, d) {
  const o = { A: 0, B: 0, C: 0, D: 0 };
  o[reglages.gauche] = g * sensRoue(reglages.invG);
  o[reglages.droite] = d * sensRoue(reglages.invD);
  liaison.envoyer(o);
}

// =========================================================================================
// Terrain
// =========================================================================================
const scene = $('#scene'), grille = $('#grille'), elRobot = $('#robot'), elEtoile = $('#etoile');
const robot = { ...DEPART, rot: 0 };
const etoile = { col: 5, ligne: 1 };
let geo = { cell: 80, ox: 0, oy: 0 };

function disposer() {
  const r = scene.getBoundingClientRect();
  const cell = Math.floor(Math.min((r.width - 16) / COLS, (r.height - 16) / LIGNES));
  geo = { cell, ox: (r.width - cell * COLS) / 2, oy: (r.height - cell * LIGNES) / 2 };
  Object.assign(grille.style, {
    left: geo.ox + 'px', top: geo.oy + 'px', width: cell * COLS + 'px', height: cell * LIGNES + 'px',
    gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${LIGNES}, 1fr)`,
  });
  if (grille.children.length !== COLS * LIGNES) {
    grille.innerHTML = '<div></div>'.repeat(COLS * LIGNES);
  }
  placer(elRobot, robot.col, robot.ligne, robot.rot, 0, 0.82);
  placer(elEtoile, etoile.col, etoile.ligne, 0, 0, 0.6);
  elEtoile.style.fontSize = geo.cell * 0.5 + 'px';
}

function placer(el, col, ligne, rot, duree, taille) {
  const t = geo.cell * taille;
  el.style.width = el.style.height = t + 'px';
  el.style.transition = duree ? `transform ${duree}s ease-in-out` : 'none';
  const x = geo.ox + col * geo.cell + (geo.cell - t) / 2;
  const y = geo.oy + ligne * geo.cell + (geo.cell - t) / 2;
  el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
}

const bougerRobot = (duree) => placer(elRobot, robot.col, robot.ligne, robot.rot, duree, 0.82);

function animer(classe, duree) {
  elRobot.classList.remove('saute', 'danse', 'bute');
  void elRobot.offsetWidth;            // relance l'animation
  elRobot.classList.add(classe);
  setTimeout(() => elRobot.classList.remove(classe), duree * 1000);
}

function nouvelleEtoile() {
  let c, l;
  do {
    c = Math.floor(Math.random() * COLS);
    l = Math.floor(Math.random() * LIGNES);
  } while ((c === robot.col && l === robot.ligne) || (c === etoile.col && l === etoile.ligne));
  Object.assign(etoile, { col: c, ligne: l });
  placer(elEtoile, c, l, 0, 0, 0.6);
}

function fete(x, y) {
  const zone = $('#fete');
  for (let i = 0; i < 16; i++) {
    const s = document.createElement('span');
    s.textContent = ['⭐', '🌟', '✨', '🎉'][i % 4];
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 180;
    s.style.left = x - 22 + 'px';
    s.style.top = y - 22 + 'px';
    s.style.setProperty('--dx', Math.cos(a) * d + 'px');
    s.style.setProperty('--dy', Math.sin(a) * d + 'px');
    s.style.setProperty('--r', (Math.random() * 360 - 180) + 'deg');
    zone.append(s);
    setTimeout(() => s.remove(), 1700);
  }
  melodie(['do', 'mi', 'sol', 'do2'], 0.14);
}

function verifierEtoile() {
  if (robot.col !== etoile.col || robot.ligne !== etoile.ligne) return;
  const r = elEtoile.getBoundingClientRect();
  fete(r.left + r.width / 2, r.top + r.height / 2);
  parler('Bravo !');
  nouvelleEtoile();
}

// =========================================================================================
// Exécution d'une tuile : le robot virtuel et le vrai robot bougent ensemble
// =========================================================================================
async function executer(action) {
  const v = opts.vitesse;
  if (action === 'avancer' || action === 'reculer') {
    const s = action === 'avancer' ? 1 : -1;
    const [dx, dy] = DIRS[robot.dir];
    const c = robot.col + dx * s, l = robot.ligne + dy * s;
    if (c >= 0 && c < COLS && l >= 0 && l < LIGNES) {
      Object.assign(robot, { col: c, ligne: l });
      bougerRobot(opts.pas);
    } else {
      animer('bute', 0.6);            // bord du terrain : le robot virtuel reste sur place
    }
    roues(s * v, s * v);
    await dormir(opts.pas);
    roues(0, 0);
  } else if (action === 'gauche' || action === 'droite') {
    const s = action === 'droite' ? 1 : -1;
    robot.dir = (robot.dir + s + 4) % 4;
    robot.rot += 90 * s;
    const vue = Math.max(opts.quart, 0.5);   // l'animation reste visible même si le vrai tour est court
    bougerRobot(vue);
    roues(s * v, -s * v);
    await dormir(opts.quart);
    roues(0, 0);
    await dormir(vue - opts.quart);
  } else if (action === 'musique') {
    animer('saute', 1);
    melodie(['do', 'mi', 'sol', 'mi', 'do2'], 0.2);
    await dormir(1.1);
  } else if (action === 'danse') {
    animer('danse', 1.5);
    melodie(['sol', 'la', 'sol', 'la', 'sol', 'do2'], 0.25);
    for (let i = 0; i < 6; i++) {
      const s = i % 2 ? 1 : -1;
      roues(s * v, -s * v);
      await dormir(0.25);
    }
    roues(0, 0);
  }
  verifierEtoile();
}

async function lancer() {
  if (enCours) return arreter();
  if (!programme.length) {
    const vide = $('#tuiles .vide');
    vide?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 400, iterations: 2 });
    return;
  }
  enCours = true;
  majCommandes();
  const tuiles = [...document.querySelectorAll('#tuiles .tuile:not(.vide)')];
  let fini = false;
  try {
    for (let i = 0; i < programme.length; i++) {
      tuiles.forEach((t, j) => { t.classList.toggle('active', j === i); t.classList.toggle('faite', j < i); });
      tuiles[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      parler(ACTIONS[programme[i]].mot);
      await executer(programme[i]);
      await dormir(0.25);
    }
    fini = true;
  } catch (e) {
    if (!(e instanceof Arret)) console.error(e);
  } finally {
    roues(0, 0);
    enCours = false;
    tuiles.forEach((t) => t.classList.remove('active', 'faite'));
    majCommandes();
    if (fini) { animer('saute', 1); melodie(['sol', 'do2'], 0.2); }
  }
}

function arreter() {
  enCours = false;
  for (const t of attentes) { clearTimeout(t.id); t.rej(new Arret()); }
  attentes.clear();
  roues(0, 0);
  bougerRobot(0);
}

// =========================================================================================
// Ruban et palette
// =========================================================================================
function dessinerRuban(nouvelle = false) {
  const zone = $('#tuiles');
  zone.innerHTML = '';
  programme.forEach((a, i) => {
    if (i) zone.insertAdjacentHTML('beforeend', '<span class="fleche" aria-hidden="true">›</span>');
    const t = tuile(a);
    if (nouvelle && i === programme.length - 1) t.classList.add('nouvelle');
    t.addEventListener('click', () => {      // toucher une tuile : on l'entend, rien n'est effacé
      if (enCours) return;
      t.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(0)' }], 300);
      jouerNote(ACTIONS[a].note, 0.2);
      parler(ACTIONS[a].mot);
    });
    zone.append(t);
  });
  if (programme.length < MAX_TUILES) {
    if (programme.length) zone.insertAdjacentHTML('beforeend', '<span class="fleche" aria-hidden="true">›</span>');
    zone.insertAdjacentHTML('beforeend', '<div class="tuile vide" aria-hidden="true">+</div>');
  }
  zone.lastElementChild?.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
  stock.ecrire('pb-petits-prog', programme);
  majCommandes();
}

function tuile(action) {
  const a = ACTIONS[action];
  const b = document.createElement('button');
  b.className = 'tuile';
  b.style.setProperty('--c', a.c);
  b.style.setProperty('--c2', a.c2);
  b.innerHTML = a.icone;
  b.setAttribute('aria-label', a.mot);
  return b;
}

for (const action of Object.keys(ACTIONS)) {
  const b = tuile(action);
  b.addEventListener('click', () => {
    if (enCours) return;
    if (programme.length >= MAX_TUILES) {
      $('#ruban').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' }, { transform: 'translateX(0)' }], 300);
      jouerNote('do', 0.3);
      return;
    }
    if (sauvegarde) finAnnuler();          // on recommence : plus d'annulation possible
    programme.push(action);
    jouerNote(ACTIONS[action].note, 0.2);
    parler(ACTIONS[action].mot);
    dessinerRuban(true);
  });
  $('#palette').append(b);
}

function majCommandes() {
  const go = $('#btn-go');
  go.classList.toggle('stop', enCours);
  go.setAttribute('aria-label', enCours ? 'Arrêter' : 'Lancer');
  go.innerHTML = enCours
    ? '<svg viewBox="0 0 100 100"><rect x="28" y="28" width="44" height="44" rx="8" fill="#fff"/></svg>'
    : '<svg viewBox="0 0 100 100"><path d="M34 22 L80 50 L34 78 Z" fill="#fff"/></svg>';
  $('#btn-retour').disabled = enCours || !programme.length;
  $('#btn-vider').disabled = enCours || (!programme.length && !sauvegarde);
  for (const b of document.querySelectorAll('#palette .tuile')) b.disabled = enCours;
}

$('#btn-go').addEventListener('click', lancer);
$('#btn-retour').addEventListener('click', () => {
  if (enCours || !programme.length) return;
  programme.pop();
  jouerNote('re', 0.15);
  dessinerRuban();
});

// tout effacer d'un clic ; pendant 5 s, la poubelle devient « annuler » (en cas d'accident)
const ICONE_POUBELLE = $('#btn-vider').innerHTML;
const ICONE_ANNULER = '<svg viewBox="0 0 100 100"><path d="M40 20 L14 44 L40 68 V54 H62 a14 14 0 0 1 0 28 H44 V92 H62 a24 24 0 0 0 0 -48 H40 Z" fill="#fff"/></svg>';
let sauvegarde = null, minuteurAnnuler;

function finAnnuler() {
  clearTimeout(minuteurAnnuler);
  sauvegarde = null;
  const b = $('#btn-vider');
  b.classList.remove('annuler');
  b.innerHTML = ICONE_POUBELLE;
  b.setAttribute('aria-label', 'Tout effacer');
  majCommandes();
}

$('#btn-vider').addEventListener('click', () => {
  const b = $('#btn-vider');
  if (enCours) return;
  if (sauvegarde) {                       // « annuler » : on remet le programme
    programme = sauvegarde;
    finAnnuler();
    melodie(['do', 'mi', 'sol'], 0.12);
    dessinerRuban();
    return;
  }
  if (!programme.length) return;
  sauvegarde = programme;
  programme = [];
  melodie(['sol', 'mi', 'do'], 0.12);
  dessinerRuban();
  b.classList.add('annuler');
  b.innerHTML = ICONE_ANNULER;
  b.setAttribute('aria-label', 'Annuler l’effacement');
  b.disabled = false;
  minuteurAnnuler = setTimeout(finAnnuler, 5000);
});

$('#btn-maison').addEventListener('click', () => {
  if (enCours) return;
  Object.assign(robot, DEPART, { rot: 0 });
  bougerRobot(0.4);
});

// =========================================================================================
// Connexion et réglages (pour les grands)
// =========================================================================================
liaison.surChangement = () => {
  const b = $('#connexion'), e = liaison.etat;
  const ok = liaison.mode === 'bluetooth' || (liaison.mode === 'serveur' && e && e.connecte && !e.simulation);
  const att = liaison.mode === 'serveur' && e && e.voulu && !e.connecte;
  b.className = 'rond' + (ok ? ' ok' : att ? ' attente' : '');
  b.title = ok ? 'Robot connecté' : att ? 'Connexion…' : 'Robot pas connecté : toucher pour le connecter';
};

$('#connexion').addEventListener('click', () => {
  const e = liaison.etat;
  if (liaison.mode === 'serveur' && e) {
    if (e.simulation) return toast('Mode simulation : seul le robot de l’écran bouge.');
    if (e.connecte) return toast('✅ Robot connecté', 'ok');
    if (e.voulu) return toast('🔎 Je cherche le robot…');
    const adresse = stock.lire('pb-boitier', null);
    liaison.commandeServeur('connecter', adresse ? { adresse } : {});
    toast('🔵 Connexion au robot…');
  } else if (liaison.mode === 'bluetooth') {
    toast('✅ Robot connecté en Bluetooth', 'ok');
  } else if (navigator.bluetooth) {
    liaison.connecterBluetooth();
  } else {
    toast('Pas de serveur : seul le robot de l’écran bouge.');
  }
});

const dlg = $('#reglages');
$('#btn-reglages').addEventListener('click', () => {
  $('#r-pas').value = opts.pas;
  $('#r-quart').value = opts.quart;
  $('#r-vitesse').value = opts.vitesse;
  $('#r-voix').checked = opts.voix;
  dlg.showModal();
});
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'ok') return;
  const nombre = (id, min, max, def) => {
    const n = parseFloat($(id).value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  opts.pas = nombre('#r-pas', 0.2, 5, 1);
  opts.quart = nombre('#r-quart', 0.1, 5, 0.55);
  opts.vitesse = nombre('#r-vitesse', 20, 100, 70);
  opts.voix = $('#r-voix').checked;
  stock.ecrire('pb-petits', opts);
});
$('#btn-deconnecter').addEventListener('click', () => {
  dlg.close();
  arreter();
  if (liaison.mode === 'bluetooth') liaison.deconnecterBluetooth();
  else if (liaison.mode === 'serveur') liaison.commandeServeur('deconnecter');
});

window.addEventListener('pagehide', () => {
  arreter();
  if (liaison.mode === 'serveur') {
    fetch('api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true })
      .catch(() => {});
  }
});

// --- démarrage ---
new ResizeObserver(disposer).observe(scene);
disposer();
nouvelleEtoile();
dessinerRuban();
liaison.demarrer();
