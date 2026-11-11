const { z } = require('zod');
const { requiredString } = require('./common');

// Règle de présence par poste : « au moins 1 Opticien à chaque heure d'ouverture »
const createPresenceRuleSchema = z.object({
  jobTitle: requiredString('Le poste').max(100, 'Le poste est trop long (100 caractères au plus).'),
  minCount: z.coerce.number({ error: 'Le nombre est invalide.' })
    .int('Le nombre doit être entier.').min(1, 'Au moins 1 personne.').max(9, 'Au plus 9 personnes.'),
  scope:    z.enum(['toujours', 'jour'], { error: 'Choix invalide.' }),
});

module.exports = { createPresenceRuleSchema };
