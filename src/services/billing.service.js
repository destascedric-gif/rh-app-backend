const db     = require('../config/db');
const stripe = require('../config/stripe');

// Tarifs décidés par Cédric le 13 nov. 2026 (affichés et calculés depuis le
// 15 nov. 2026 ; payables via Stripe depuis le 17 nov. 2026) :
// - les 3 premiers salariés sont toujours offerts ;
// - 3,90 € HT par salarié en plus et par mois ;
// - plafond de 79 € HT par mois et par boutique (atteint à 24 salariés) ;
// - paiement à l'année : 10 mois payés pour 12 (2 mois offerts) ;
// - 3 mois d'essai gratuits à partir de l'inscription ;
// - option « IA avancée » : 19,90 € HT par mois (au mois seulement),
//   10 générations par mois.
// Salarié compté = compte employé actif ou invitation en attente (le gérant
// n'est pas compté). À garder identique côté site : src/legal/legalInfo.js.
const FREE_EMPLOYEES       = 3;
const PRICE_PER_EMPLOYEE   = 3.9;
const MONTHLY_CAP          = 79;
const ANNUAL_MONTHS_PAID   = 10;
const TRIAL_MONTHS         = 3;
const AI_OPTION_PRICE      = 19.9;
const AI_MONTHLY_GENERATIONS = Number(process.env.AI_PLANNING_MONTHLY_LIMIT) || 10;

const PRICE_PER_EMPLOYEE_CENTS = Math.round(PRICE_PER_EMPLOYEE * 100); // 390
const MONTHLY_CAP_CENTS        = Math.round(MONTHLY_CAP * 100);        // 7900

// Prix HT pour un nombre de salariés (calcul en centimes, sans arrondi flottant)
const computePrice = (employees) => {
  const billed = Math.max(0, (Number(employees) || 0) - FREE_EMPLOYEES);
  const cents = Math.min(MONTHLY_CAP_CENTS, billed * PRICE_PER_EMPLOYEE_CENTS);
  return {
    billedEmployees: billed,
    monthly: cents / 100,
    annual: (cents * ANNUAL_MONTHS_PAID) / 100,
    capped: billed * PRICE_PER_EMPLOYEE_CENTS > MONTHLY_CAP_CENTS,
  };
};

const PRICING = {
  freeEmployees: FREE_EMPLOYEES,
  pricePerEmployee: PRICE_PER_EMPLOYEE,
  monthlyCap: MONTHLY_CAP,
  annualMonthsPaid: ANNUAL_MONTHS_PAID,
  trialMonths: TRIAL_MONTHS,
  aiOptionPrice: AI_OPTION_PRICE,
  aiMonthlyGenerations: AI_MONTHLY_GENERATIONS,
};

// Prix Stripe créés par scripts/stripe-setup.js. Abonnement Orgaly : deux
// prix par rythme (par salarié en plus tant que le plafond n'est pas
// atteint, puis un prix fixe au plafond). Option IA : un prix mensuel.
const BASE_PRICES = {
  month: { perEmployee: process.env.STRIPE_PRICE_PRO_MONTHLY, capped: process.env.STRIPE_PRICE_PRO_MONTHLY_CAPPED },
  year:  { perEmployee: process.env.STRIPE_PRICE_PRO_ANNUAL,  capped: process.env.STRIPE_PRICE_PRO_ANNUAL_CAPPED },
};
const AI_PRICE = process.env.STRIPE_PRICE_AI_MONTHLY;

const BASE_PRICE_IDS = new Set(Object.values(BASE_PRICES).flatMap((p) => [p.perEmployee, p.capped]).filter(Boolean));

const billingConfigured = Boolean(
  stripe && BASE_PRICES.month.perEmployee && BASE_PRICES.month.capped
         && BASE_PRICES.year.perEmployee  && BASE_PRICES.year.capped
);
const aiBillingConfigured = Boolean(stripe && AI_PRICE);

// Prix Stripe (et quantité) de l'abonnement Orgaly selon le rythme et le
// nombre de salariés facturés : au-delà du plafond, prix fixe en quantité 1.
const resolveBasePrice = (interval, billedEmployees) => {
  const prices = BASE_PRICES[interval];
  if (!prices) return null;
  return billedEmployees * PRICE_PER_EMPLOYEE_CENTS > MONTHLY_CAP_CENTS
    ? { priceId: prices.capped, quantity: 1 }
    : { priceId: prices.perEmployee, quantity: billedEmployees };
};

// Statuts Stripe qui donnent accès. "past_due" en fait partie : Stripe
// relance le paiement pendant plusieurs jours, on ne coupe pas l'accès au
// premier échec de carte. "trialing" = abonnement pris pendant l'essai,
// premier prélèvement à la fin de l'essai.
const PRO_STATUSES = ['active', 'trialing', 'past_due'];
const ENDED_STATUSES = ['canceled', 'incomplete_expired'];

