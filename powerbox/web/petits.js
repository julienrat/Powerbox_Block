/* PowerBox Petits : programmer le robot avec de grosses tuiles, lues de gauche à droite.
 * Pour les enfants qui ne lisent pas encore (dès 3 ans) : aucune lecture nécessaire, une voix
 * dit chaque tuile, le robot virtuel avance case par case comme un robot-abeille.
 *
 * Le jeu : ramasser les pièces du robot (engrenage, écrou, pile, roue) en évitant les caisses.
 * Toutes les pièces ramassées = robot réparé = niveau suivant. Chaque pièce rapporte 1 point.
 *
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
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // haut, droite, bas, gauche

// --- dessins : pièces du robot et caisse ----------------------------------------------------
function engrenage(dents, rExt, rInt) {
  const pts = [];
  for (let i = 0; i < dents; i++) {
    const a = (i / dents) * Math.PI * 2, d = Math.PI * 2 / dents;
    for (const [f, r] of [[0, rInt], [0.12, rExt], [0.42, rExt], [0.54, rInt]]) {
      pts.push(`${(50 + Math.cos(a + f * d) * r).toFixed(1)} ${(50 + Math.sin(a + f * d) * r).toFixed(1)}`);
    }
  }
  return 'M' + pts.join('L') + 'Z';
}
const PIECES = {
  engrenage: `<svg viewBox="0 0 100 100"><path d="${engrenage(9, 46, 35)}" fill="#F59E0B" stroke="#B45309" stroke-width="3"/>
    <circle cx="50" cy="50" r="13" fill="#FFF7E6" stroke="#B45309" stroke-width="3"/></svg>`,
  ecrou: `<svg viewBox="0 0 100 100"><path d="M50 6 L88 28 V72 L50 94 L12 72 V28 Z" fill="#60A5FA" stroke="#1D4ED8" stroke-width="4"/>
    <circle cx="50" cy="50" r="17" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="4"/></svg>`,
  pile: `<svg viewBox="0 0 100 100"><rect x="40" y="6" width="20" height="10" rx="3" fill="#166534"/>
    <rect x="24" y="14" width="52" height="80" rx="10" fill="#22C55E" stroke="#166534" stroke-width="4"/>
    <path d="M50 34 V58 M38 46 H62" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>`,
  roue: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="#334155"/>
    <circle cx="50" cy="50" r="44" fill="none" stroke="#1E293B" stroke-width="6" stroke-dasharray="7 7"/>
    <circle cx="50" cy="50" r="20" fill="#F43F5E" stroke="#BE123C" stroke-width="4"/><circle cx="50" cy="50" r="6" fill="#fff"/></svg>`,
};
const ORDRE_PIECES = ['engrenage', 'ecrou', 'pile', 'roue'];
const CAISSE = `<svg viewBox="0 0 100 100"><rect x="6" y="6" width="88" height="88" rx="10" fill="#C2884D" stroke="#7C4A1E" stroke-width="5"/>
  <path d="M14 14 L86 86 M86 14 L14 86" stroke="#7C4A1E" stroke-width="7" stroke-linecap="round"/>
  <rect x="6" y="6" width="88" height="88" rx="10" fill="none" stroke="#7C4A1E" stroke-width="5"/></svg>`;

// --- les niveaux : ^ > v < = départ du robot et sa direction, P = pièce, # = caisse ------------
const NIVEAUX = [
  ['.......', '..P....', '.......', '..^....'],     // tout droit
  ['..P....', '.......', '..P....', '..^....'],     // deux pièces sur la route
  ['.......', '.......', '.......', '^..P...'],     // tourner une fois
  ['...P...', '.......', '.......', '>..P...'],     // avancer, tourner, avancer
  ['.......', '.......', '.......', '>.#.P..'],     // une caisse sur le chemin
  ['.P...P.', '.#...#.', '.......', '...^...'],     // deux pièces derrière des caisses
  ['P..#..P', '..#.#..', '.......', '...^...'],
  ['P#...#P', '.#.P.#.', '.......', '...^...'],
];

function niveauAuHasard(n) {             // au-delà des niveaux dessinés, en s'assurant que c'est faisable
  for (;;) {
    const g = Array.from({ length: LIGNES }, () => Array(COLS).fill('.'));
    const libre = () => {
      for (;;) {
        const c = Math.floor(Math.random() * COLS), l = Math.floor(Math.random() * LIGNES);
        if (g[l][c] === '.') return [c, l];
      }
    };
    const [rc, rl] = libre();
    g[rl][rc] = '^>v<'[Math.floor(Math.random() * 4)];
    for (let i = 0; i < Math.min(5, 2 + Math.floor(n / 4)); i++) { const [c, l] = libre(); g[l][c] = '#'; }
    for (let i = 0; i < 3; i++) { const [c, l] = libre(); g[l][c] = 'P'; }
    const carte = g.map((r) => r.join(''));
    if (faisable(carte)) return carte;
  }
}

function faisable(carte) {               // toutes les pièces sont-elles atteignables ?
  let depart;
  carte.forEach((r, l) => [...r].forEach((ch, c) => { if ('^>v<'.includes(ch)) depart = [c, l]; }));
  const vu = new Set([depart.join()]), file = [depart];
  while (file.length) {
    const [c, l] = file.shift();
    for (const [dx, dy] of DIRS) {
      const nc = c + dx, nl = l + dy;
      if (nc < 0 || nl < 0 || nc >= COLS || nl >= LIGNES || carte[nl][nc] === '#' || vu.has(nc + ',' + nl)) continue;
      vu.add(nc + ',' + nl);
      file.push([nc, nl]);
    }
  }
  return carte.every((r, l) => [...r].every((ch, c) => ch !== 'P' || vu.has(c + ',' + l)));
}

// --- état -------------------------------------------------------------------------------
const opts = { pas: 1, quart: 0.55, vitesse: 70, voix: true, ...stock.lire('pb-petits', {}) };
const jeu = { niveau: 1, score: 0, ...stock.lire('pb-petits-jeu', {}) };
let programme = stock.lire('pb-petits-prog', []).filter((a) => ACTIONS[a]).slice(0, MAX_TUILES);
let enCours = false;
let carte = [];                           // niveau en cours
let depart = { col: 0, ligne: 0, dir: 0 };
let pieces = [];                          // { col, ligne, type, el, prise }
let caisses = new Set();                  // "col,ligne"

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
class NiveauFini extends Error {}
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
const scene = $('#scene'), grille = $('#grille'), elRobot = $('#robot'), objets = $('#objets');
const robot = { col: 0, ligne: 0, dir: 0, rot: 0 };
let geo = { cell: 80, ox: 0, oy: 0 };
const HAUT_HUD = 58;                      // place réservée en haut pour la barre du jeu

function disposer() {
  const r = scene.getBoundingClientRect();
  const cell = Math.floor(Math.min((r.width - 16) / COLS, (r.height - HAUT_HUD - 12) / LIGNES));
  geo = { cell, ox: (r.width - cell * COLS) / 2, oy: HAUT_HUD + (r.height - HAUT_HUD - cell * LIGNES) / 2 };
  Object.assign(grille.style, {
    left: geo.ox + 'px', top: geo.oy + 'px', width: cell * COLS + 'px', height: cell * LIGNES + 'px',
    gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${LIGNES}, 1fr)`,
  });
  if (grille.children.length !== COLS * LIGNES) grille.innerHTML = '<div></div>'.repeat(COLS * LIGNES);
  [...grille.children].forEach((d, i) => d.classList.toggle('depart', i === depart.ligne * COLS + depart.col));
  bougerRobot(0);
  for (const p of pieces) if (!p.prise) placer(p.el, p.col, p.ligne, 0, 0, 0.7);
  for (const el of objets.querySelectorAll('.caisse')) placer(el, +el.dataset.col, +el.dataset.ligne, 0, 0, 0.86);
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

// --- niveaux ------------------------------------------------------------------------------
function chargerNiveau(n) {
  jeu.niveau = Math.max(1, Math.min(99, n | 0));
  stock.ecrire('pb-petits-jeu', jeu);
  carte = jeu.niveau <= NIVEAUX.length ? NIVEAUX[jeu.niveau - 1] : niveauAuHasard(jeu.niveau);
  objets.innerHTML = '';
  pieces = [];
  caisses = new Set();
  let k = 0;
  carte.forEach((rangee, ligne) => [...rangee].forEach((ch, col) => {
    if ('^>v<'.includes(ch)) depart = { col, ligne, dir: '^>v<'.indexOf(ch) };
    else if (ch === '#') {
      caisses.add(col + ',' + ligne);
      const el = document.createElement('div');
      el.className = 'objet caisse';
      el.dataset.col = col;
      el.dataset.ligne = ligne;
      el.innerHTML = CAISSE;
      objets.append(el);
    } else if (ch === 'P') {
      const type = ORDRE_PIECES[k++ % ORDRE_PIECES.length];
      const el = document.createElement('div');
      el.className = 'objet piece';
      el.innerHTML = PIECES[type];
      objets.append(el);
      pieces.push({ col, ligne, type, el, prise: false });
    }
  }));
  Object.assign(robot, depart, { rot: depart.dir * 90 });
  disposer();
  majHud();
}

function recommencerNiveau() {
  for (const p of pieces) {
    p.prise = false;
    p.el.classList.remove('prise');
    p.el.style.opacity = '';
  }
  Object.assign(robot, depart, { rot: depart.dir * 90 });
  disposer();
  majHud();
}

function majHud() {
  $('#niveau').innerHTML = `<span class="num">${jeu.niveau}</span>`;
  $('#niveau').setAttribute('aria-label', 'Niveau ' + jeu.niveau);
  $('#a-trouver').innerHTML = pieces.map((p) =>
    `<span class="case-piece${p.prise ? ' ok' : ''}">${PIECES[p.type]}</span>`).join('');
  $('#score').innerHTML = `<span class="trophee">🏆</span>${jeu.score}`;
}

function ramasser() {                       // après chaque déplacement du robot virtuel
  const i = pieces.findIndex((p) => !p.prise && p.col === robot.col && p.ligne === robot.ligne);
  if (i < 0) return;
  const p = pieces[i];
  p.prise = true;
  jeu.score++;
  stock.ecrire('pb-petits-jeu', jeu);
  // la pièce monte vers sa case en haut et disparaît
  const x = geo.ox + p.col * geo.cell, y = geo.oy + p.ligne * geo.cell;
  p.el.style.transition = 'transform .5s ease-in, opacity .5s ease-in';
  p.el.style.transform = `translate(${x}px, ${y - geo.cell}px) scale(1.4)`;
  p.el.classList.add('prise');
  majHud();
  $('#a-trouver').children[i]?.classList.add('pop');
  $('#score').classList.remove('pop');
  void $('#score').offsetWidth;
  $('#score').classList.add('pop');
  melodie(['mi', 'sol', 'do2'], 0.1);
  if (pieces.every((q) => q.prise)) throw new NiveauFini();
  parler('Une pièce !');
}

async function niveauReussi() {
  const r = scene.getBoundingClientRect();
  fete(r.left + r.width / 2, r.top + r.height / 2);
  parler('Bravo ! Le robot est réparé !');
  animer('saute', 1.2);
  $('#bravo').hidden = false;
  await new Promise((res) => setTimeout(res, 2600));
  $('#bravo').hidden = true;
  programme = [];
  dessinerRuban();
  chargerNiveau(jeu.niveau + 1);
}

function fete(x, y) {
  const zone = $('#fete');
  const symboles = ['⭐', '🎉', '✨', '🔩', '⚙️'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('span');
    s.textContent = symboles[i % symboles.length];
    const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 200;
    s.style.left = x - 22 + 'px';
    s.style.top = y - 22 + 'px';
    s.style.setProperty('--dx', Math.cos(a) * d + 'px');
    s.style.setProperty('--dy', Math.sin(a) * d + 'px');
    s.style.setProperty('--r', (Math.random() * 360 - 180) + 'deg');
    zone.append(s);
    setTimeout(() => s.remove(), 1700);
  }
  melodie(['do', 'mi', 'sol', 'do2', 'sol', 'do2'], 0.14);
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
    const libre = c >= 0 && c < COLS && l >= 0 && l < LIGNES && !caisses.has(c + ',' + l);
    if (libre) {
      Object.assign(robot, { col: c, ligne: l });
      bougerRobot(opts.pas);
    } else {
      animer('bute', 0.6);            // bord ou caisse : le robot virtuel reste sur place
      jouerNote('do', 0.25);
    }
    roues(s * v, s * v);
    await dormir(opts.pas);
    roues(0, 0);
    if (libre) ramasser();
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
  let fini = false, reussi = false;
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
    if (e instanceof NiveauFini) reussi = true;
    else if (!(e instanceof Arret)) console.error(e);
  } finally {
    roues(0, 0);
    enCours = false;
    tuiles.forEach((t) => t.classList.remove('active', 'faite'));
    majCommandes();
  }
  if (reussi) await niveauReussi();
  else if (fini) { animer('saute', 1); melodie(['sol', 'do2'], 0.2); }
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

// 🏠 : le robot retourne au départ et les pièces reviennent (le score est gardé)
$('#btn-maison').addEventListener('click', () => {
  if (enCours) return;
  recommencerNiveau();
  jouerNote('do', 0.15);
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
function ouvrirReglages() {
  $('#r-pas').value = opts.pas;
  $('#r-quart').value = opts.quart;
  $('#r-vitesse').value = opts.vitesse;
  $('#r-voix').checked = opts.voix;
  $('#r-niveau').value = jeu.niveau;
  dlg.showModal();
}
$('#btn-reglages').addEventListener('click', ouvrirReglages);
$('#niveau').addEventListener('click', () => { if (!enCours) ouvrirReglages(); });
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
  const n = Math.round(nombre('#r-niveau', 1, 99, jeu.niveau));
  if (n !== jeu.niveau) chargerNiveau(n);
});
$('#btn-zero').addEventListener('click', () => {
  jeu.score = 0;
  stock.ecrire('pb-petits-jeu', jeu);
  majHud();
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
chargerNiveau(jeu.niveau);
dessinerRuban();
liaison.demarrer();
