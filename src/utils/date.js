// Convertit un objet Date en chaîne 'YYYY-MM-DD' à partir de ses composantes
// LOCALES (getFullYear/getMonth/getDate), pas de toISOString() (UTC).
// Nécessaire car le driver pg construit les colonnes DATE en heure locale :
// repasser par toISOString() décale la date d'un jour dès que le serveur
// tourne dans un fuseau horaire en avance sur UTC (ex. Europe/Paris).
const toLocalDateString = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

module.exports = { toLocalDateString };