// Salariés comptés : comptes employés actifs, invitations en attente
// comprises (un compte invité est actif dès sa création).
const countActiveEmployees = async (companyId) => {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM users
     WHERE company_id = $1 AND role = 'employee' AND is_active = TRUE`,
    [companyId]
  );
  return result.rows[0].count;
};

// Aligne l'abonnement Orgaly sur le nombre de salariés, en changeant de prix
// (par salarié ↔ plafond) si le seuil est franchi. Appelée après chaque
// ajout / désactivation / réactivation. Un échec ici ne doit jamais bloquer
// l'action RH elle-même : on le journalise (remonté à Sentry) et on continue.
const syncSubscriptionQuantity = async (companyId) => {
  if (!stripe) return;

  try {
    const result = await db.query(
      `SELECT plan, billing_interval, stripe_subscription_id, stripe_subscription_item_id
       FROM company WHERE id = $1`,
      [companyId]
    );
    const company = result.rows[0];
    if (!company || company.plan !== 'pro' || !company.stripe_subscription_item_id || !company.billing_interval) return;

    const billed = Math.max(0, (await countActiveEmployees(companyId)) - FREE_EMPLOYEES);

    // Retour à 3 salariés ou moins : plus rien à payer. Stripe ne permet pas
    // de vider un abonnement : on l'arrête, avec un avoir pour la période
    // déjà payée (déduit d'un prochain abonnement).
    if (billed === 0) {
      await stripe.subscriptions.cancel(company.stripe_subscription_id, { prorate: true });
      return;
    }

    const resolved = resolveBasePrice(company.billing_interval, billed);
    await stripe.subscriptionItems.update(company.stripe_subscription_item_id, {
      price:    resolved.priceId,
      quantity: resolved.quantity,
      proration_behavior: 'create_prorations',
    });
  } catch (err) {
    console.error('Synchronisation abonnement Stripe :', err.message);
  }
};

// Recopie l'état d'un abonnement Stripe sur l'entreprise (appelée par le
// webhook, seule source de vérité). L'abonnement Orgaly met à jour "plan" ;
// l'abonnement de l'option IA met à jour "ai_planning_enabled". Les deux
// sont reconnus par leurs prix.
const applySubscription = async (subscription) => {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;
  const items = subscription.items?.data || [];
  const active = PRO_STATUSES.includes(subscription.status);
  const ended = ENDED_STATUSES.includes(subscription.status);

  if (items.some((it) => it.price?.id === AI_PRICE)) {
    const result = await db.query(
      `UPDATE company SET
         ai_planning_enabled       = $1,
         ai_option_requested_at    = CASE WHEN $1 THEN NULL ELSE ai_option_requested_at END,
         stripe_ai_subscription_id = $2
       WHERE stripe_customer_id = $3
         AND (stripe_ai_subscription_id IS NULL OR stripe_ai_subscription_id = $4)
       RETURNING id`,
      [active, ended ? null : subscription.id, customerId, subscription.id]
    );
    return result.rows[0]?.id ?? null;
  }

  const item = items.find((it) => BASE_PRICE_IDS.has(it.price?.id));
  if (!item) return null; // abonnement inconnu (créé à la main dans Stripe ?)

  const periodEnd = item.current_period_end ? new Date(item.current_period_end * 1000) : null;
  const result = await db.query(
    `UPDATE company SET
       plan                        = $1,
       stripe_subscription_id      = $2,
       stripe_subscription_item_id = $3,
       subscription_status         = $4,
       current_period_end          = $5,
       cancel_at_period_end        = $6,
       billing_interval            = $7
     WHERE stripe_customer_id = $8
       AND (stripe_subscription_id IS NULL OR stripe_subscription_id = $9)
     RETURNING id`,
    [
      active ? 'pro' : 'free',
      ended ? null : subscription.id,
      ended ? null : item.id,
      subscription.status,
      ended ? null : periodEnd,
      Boolean(subscription.cancel_at_period_end),
      ended ? null : item.price?.recurring?.interval ?? null,
      customerId,
      subscription.id,
    ]
  );

  return result.rows[0]?.id ?? null;
};

// Offres « après l'essai » (ex. Black Friday 2026 : −20 % pendant 3 mois
// après l'essai). Stripe fait démarrer la réduction le jour de la
// souscription : prise pendant l'essai, elle serait en partie consommée
// avant le premier paiement (vérifié le 17 nov. 2026 avec une horloge de
// test : 1 seul mois réduit sur 3). Quand Stripe annonce la fin de l'essai
// (3 jours avant), on repose donc le même coupon, qui repart pour sa durée
// complète. Seuls les coupons marqués metadata.apres_essai = 'oui' sont concernés.
const discountCouponId = (d) => {
  const c = d?.coupon ?? d?.source?.coupon;
  return typeof c === 'string' ? c : c?.id ?? null;
};

const restartAfterTrialDiscount = async (subscriptionId) => {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['discounts'] });
  if (sub.status !== 'trialing') return;
  for (const d of sub.discounts || []) {
    const couponId = discountCouponId(d);
    if (!couponId) continue;
    const coupon = await stripe.coupons.retrieve(couponId);
    if (coupon.metadata?.apres_essai !== 'oui' || !coupon.valid) continue;
    // Reposer le même coupon garde l'ancienne date de départ : on le retire d'abord
    await stripe.subscriptions.update(sub.id, { discounts: '' });
    await stripe.subscriptions.update(sub.id, { discounts: [{ coupon: couponId }] });
    return;
  }
};

module.exports = {
  PRICING,
  FREE_EMPLOYEES,
  PRICE_PER_EMPLOYEE,
  TRIAL_MONTHS,
  AI_MONTHLY_GENERATIONS,
  AI_PRICE,
  billingConfigured,
  aiBillingConfigured,
  computePrice,
  resolveBasePrice,
  countActiveEmployees,
  syncSubscriptionQuantity,
  applySubscription,
  restartAfterTrialDiscount,
};
