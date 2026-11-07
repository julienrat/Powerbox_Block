/* PowerBox Blocs : définition des blocs, du thème et des générateurs JavaScript / Python.
 *
 * - Le code JavaScript est exécuté dans la page (objet `pb`, voir app.js).
 * - Le code Python utilise la bibliothèque powerbox.facile et marche tel quel dans un terminal.
 */
'use strict';

const JS = javascript.javascriptGenerator;
const JO = javascript.Order;
const PY = python.pythonGenerator;
const PO = python.Order;

// --- Couleurs et thème ------------------------------------------------------------------
const COULEURS = {
  evenement: '#E89B00',
  robot: '#1FAF6B',
  moteur: '#FF6B2C',
  temps: '#3B8BFF',
  boucle: '#0FB5AE',
  logique: '#6366F1',
  maths: '#A24DF0',
  clavier: '#56648A',
  message: '#0A9BD8',
  variable: '#F0466E',
  fonction: '#D946EF',
};

function nuance(hex, f) {          // f > 0 éclaircit, f < 0 assombrit
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v =>
    Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

function style(hex, extra = {}) {
  return { colourPrimary: hex, colourSecondary: nuance(hex, 0.35), colourTertiary: nuance(hex, -0.18), ...extra };
}

const THEME = Blockly.Theme.defineTheme('powerbox', {
  name: 'powerbox',
  base: Blockly.Themes.Zelos,
  blockStyles: {
    evenement_blocks: style(COULEURS.evenement, { hat: 'cap' }),
    robot_blocks: style(COULEURS.robot),
    moteur_blocks: style(COULEURS.moteur),
    temps_blocks: style(COULEURS.temps),
    loop_blocks: style(COULEURS.boucle),
    logic_blocks: style(COULEURS.logique),
    math_blocks: style(COULEURS.maths),
    text_blocks: style(COULEURS.message),
    message_blocks: style(COULEURS.message),
    clavier_blocks: style(COULEURS.clavier),
    variable_blocks: style(COULEURS.variable),
    variable_dynamic_blocks: style(COULEURS.variable),
    procedure_blocks: style(COULEURS.fonction),
    list_blocks: style(COULEURS.variable),
  },
  categoryStyles: Object.fromEntries(Object.entries(COULEURS).map(([k, v]) => [k, { colour: v }])),
  componentStyles: {
    workspaceBackgroundColour: '#F4F7FC',
    toolboxBackgroundColour: '#FFFFFF',
    toolboxForegroundColour: '#2B3550',
    flyoutBackgroundColour: '#E9EEF8',
    flyoutForegroundColour: '#2B3550',
    flyoutOpacity: 0.97,
    scrollbarColour: '#C3CCE0',
    insertionMarkerColour: '#000000',
    insertionMarkerOpacity: 0.18,
    cursorColour: '#3B8BFF',
  },
  fontStyle: { family: '"Fredoka", "Nunito", "Segoe UI", system-ui, sans-serif', weight: '600', size: 13 },
  startHats: true,
});

// --- Définition des blocs ----------------------------------------------------------------
const MOUVEMENTS = [
  ['⬆️ avancer', 'avancer'],
  ['⬇️ reculer', 'reculer'],
  ['↩️ tourner à gauche', 'tourner_gauche'],
  ['↪️ tourner à droite', 'tourner_droite'],
  ['↖️ virage à gauche', 'virage_gauche'],
  ['↗️ virage à droite', 'virage_droite'],
];
const PORTS = [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']];
const SENS = [['↻', '1'], ['↺', '-1']];
const TOUCHES = [
  ['⬆️ flèche haut', 'haut'], ['⬇️ flèche bas', 'bas'],
  ['⬅️ flèche gauche', 'gauche'], ['➡️ flèche droite', 'droite'],
  ['espace', 'espace'], ['entrée', 'entree'],
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('').map(c => [c.toUpperCase(), c]),
];
const NOTES = [['do', 'do'], ['ré', 're'], ['mi', 'mi'], ['fa', 'fa'], ['sol', 'sol'],
  ['la', 'la'], ['si', 'si'], ['do aigu', 'do2']];

Blockly.Extensions.register('pb_chapeau', function () {
  this.suppressPrefixSuffix = true;   // pas de surlignage pour les blocs « quand… »
});

const nombre = (name) => ({ type: 'input_value', name, check: 'Number' });
const suite = { previousStatement: null, nextStatement: null, inputsInline: true };

Blockly.common.defineBlocksWithJsonArray([
  {
    type: 'pb_demarrer', message0: '🚩 quand je clique sur ▶ Démarrer',
    nextStatement: null, style: 'evenement_blocks', extensions: ['pb_chapeau'],
    tooltip: 'Les blocs accrochés dessous se lancent quand on clique sur Démarrer.',
  },
  {
    type: 'pb_touche', message0: '⌨️ quand j’appuie sur %1',
    args0: [{ type: 'field_dropdown', name: 'TOUCHE', options: TOUCHES }],
    nextStatement: null, style: 'evenement_blocks', extensions: ['pb_chapeau'],
    tooltip: 'Les blocs dessous se lancent à chaque appui sur la touche (après avoir cliqué sur Démarrer).',
  },
  {
    type: 'pb_touche_relachee', message0: '⌨️ quand je relâche %1',
    args0: [{ type: 'field_dropdown', name: 'TOUCHE', options: TOUCHES }],
    nextStatement: null, style: 'evenement_blocks', extensions: ['pb_chapeau'],
    tooltip: 'Les blocs dessous se lancent quand on lâche la touche. Pratique pour arrêter le robot.',
  },
  {
    type: 'pb_touche_appuyee', message0: 'touche %1 appuyée ?',
    args0: [{ type: 'field_dropdown', name: 'TOUCHE', options: TOUCHES }],
    output: 'Boolean', style: 'clavier_blocks',
    tooltip: 'Vrai tant que la touche est enfoncée. À mettre dans un « si » dans une boucle.',
  },
  {
    type: 'pb_attendre_touche', message0: '⏳ attendre que j’appuie sur %1',
    args0: [{ type: 'field_dropdown', name: 'TOUCHE',
      options: [['n’importe quelle touche', 'nimporte'], ...TOUCHES] }],
    ...suite, style: 'clavier_blocks',
    tooltip: 'Le programme attend ici qu’on appuie sur la touche.',
  },
  {
    type: 'pb_robot_pendant', message0: '🚗 %1 pendant %2 s',
    args0: [{ type: 'field_dropdown', name: 'ACTION', options: MOUVEMENTS }, nombre('SECONDES')],
    ...suite, style: 'robot_blocks',
    tooltip: 'Le robot bouge pendant ce temps, puis s’arrête.',
  },
  {
    type: 'pb_robot', message0: '🚗 %1 sans s’arrêter',
    args0: [{ type: 'field_dropdown', name: 'ACTION', options: MOUVEMENTS }],
    ...suite, style: 'robot_blocks',
    tooltip: 'Le robot continue jusqu’au prochain ordre.',
  },
  {
    type: 'pb_robot_stop', message0: '🛑 arrêter le robot', ...suite, style: 'robot_blocks',
  },
  {
    type: 'pb_robot_vitesse', message0: '⚡ vitesse du robot %1 %',
    args0: [nombre('VITESSE')], ...suite, style: 'robot_blocks',
    tooltip: 'De 0 (immobile) à 100 (à fond).',
  },
  {
    type: 'pb_moteur', message0: '⚙️ moteur %1 %2 à %3 %',
    args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS },
      { type: 'field_dropdown', name: 'SENS', options: SENS }, nombre('VITESSE')],
    ...suite, style: 'moteur_blocks',
    tooltip: 'Fait tourner un moteur (0 = arrêt, 100 = à fond). ↻ et ↺ choisissent le sens.',
  },
  {
    type: 'pb_moteur_pendant', message0: '⚙️ moteur %1 %2 à %3 % pendant %4 s',
    args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS },
      { type: 'field_dropdown', name: 'SENS', options: SENS }, nombre('VITESSE'), nombre('SECONDES')],
    ...suite, style: 'moteur_blocks',
  },
  {
    type: 'pb_moteur_stop', message0: '✋ arrêter %1',
    args0: [{ type: 'field_dropdown', name: 'PORT',
      options: [['tous les moteurs', 'tous'], ['le moteur A', 'A'], ['le moteur B', 'B'],
        ['le moteur C', 'C'], ['le moteur D', 'D']] }],
    ...suite, style: 'moteur_blocks',
  },
  {
    type: 'pb_vitesse_moteur', message0: 'vitesse du moteur %1',
    args0: [{ type: 'field_dropdown', name: 'PORT', options: PORTS }],
    output: 'Number', style: 'moteur_blocks',
  },
  {
    type: 'pb_attendre', message0: '⏳ attendre %1 s', args0: [nombre('SECONDES')],
    ...suite, style: 'temps_blocks',
    tooltip: 'Attend un moment. Les moteurs continuent ce qu’ils faisaient.',
  },
  {
    type: 'pb_pour_toujours', message0: '🔁 répéter pour toujours %1 %2',
    args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
    previousStatement: null, style: 'loop_blocks',
    tooltip: 'Recommence sans fin (jusqu’à ce qu’on clique sur Stop).',
  },
  {
    type: 'pb_dire', message0: '💬 dire %1', args0: [{ type: 'input_value', name: 'TEXTE' }],
    ...suite, style: 'message_blocks',
  },
  {
    type: 'pb_note', message0: '🎵 jouer %1 pendant %2 s',
    args0: [{ type: 'field_dropdown', name: 'NOTE', options: NOTES }, nombre('SECONDES')],
    ...suite, style: 'message_blocks',
  },
]);

