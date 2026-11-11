const { z } = require('zod');

// Pilotage : recharge du crédit Anthropic, ou solde réel relevé sur la Console
const creditEventSchema = z.object({
  kind:   z.enum(['recharge', 'releve'], { error: 'Type invalide.' }),
  amount: z.coerce.number({ error: 'Montant invalide.' })
    .min(0, 'Le montant ne peut pas être négatif.')
    .max(100000, 'Montant trop élevé.'),
});

module.exports = { creditEventSchema };
