const { z } = require('zod');

// Règle de présence : « au moins 1 Opticien diplômé ou Opticienne diplômée à
// chaque heure d'ouverture ». Un ou plusieurs postes : une personne de l'un
// d'eux suffit (11 nov. 2026, demande de Cédric).
const createPresenceRuleSchema = z.object({
  jobTitles: z.array(
    z.string({ error: 'Poste invalide.' }).trim().min(1, 'Poste invalide.').max(100, 'Poste trop long (100 caractères au plus).'),
    { error: 'Choisissez au moins un poste.' }
  )
    .min(1, 'Choisissez au moins un poste.')
    .max(20, 'Au plus 20 postes par règle.')
    // Sans doublon (majuscules et espaces ignorés)
    .transform((titles) => titles.filter((t, i) => titles.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)),
  minCount: z.coerce.number({ error: 'Le nombre est invalide.' })
    .int('Le nombre doit être entier.').min(1, 'Au moins 1 personne.').max(9, 'Au plus 9 personnes.'),
  scope:    z.enum(['toujours', 'jour'], { error: 'Choix invalide.' }),
});

module.exports = { createPresenceRuleSchema };
