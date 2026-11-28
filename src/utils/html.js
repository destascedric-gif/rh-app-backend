// Texte saisi par un utilisateur (prénom, motif…) placé dans un e-mail HTML :
// échappé pour qu'il s'affiche tel quel, sans pouvoir ajouter de lien ou de
// mise en forme (audit du 28 nov. 2026).
const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

module.exports = { escapeHtml };
