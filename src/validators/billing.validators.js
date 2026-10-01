const { z } = require('zod');

const checkoutSchema = z.object({
  acceptCgv: z.literal(true, {
    error: 'Vous devez accepter les conditions générales de vente pour vous abonner.',
  }),
});

module.exports = { checkoutSchema };