// Les blocs « chapeau » emballent les blocs accrochés dessous : on ne laisse pas le
// générateur les ajouter une seconde fois à la suite.
const CHAPEAUX = new Set(['pb_demarrer', 'pb_touche', 'pb_touche_relachee']);
const RACINES = new Set([...CHAPEAUX, 'procedures_defnoreturn', 'procedures_defreturn']);
for (const g of [JS, PY]) {
  const scrub = g.scrub_;
  g.scrub_ = function (block, code, thisOnly) {
    return scrub.call(this, block, code, thisOnly || CHAPEAUX.has(block.type));
  };
  // Les blocs posés seuls (sans « quand… » au-dessus) ne font rien, même s'ils ne sont pas
  // encore grisés.
  const versCode = g.blockToCode;
  g.blockToCode = function (block, thisOnly) {
    if (block && !block.getParent() && !RACINES.has(block.type)) return block.outputConnection ? ['', 0] : '';
    return versCode.call(this, block, thisOnly);
  };
}

// --- Aides -----------------------------------------------------------------------------
function valeurNombre(block, nom) {   // nombre littéral si possible (code Python plus lisible)
  const b = block.getInputTargetBlock(nom);
  if (b && b.type === 'math_number' && b.isEnabled()) return Number(b.getFieldValue('NUM'));
  return null;
}

