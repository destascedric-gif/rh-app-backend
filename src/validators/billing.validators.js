const { z } = require('zod');

const checkoutSchema = z.object({
  acceptCgv: z.literal(true, {
    error: 'Vous devez accepter les conditions générales de vente pour vous abonner.',
  }),
  product:  z.enum(['base', 'ai']).default('base'),
  interval: z.enum(['month', 'year']).default('month'),
});

module.exports = { checkoutSchema };
