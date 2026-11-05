const { z } = require('zod');
const { requiredString } = require('./common');

// Compte qui voit l'ensemble des clients : mot de passe plus exigeant que
// pour un compte gérant.
const ownerSetupSchema = z.object({
  token: requiredString('Le lien'),
  password: z.string({ error: 'Le mot de passe est obligatoire.' })
    .min(12, 'Le mot de passe doit faire au moins 12 caractères.')
    .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule.')
    .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre.')
    .regex(/[^A-Za-z0-9]/, 'Le mot de passe doit contenir au moins un caractère spécial.'),
});

module.exports = { ownerSetupSchema };
