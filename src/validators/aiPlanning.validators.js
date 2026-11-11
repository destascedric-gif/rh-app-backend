const { z } = require('zod');

// Le gérant confirme que la fiche (heures du contrat) est juste
const confirmContractSchema = z.object({
  userId: z.string({ error: 'Salarié invalide.' }).uuid('Salarié invalide.'),
});

module.exports = { confirmContractSchema };
