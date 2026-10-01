// Crée (une seule fois par compte Stripe : test, puis live) le produit
// "Orgaly Pro" et son prix de 3,90 € HT par employé et par mois.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.js
//
// Affiche l'identifiant du prix à copier dans STRIPE_PRICE_ID. Relancer le
// script ne crée pas de doublon : le prix est retrouvé par sa lookup_key.
require('dotenv').config();
const Stripe = require('stripe');

const LOOKUP_KEY = 'orgaly_pro_monthly_per_employee';

const main = async () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY manquante.');
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], limit: 1 });
  if (existing.data.length > 0) {
    console.log(`Prix déjà existant : STRIPE_PRICE_ID=${existing.data[0].id}`);
    return;
  }

  const product = await stripe.products.create({
    name: 'Orgaly Pro',
    description: 'Logiciel de gestion RH — facturé par employé actif et par mois',
  });

  const price = await stripe.prices.create({
    product:      product.id,
    currency:     'eur',
    unit_amount:  390, // en centimes
    recurring:    { interval: 'month', usage_type: 'licensed' },
    // Micro-entreprise en franchise de TVA : le prix HT est le prix payé.
    tax_behavior: 'exclusive',
    lookup_key:   LOOKUP_KEY,
    nickname:     'Pro mensuel — 3,90 € / employé',
  });

  console.log(`Produit créé : ${product.id}`);
  console.log(`STRIPE_PRICE_ID=${price.id}`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
