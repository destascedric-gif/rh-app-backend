// Crée (une seule fois par compte Stripe : test, puis live) les produits et
// prix Orgaly, pour les nouveaux tarifs du 13 nov. 2026 (3 salariés offerts,
// 3,90 € HT par salarié en plus, plafond 79 € HT/mois, 10 mois payés pour 12
// à l'année) et l'option IA avancée (19,90 € HT/mois, au mois seulement).
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.js
//
// Affiche les 5 lignes à copier dans .env (STRIPE_PRICE_PRO_MONTHLY,
// STRIPE_PRICE_PRO_MONTHLY_CAPPED, STRIPE_PRICE_PRO_ANNUAL,
// STRIPE_PRICE_PRO_ANNUAL_CAPPED, STRIPE_PRICE_AI_MONTHLY).
// Relancer le script ne crée pas de doublon : les
// prix sont retrouvés par leur lookup_key.
require('dotenv').config();
const Stripe = require('stripe');

const PRICES = [
  {
    env: 'STRIPE_PRICE_PRO_MONTHLY',
    lookup_key: 'orgaly_pro_monthly_per_employee',
    nickname: 'Pro mensuel — 3,90 € / salarié en plus',
    product: 'pro',
    unit_amount: 390,
    recurring: { interval: 'month', usage_type: 'licensed' },
  },
  {
    env: 'STRIPE_PRICE_PRO_MONTHLY_CAPPED',
    lookup_key: 'orgaly_pro_monthly_capped',
    nickname: 'Pro mensuel — plafond 79 €',
    product: 'pro',
    unit_amount: 7900,
    recurring: { interval: 'month', usage_type: 'licensed' },
  },
  {
    env: 'STRIPE_PRICE_PRO_ANNUAL',
    lookup_key: 'orgaly_pro_annual_per_employee',
    nickname: 'Pro annuel — 39,00 € / salarié en plus (10 mois sur 12)',
    product: 'pro',
    unit_amount: 3900,
    recurring: { interval: 'year', usage_type: 'licensed' },
  },
  {
    env: 'STRIPE_PRICE_PRO_ANNUAL_CAPPED',
    lookup_key: 'orgaly_pro_annual_capped',
    nickname: 'Pro annuel — plafond 790 € (10 mois sur 12)',
    product: 'pro',
    unit_amount: 79000,
    recurring: { interval: 'year', usage_type: 'licensed' },
  },
  {
    env: 'STRIPE_PRICE_AI_MONTHLY',
    lookup_key: 'orgaly_ai_monthly',
    nickname: 'Option IA avancée — mensuel',
    product: 'ai',
    unit_amount: 1990,
    recurring: { interval: 'month', usage_type: 'licensed' },
  },
];

const main = async () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY manquante.');
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Recherche par nom plutôt que par l'API Search (pas de délai d'indexation,
  // fiable juste après une création).
  const existingProducts = await stripe.products.list({ limit: 100 });
  const products = {
    pro: existingProducts.data.find((p) => p.name === 'Orgaly Pro') || null,
    ai:  existingProducts.data.find((p) => p.name === 'Orgaly - Option IA avancée') || null,
  };
  if (!products.pro) {
    products.pro = await stripe.products.create({
      name: 'Orgaly Pro',
      description: "Logiciel de gestion d'équipe — facturé par salarié actif et par mois (3 premiers offerts)",
    });
    console.log(`Produit créé : ${products.pro.id} (Orgaly Pro)`);
  }
  if (!products.ai) {
    products.ai = await stripe.products.create({
      name: 'Orgaly - Option IA avancée',
      description: 'Planning du mois préparé par intelligence artificielle, 10 générations par mois',
    });
    console.log(`Produit créé : ${products.ai.id} (Orgaly - Option IA avancée)`);
  }

  const lines = [];
  for (const def of PRICES) {
    const existing = await stripe.prices.list({ lookup_keys: [def.lookup_key], limit: 1 });
    if (existing.data.length > 0) {
      lines.push(`${def.env}=${existing.data[0].id}`);
      continue;
    }
    const price = await stripe.prices.create({
      product:      products[def.product].id,
      currency:     'eur',
      unit_amount:  def.unit_amount,
      recurring:    def.recurring,
      // Micro-entreprise en franchise de TVA : le prix HT est le prix payé.
      tax_behavior: 'exclusive',
      lookup_key:   def.lookup_key,
      nickname:     def.nickname,
    });
    lines.push(`${def.env}=${price.id}`);
  }

  console.log('\nÀ copier dans .env :\n');
  console.log(lines.join('\n'));
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