function vitesseSignee(block, g, ordreNone) {
  const sens = Number(block.getFieldValue('SENS'));
  const lit = valeurNombre(block, 'VITESSE');
  if (lit !== null) return String(lit * sens);
  const v = g.valueToCode(block, 'VITESSE', ordreNone) || '0';
  return sens < 0 ? `-(${v})` : v;
}

const corpsChapeau = (block, g) => g.blockToCode(block.getNextBlock()) || '';

// --- Générateur JavaScript (exécution dans la page) ---------------------------------------
JS.STATEMENT_PREFIX = 'await pb.bloc(%1);\n';
JS.INFINITE_LOOP_TRAP = 'await pb.tic();\n';
JS.addReservedWords('pb');

const jsNum = (b, nom, def = '0') => JS.valueToCode(b, nom, JO.NONE) || def;

Object.assign(JS.forBlock, {
  pb_demarrer: (b, g) => `pb.quandDemarre(async () => {\n${g.prefixLines(corpsChapeau(b, g), g.INDENT)}});\n`,
  pb_touche: (b, g) => `pb.quandTouche('${b.getFieldValue('TOUCHE')}', async () => {\n` +
    `${g.prefixLines(corpsChapeau(b, g), g.INDENT)}});\n`,
  pb_touche_relachee: (b, g) => `pb.quandRelachee('${b.getFieldValue('TOUCHE')}', async () => {\n` +
    `${g.prefixLines(corpsChapeau(b, g), g.INDENT)}});\n`,
  pb_touche_appuyee: (b) => [`pb.toucheAppuyee('${b.getFieldValue('TOUCHE')}')`, JO.FUNCTION_CALL],
  pb_attendre_touche: (b) => `await pb.attendreTouche('${b.getFieldValue('TOUCHE')}');\n`,
  pb_robot_pendant: (b) => `await pb.robot('${b.getFieldValue('ACTION')}', ${jsNum(b, 'SECONDES')});\n`,
  pb_robot: (b) => `await pb.robot('${b.getFieldValue('ACTION')}');\n`,
  pb_robot_stop: () => 'await pb.arreterRobot();\n',
  pb_robot_vitesse: (b) => `await pb.vitesseRobot(${jsNum(b, 'VITESSE', '100')});\n`,
  pb_moteur: (b, g) => `await pb.moteur('${b.getFieldValue('PORT')}', ${vitesseSignee(b, g, JO.NONE)});\n`,
  pb_moteur_pendant: (b, g) => `await pb.moteurPendant('${b.getFieldValue('PORT')}', ` +
    `${vitesseSignee(b, g, JO.NONE)}, ${jsNum(b, 'SECONDES')});\n`,
  pb_moteur_stop: (b) => `await pb.arreter('${b.getFieldValue('PORT')}');\n`,
  pb_vitesse_moteur: (b) => [`pb.vitesseMoteur('${b.getFieldValue('PORT')}')`, JO.FUNCTION_CALL],
  pb_attendre: (b) => `await pb.attendre(${jsNum(b, 'SECONDES')});\n`,
  pb_pour_toujours: (b, g) => {
    const corps = g.addLoopTrap(g.statementToCode(b, 'DO'), b);
    return `while (true) {\n${corps}}\n`;
  },
  pb_dire: (b) => `await pb.dire(${JS.valueToCode(b, 'TEXTE', JO.NONE) || "''"});\n`,
  pb_note: (b) => `await pb.note('${b.getFieldValue('NOTE')}', ${jsNum(b, 'SECONDES', '0.5')});\n`,
});

