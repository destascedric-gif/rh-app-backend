// Couleurs des horaires types (créneaux glissables). Chaque nouvel horaire
// reçoit la première couleur pas encore utilisée par l'entreprise ; l'admin
// peut la changer dans Paramètres. Teintes assez foncées pour un texte blanc
// lisible (vue mois sur téléphone) et distinctes aussi en luminosité.
const SHIFT_PALETTE = [
  '#3457D5', // bleu (historiquement : ouverture)
  '#B9791E', // ambre (historiquement : fermeture)
  '#1F7A5A', // vert
  '#8A3FB0', // violet
  '#C2416B', // framboise
  '#0E7490', // bleu canard
  '#C2581A', // orange brûlé
  '#4D5B7C', // ardoise
];

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

// Première couleur de la palette non utilisée ; si toutes le sont, on
// recommence le cycle selon le nombre d'horaires existants.
const pickFreeColor = (usedColors) => {
  const used = new Set(usedColors.filter(Boolean).map((c) => c.toUpperCase()));
  return SHIFT_PALETTE.find((c) => !used.has(c.toUpperCase()))
    ?? SHIFT_PALETTE[usedColors.length % SHIFT_PALETTE.length];
};

module.exports = { SHIFT_PALETTE, HEX_COLOR, pickFreeColor };
