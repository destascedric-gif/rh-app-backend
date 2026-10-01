const { z } = require('zod');

// z.string({ error }) couvre le champ absent/mauvais type ; .min(1, error)
// couvre la chaîne vide — même message français dans les deux cas plutôt
// que le message générique de zod ("expected string, received undefined").
const requiredString = (label) => {
  const message = `${label} est obligatoire.`;
  return z.string({ error: message }).trim().min(1, message);
};

const optionalText = () => z.string().trim().optional().or(z.literal(''));

// z.enum(...).optional().or(z.literal('')) donne un message d'union générique
// ("Invalid input") plutôt que celui de l'enum dès que la valeur est une
// chaîne invalide (ni vide, ni une des valeurs autorisées) — le preprocess
// évite le union en transformant '' en undefined avant la vérification.
const optionalEnum = (values, label) => {
  const message = `${label} est invalide.`;
  return z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.enum(values, { error: message }).optional()
  );
};

const email = () => {
  const message = 'Email invalide.';
  return z.string({ error: message }).trim().toLowerCase().email(message);
};

const optionalEmail = () => {
  const message = 'Email invalide.';
  return z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string({ error: message }).trim().toLowerCase().email(message).optional()
  );
};

// Les colonnes TIME de Postgres reviennent en "HH:MM:SS" (ex. depuis les
// modèles de créneau glissés-déposés sur le planning), alors qu'un
// <input type="time"> renvoie "HH:MM" — les deux doivent être acceptés.
// On normalise systématiquement vers "HH:MM" pour que le reste du code
// (comparaisons de chaînes entre horaires) ne mélange jamais les deux
// formats, ce qui fausserait silencieusement une comparaison.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const timeString = (label) => {
  const message = `${label} doit être au format HH:MM.`;
  return z.string({ error: message })
    .regex(TIME_RE, message)
    .transform((v) => v.slice(0, 5));
};

// Même logique que optionalEnum : évite le message d'union générique quand
// la valeur n'est ni vide ni un horaire valide.
const optionalTime = (label) => {
  const message = `${label} doit être au format HH:MM.`;
  return z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string({ error: message }).regex(TIME_RE, message).transform((v) => v.slice(0, 5)).optional()
  );
};

// Les champs numériques arrivent parfois en string depuis un <input> HTML.
const numberLike = () => z.union([z.number(), z.string()]).optional();

// Un <input type="date"> ou "number" laissé vide envoie '' : PostgreSQL le
// refuse pour une colonne DATE ou NUMERIC (erreur 500). Le vide devient donc
// undefined (champ ignoré), et une valeur saisie est vérifiée avant la requête.
const optionalDate = (label) => {
  const message = `${label} doit être une date valide.`;
  return z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, message).optional()
  );
};

const optionalNumber = (label) => {
  const message = `${label} doit être un nombre positif.`;
  return z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.coerce.number({ error: message }).nonnegative(message).optional()
  );
};
const requiredNumberLike = (label) => z.union([z.number(), z.string()], { error: `${label} est obligatoire.` });

module.exports = { requiredString, optionalText, optionalEnum, email, optionalEmail, timeString, optionalTime, numberLike, requiredNumberLike, optionalDate, optionalNumber };
