// Offre Black Friday 2026 (décidée par Cédric le 17 nov. 2026) : code
// BLACKFRIDAY, −20 % pendant les 3 premiers mois payés après l'essai, sur
// l'abonnement Orgaly seulement (pas l'option IA), valable du vendredi
// 27 au lundi 30 novembre 2026 inclus (heure de Paris). Un code ne se tape
// qu'à la souscription : pas besoin de le réserver aux nouveaux clients.
//
//   node scripts/stripe-black-friday.js            (crée, code inactif)
//   node scripts/stripe-black-friday.js --activer  (active le code)
//
// Stripe ne sait pas faire démarrer un code à une date : il est créé
// inactif puis activé le 27 au matin (ici ou dans Stripe : Catalogue de
// produits → Coupons → BLACKFRIDAY → activer). Il expire tout seul le
// 30 novembre à minuit. Le coupon porte metadata.apres_essai = 'oui' :
// le serveur relance la réduction à la fin de l'essai (sinon l'essai la
// consommerait, voir restartAfterTrialDiscount). Relancer le script ne crée
// pas de doublon.
require('dotenv').config();
const Stripe = require('stripe');

const CODE = 'BLACKFRIDAY';
const COUPON_ID = 'black-friday-2026';
const EXPIRES_AT = Math.floor(Date.parse('2026-12-01T00:00:00+01:00') / 1000);

const main = async () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY manquante.');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const activate = process.argv.includes('--activer');

  const products = await stripe.products.list({ limit: 100 });
  const pro = products.data.find((p) => p.name === 'Orgaly Pro');
  if (!pro) throw new Error('Produit « Orgaly Pro » introuvable : lancer d\'abord scripts/stripe-setup.js.');

  let coupon = await stripe.coupons.retrieve(COUPON_ID).catch(() => null);
  if (!coupon) {
    coupon = await stripe.coupons.create({
      id: COUPON_ID,
      name: 'Black Friday : −20 % pendant 3 mois',
      percent_off: 20,
      duration: 'repeating',
      duration_in_months: 3,
      applies_to: { products: [pro.id] },
      metadata: { apres_essai: 'oui' },
    });
    console.log(`Coupon créé : ${coupon.id}`);
  }

  let promo = (await stripe.promotionCodes.list({ code: CODE, limit: 1 })).data[0];
  if (!promo) {
    promo = await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: coupon.id },
      code: CODE,
      active: activate,
      expires_at: EXPIRES_AT,
    }).catch(async (err) => {
      // Anciennes versions de l'API : coupon directement
      if (!/promotion/.test(err.message)) throw err;
      return stripe.promotionCodes.create({
        coupon: coupon.id, code: CODE, active: activate, expires_at: EXPIRES_AT,
      });
    });
    console.log(`Code créé : ${promo.code} (${promo.active ? 'actif' : 'inactif'})`);
  } else if (activate && !promo.active) {
    promo = await stripe.promotionCodes.update(promo.id, { active: true });
    console.log(`Code ${promo.code} activé.`);
  } else {
    console.log(`Code ${promo.code} déjà présent (${promo.active ? 'actif' : 'inactif'}).`);
  }
  console.log(`Expire le ${new Date(promo.expires_at * 1000).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} (heure de Paris).`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
