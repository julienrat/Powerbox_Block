/* Programmes d'exemple (format de sauvegarde JSON de Blockly, construit avec de petites aides). */
'use strict';

// b('type', {CHAMP: valeur}, {ENTREE: 2 | 'texte' | b(...) | [suite de blocs]})
function b(type, fields = {}, inputs = {}, extra = {}) {
  const ins = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (typeof v === 'number') ins[k] = { shadow: { type: 'math_number', fields: { NUM: v } } };
    else if (typeof v === 'string') ins[k] = { shadow: { type: 'text', fields: { TEXT: v } } };
    else if (Array.isArray(v)) ins[k] = { block: chaine(v) };
    else ins[k] = { block: v };
  }
  return { type, fields, inputs: ins, ...extra };
}

function chaine(blocs) {          // relie les blocs les uns sous les autres
  for (let i = blocs.length - 2; i >= 0; i--) blocs[i].next = { block: blocs[i + 1] };
  return blocs[0];
}

function programme(piles, variables = []) {
  return {
    blocks: { languageVersion: 0, blocks: piles.map(([x, y, blocs]) => ({ ...chaine(blocs), x, y })) },
    variables,
  };
}

const robotP = (action, s) => b('pb_robot_pendant', { ACTION: action }, { SECONDES: s });
const VAR_V = { id: 'var-vitesse', name: 'vitesse' };

const EXEMPLES = {
  premier: {
    titre: '🌱 Premier pas',
    donnees: programme([[40, 40, [
      b('pb_demarrer'),
      robotP('avancer', 2),
      robotP('tourner_droite', 0.5),
      robotP('avancer', 2),
      b('pb_dire', {}, { TEXTE: 'J’ai fini ! 🎉' }),
    ]]]),
  },
  carre: {
    titre: '⬜ Dessiner un carré',
    donnees: programme([[40, 40, [
      b('pb_demarrer'),
      b('controls_repeat_ext', {}, { TIMES: 4, DO: [robotP('avancer', 1.5), robotP('tourner_droite', 0.52)] }),
      b('pb_note', { NOTE: 'do2' }, { SECONDES: 0.5 }),
      b('pb_dire', {}, { TEXTE: 'Un carré !' }),
    ]]]),
  },
  danse: {
    titre: '💃 La danse du robot',
    donnees: programme([[40, 40, [
      b('pb_demarrer'),
      b('pb_robot_vitesse', {}, { VITESSE: 70 }),
      b('controls_repeat_ext', {}, { TIMES: 3, DO: [
        robotP('tourner_gauche', 0.4),
        b('pb_note', { NOTE: 'do' }, { SECONDES: 0.2 }),
        robotP('tourner_droite', 0.4),
        b('pb_note', { NOTE: 'mi' }, { SECONDES: 0.2 }),
      ] }),
      robotP('reculer', 1),
      b('pb_note', { NOTE: 'sol' }, { SECONDES: 0.4 }),
      b('pb_dire', {}, { TEXTE: 'Ta-da ! 💃' }),
    ]]]),
  },
  telecommande: {
    titre: '🎮 Télécommande au clavier',
    donnees: programme([
      [40, 30, [b('pb_demarrer'), b('pb_dire', {}, { TEXTE: 'Utilise les flèches !' })]],
      [40, 150, [b('pb_touche', { TOUCHE: 'haut' }), robotP('avancer', 0.3)]],
      [40, 250, [b('pb_touche', { TOUCHE: 'bas' }), robotP('reculer', 0.3)]],
      [40, 350, [b('pb_touche', { TOUCHE: 'gauche' }), robotP('tourner_gauche', 0.15)]],
      [40, 450, [b('pb_touche', { TOUCHE: 'droite' }), robotP('tourner_droite', 0.15)]],
      [40, 550, [b('pb_touche', { TOUCHE: 'espace' }), b('pb_note', { NOTE: 'la' }, { SECONDES: 0.3 }),
        b('pb_dire', {}, { TEXTE: 'Bip bip !' })]],
    ]),
  },
  pilotage: {
    titre: '🏎️ Pilotage (garder la touche)',
    donnees: programme([[40, 40, [
      b('pb_demarrer'),
      b('pb_dire', {}, { TEXTE: 'Appuie sur espace pour partir !' }),
      b('pb_attendre_touche', { TOUCHE: 'espace' }),
      b('pb_dire', {}, { TEXTE: 'Garde les flèches appuyées !' }),
      b('pb_pour_toujours', {}, { DO: [
        b('controls_if', {}, {
          IF0: b('pb_touche_appuyee', { TOUCHE: 'haut' }), DO0: [b('pb_robot', { ACTION: 'avancer' })],
          IF1: b('pb_touche_appuyee', { TOUCHE: 'bas' }), DO1: [b('pb_robot', { ACTION: 'reculer' })],
          IF2: b('pb_touche_appuyee', { TOUCHE: 'gauche' }), DO2: [b('pb_robot', { ACTION: 'tourner_gauche' })],
          IF3: b('pb_touche_appuyee', { TOUCHE: 'droite' }), DO3: [b('pb_robot', { ACTION: 'tourner_droite' })],
          ELSE: [b('pb_robot_stop')],
        }, { extraState: { elseIfCount: 3, hasElse: true } }),
        b('pb_attendre', {}, { SECONDES: 0.05 }),
      ] }),
    ]]]),
  },
  acceleration: {
    titre: '🚀 Le moteur accélère',
    donnees: programme([[40, 40, [
      b('pb_demarrer'),
      b('controls_for', { VAR: { id: VAR_V.id } }, { FROM: 0, TO: 100, BY: 10, DO: [
        b('pb_moteur', { PORT: 'A', SENS: '1' }, { VITESSE: b('variables_get', { VAR: { id: VAR_V.id } }) }),
        b('pb_attendre', {}, { SECONDES: 0.4 }),
      ] }),
      b('pb_moteur_stop', { PORT: 'A' }),
      b('pb_dire', {}, { TEXTE: 'Vroum !' }),
    ]]], [VAR_V]),
  },
  essuieglace: {
    titre: '🌧️ Essuie-glace (pour toujours)',
    donnees: programme([[40, 40, [
      b('pb_demarrer'),
      b('pb_pour_toujours', {}, { DO: [
        b('pb_moteur_pendant', { PORT: 'B', SENS: '1' }, { VITESSE: 60, SECONDES: 0.6 }),
        b('pb_moteur_pendant', { PORT: 'B', SENS: '-1' }, { VITESSE: 60, SECONDES: 0.6 }),
      ] }),
    ]]]),
  },
};
