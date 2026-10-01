const { z } = require('zod');

// Nombre optionnel borné : '' ou null = champ ignoré. Les bornes basses sont
// les minimums légaux (Code du travail) : une convention collective ou un
// accord d'entreprise peut prévoir plus favorable, jamais moins.
const boundedNumber = (label, min, max, minMessage) => z.preprocess(
  (val) => (val === '' || val === null ? undefined : val),
  z.coerce.number({ error: `${label} doit être un nombre.` })
    .min(min, minMessage)
    .max(max, `${label} : ${String(max).replace('.', ',')} maximum.`)
    .optional()
);

const OVERTIME_MIN_MESSAGE = 'La majoration des heures sup ne peut pas être inférieure à +10 % (1,10), minimum légal (article L3121-33 du Code du travail).';

const updateSettingsSchema = z.object({
  defaultWeeklyHours: boundedNumber('La durée hebdomadaire', 1, 48,
    'La durée hebdomadaire doit être d\'au moins 1 h.'),
  leaveAccrualPerMonth: boundedNumber('L\'acquisition de congés', 2.08, 5,
    'Le minimum légal est de 2,08 jours ouvrés par mois, soit 5 semaines par an (article L3141-3 du Code du travail).'),
  overtimeTier1Rate: boundedNumber('La majoration du palier 1', 1.1, 3, OVERTIME_MIN_MESSAGE),
  overtimeTier2Rate: boundedNumber('La majoration du palier 2', 1.1, 3, OVERTIME_MIN_MESSAGE),
  overtimeTier2ThresholdHours: boundedNumber('Le seuil du palier 2', 35, 48,
    'Le seuil du palier 2 doit être d\'au moins 35 h.'),
  managerInSchedule:   z.boolean({ error: 'Valeur invalide.' }).optional(),
  meetingsCountAsWork: z.boolean({ error: 'Valeur invalide.' }).optional(),
  primaryColor: z.string().trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur invalide (format hex, ex. #1C4ED8).')
    .optional().or(z.literal('')),
});

module.exports = { updateSettingsSchema };