// Les fonctions « Mes blocs » doivent être asynchrones pour pouvoir attendre.
for (const t of ['procedures_defreturn', 'procedures_defnoreturn']) {
  const orig = JS.forBlock[t];
  JS.forBlock[t] = function (b, g) {
    const r = orig.call(this, b, g);
    for (const k of Object.keys(g.definitions_)) {
      if (k.startsWith('%')) {   // '%nom' = fonction de l'enfant (pas les aides internes de Blockly)
        // (un commentaire peut précéder « function » : drapeau m)
        g.definitions_[k] = g.definitions_[k].replace(/^function /m, 'async function ');
      }
    }
    return r;
  };
}
{
  // procedures_callnoreturn réutilise procedures_callreturn : un seul « await » suffit.
  const appelR = JS.forBlock.procedures_callreturn;
  JS.forBlock.procedures_callreturn = function (b, g) {
    const [code] = appelR.call(this, b, g);
    return [`(await ${code})`, JO.ATOMIC];
  };
}

// --- Générateur Python (bibliothèque powerbox.facile) --------------------------------------
PY.INDENT = '    ';
PY.addReservedWords('moteur,moteur_pendant,arreter,stop,vitesse_moteur,roues,vitesse_robot,' +
  'avancer,reculer,tourner_gauche,tourner_droite,virage_gauche,virage_droite,arreter_robot,' +
  'robot,attendre,dire,note,quand_touche,quand_touche_relachee,touche_appuyee,attendre_touche,' +
  'ecouter_touches,connecter,deconnecter');

const pyNum = (b, nom, def = '0') => PY.valueToCode(b, nom, PO.NONE) || def;

// « quand j'appuie / je relâche » -> fonction Python décorée, placée en haut du fichier
function pyFonctionTouche(b, g, decorateur, prefixe) {
  const t = b.getFieldValue('TOUCHE');
  const nom = g.nameDB_.getDistinctName(prefixe + t, Blockly.Names.NameType.PROCEDURE);
  const vars = Blockly.Variables.allUsedVarModels(b.workspace).map(v => g.getVariableName(v.getId()));
  let corps = corpsChapeau(b, g);
  if (vars.length) corps = `global ${vars.join(', ')}\n` + corps;
  corps = corps ? g.prefixLines(corps, g.INDENT) : g.INDENT + 'pass\n';
  g.definitions_['%touche_' + b.id] = `@${decorateur}("${t}")\ndef ${nom}():\n${corps}`;
  return null;
}
const pyPort = (b) => `"${b.getFieldValue('PORT')}"`;

Object.assign(PY.forBlock, {
  pb_demarrer: (b, g) => `# 🚩 quand je clique sur Démarrer\n${corpsChapeau(b, g)}`,
  pb_touche: (b, g) => pyFonctionTouche(b, g, 'quand_touche', 'touche_'),
  pb_touche_relachee: (b, g) => pyFonctionTouche(b, g, 'quand_touche_relachee', 'relache_'),
  pb_touche_appuyee: (b) => [`touche_appuyee("${b.getFieldValue('TOUCHE')}")`, PO.FUNCTION_CALL],
  pb_attendre_touche: (b) => {
    const t = b.getFieldValue('TOUCHE');
    return t === 'nimporte' ? 'attendre_touche()\n' : `attendre_touche("${t}")\n`;
  },
  pb_robot_pendant: (b) => `${b.getFieldValue('ACTION')}(${pyNum(b, 'SECONDES')})\n`,
  pb_robot: (b) => `${b.getFieldValue('ACTION')}()\n`,
  pb_robot_stop: () => 'arreter_robot()\n',
  pb_robot_vitesse: (b) => `vitesse_robot(${pyNum(b, 'VITESSE', '100')})\n`,
  pb_moteur: (b, g) => `moteur(${pyPort(b)}, ${vitesseSignee(b, g, PO.NONE)})\n`,
  pb_moteur_pendant: (b, g) => `moteur_pendant(${pyPort(b)}, ${vitesseSignee(b, g, PO.NONE)}, ` +
    `${pyNum(b, 'SECONDES')})\n`,
  pb_moteur_stop: (b) => b.getFieldValue('PORT') === 'tous' ? 'arreter()\n' : `arreter(${pyPort(b)})\n`,
  pb_vitesse_moteur: (b) => [`vitesse_moteur(${pyPort(b)})`, PO.FUNCTION_CALL],
  pb_attendre: (b) => `attendre(${pyNum(b, 'SECONDES')})\n`,
  pb_pour_toujours: (b, g) => `while True:\n${g.statementToCode(b, 'DO') || g.PASS}`,
  pb_dire: (b) => `dire(${PY.valueToCode(b, 'TEXTE', PO.NONE) || "''"})\n`,
  pb_note: (b) => `note("${b.getFieldValue('NOTE')}", ${pyNum(b, 'SECONDES', '0.5')})\n`,
});

// --- Boîte à outils -------------------------------------------------------------------------
const num = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const txt = (t) => ({ shadow: { type: 'text', fields: { TEXT: t } } });
const bloc = (type, fields = {}, inputs = {}, extra = {}) => ({ kind: 'block', type, fields, inputs, ...extra });

const BOITE_A_OUTILS = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: '🚩 Départ', categorystyle: 'evenement', contents: [
      bloc('pb_demarrer'),
      bloc('pb_touche', { TOUCHE: 'haut' }),
      bloc('pb_touche', { TOUCHE: 'espace' }),
    ] },
    { kind: 'category', name: '⌨️ Clavier', categorystyle: 'clavier', contents: [
      bloc('pb_touche', { TOUCHE: 'haut' }),
      bloc('pb_touche_relachee', { TOUCHE: 'haut' }),
      bloc('controls_if', {}, { IF0: { block: { type: 'pb_touche_appuyee', fields: { TOUCHE: 'haut' } } } }),
      bloc('pb_touche_appuyee', { TOUCHE: 'espace' }),
      bloc('pb_attendre_touche', { TOUCHE: 'espace' }),
    ] },
    { kind: 'category', name: '🚗 Robot', categorystyle: 'robot', contents: [
      bloc('pb_robot_pendant', { ACTION: 'avancer' }, { SECONDES: num(2) }),
      bloc('pb_robot_pendant', { ACTION: 'reculer' }, { SECONDES: num(2) }),
      bloc('pb_robot_pendant', { ACTION: 'tourner_gauche' }, { SECONDES: num(0.5) }),
      bloc('pb_robot_pendant', { ACTION: 'tourner_droite' }, { SECONDES: num(0.5) }),
      bloc('pb_robot', { ACTION: 'avancer' }),
      bloc('pb_robot_stop'),
      bloc('pb_robot_vitesse', {}, { VITESSE: num(60) }),
    ] },
    { kind: 'category', name: '⚙️ Moteurs', categorystyle: 'moteur', contents: [
      bloc('pb_moteur', { PORT: 'A', SENS: '1' }, { VITESSE: num(80) }),
      bloc('pb_moteur_pendant', { PORT: 'B', SENS: '1' }, { VITESSE: num(80), SECONDES: num(2) }),
      bloc('pb_moteur_stop', { PORT: 'A' }),
      bloc('pb_moteur_stop', { PORT: 'tous' }),
      bloc('pb_vitesse_moteur', { PORT: 'A' }),
    ] },
    { kind: 'category', name: '⏳ Temps', categorystyle: 'temps', contents: [
      bloc('pb_attendre', {}, { SECONDES: num(1) }),
      bloc('pb_attendre', {}, { SECONDES: num(0.5) }),
    ] },
    { kind: 'category', name: '🔁 Boucles', categorystyle: 'boucle', contents: [
      bloc('controls_repeat_ext', {}, { TIMES: num(4) }),
      bloc('pb_pour_toujours'),
      bloc('controls_whileUntil'),
      bloc('controls_for', { VAR: { name: 'compteur' } }, { FROM: num(0), TO: num(100), BY: num(10) }),
    ] },
    { kind: 'category', name: '🤔 Si… alors', categorystyle: 'logique', contents: [
      bloc('controls_if'),
      bloc('controls_if', {}, {}, { extraState: { hasElse: true } }),
      bloc('logic_compare'),
      bloc('logic_operation'),
      bloc('logic_negate'),
      bloc('logic_boolean'),
    ] },
    { kind: 'category', name: '🔢 Nombres', categorystyle: 'maths', contents: [
      bloc('math_number', { NUM: 10 }),
      bloc('math_arithmetic', {}, { A: num(1), B: num(1) }),
      bloc('math_random_int', {}, { FROM: num(1), TO: num(100) }),
    ] },
    { kind: 'category', name: '💬 Messages', categorystyle: 'message', contents: [
      bloc('pb_dire', {}, { TEXTE: txt('Bonjour !') }),
      bloc('pb_note', { NOTE: 'do' }, { SECONDES: num(0.5) }),
      bloc('text', { TEXT: 'Coucou' }),
      bloc('text_join'),
    ] },
    { kind: 'sep' },
    { kind: 'category', name: '📦 Variables', categorystyle: 'variable', custom: 'VARIABLE' },
    { kind: 'category', name: '🧩 Mes blocs', categorystyle: 'fonction', custom: 'PROCEDURE' },
  ],
};
