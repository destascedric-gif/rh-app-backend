const db     = require('../config/db');
const stripe = require('../config/stripe');

// Tarifs décidés par Cédric le 13 nov. 2026 (affichés et calculés depuis le
// 15 nov. 2026, sans paiement en ligne pour l'instant) :
// - les 3 premiers salariés sont toujours offerts ;
// - 3,90 € HT par salarié en plus et par mois ;
// - plafond de 79 € HT par mois et par boutique (atteint à 24 salariés) ;
// - paiement à l'année : 10 mois payés pour 12 (2 mois offerts) ;
// - 3 mois d'essai gratuits à partir de l'inscription ;
// - option « IA avancée » : 19,90 € HT par mois, 10 générations par mois.
// Salarié compté = compte employé actif ou invitation en attente (le gérant
// n'est pas compté). À garder identique côté site : src/legal/legalInfo.js.
const FREE_EMPLOYEES       = 3;
const PRICE_PER_EMPLOYEE   = 3.9;
const MONTHLY_CAP          = 79;
const ANNUAL_MONTHS_PAID   = 10;
const TRIAL_MONTHS         = 3;
const AI_OPTION_PRICE      = 19.9;
const AI_MONTHLY_GENERATIONS = Number(process.env.AI_PLANNING_MONTHLY_LIMIT) || 10;

// Prix HT pour un nombre de salariés (calcul en centimes, sans arrondi flottant)
const computePrice = (employees) => {
  const billed = Math.max(0, (Number(employees) || 0) - FREE_EMPLOYEES);
  const cents = Math.min(MONTHLY_CAP * 100, billed * Math.round(PRICE_PER_EMPLOYEE * 100));
  return {
    billedEmployees: billed,
    monthly: cents / 100,
    annual: (cents * ANNUAL_MONTHS_PAID) / 100,
    capped: billed * Math.round(PRICE_PER_EMPLOYEE * 100) > MONTHLY_CAP * 100,
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

// Statuts Stripe qui donnent accès au plan Pro. "past_due" en fait partie :
// Stripe relance le paiement pendant plusieurs jours, on ne coupe pas l'accès
// au premier échec de carte.
const PRO_STATUSES = ['active', 'trialing', 'past_due'];

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

// Aligne la quantité facturée sur le nombre d'employés actifs. Appelée après
// chaque ajout / désactivation / réactivation. Un échec ici ne doit jamais
// bloquer l'action RH elle-même : on le journalise (remonté à Sentry) et on continue.
const syncSubscriptionQuantity = async (companyId) => {
  if (!stripe) return;

  try {
    const result = await db.query(
      `SELECT plan, stripe_subscription_item_id FROM company WHERE id = $1`,
      [companyId]
    );
    const company = result.rows[0];
    if (!company || company.plan !== 'pro' || !company.stripe_subscription_item_id) return;

    const quantity = Math.max(1, await countActiveEmployees(companyId));
    await stripe.subscriptionItems.update(company.stripe_subscription_item_id, {
      quantity,
      proration_behavior: 'create_prorations',
    });
  } catch (err) {
    console.error('Synchronisation quantité Stripe :', err.message);
  }
};

// Recopie l'état d'un abonnement Stripe sur l'entreprise correspondante.
// Source de vérité unique pour le champ "plan" (appelée par le webhook).
const applySubscription = async (subscription) => {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;
  const item = subscription.items?.data?.[0];
  const isPro = PRO_STATUSES.includes(subscription.status);
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  // Un abonnement terminé libère l'entreprise : elle repasse en gratuit et
  // pourra en souscrire un nouveau plus tard.
  const ended = ['canceled', 'incomplete_expired'].includes(subscription.status);

  const result = await db.query(
    `UPDATE company SET
       plan                        = $1,
       stripe_subscription_id      = $2,
       stripe_subscription_item_id = $3,
       subscription_status         = $4,
       current_period_end          = $5,
       cancel_at_period_end        = $6
     WHERE stripe_customer_id = $7
       AND (stripe_subscription_id IS NULL OR stripe_subscription_id = $8)
     RETURNING id`,
    [
      isPro ? 'pro' : 'free',
      ended ? null : subscription.id,
      ended ? null : item?.id ?? null,
      subscription.status,
      ended ? null : periodEnd,
      Boolean(subscription.cancel_at_period_end),
      customerId,
      subscription.id,
    ]
  );

  return result.rows[0]?.id ?? null;
};

module.exports = {
  PRICING,
  FREE_EMPLOYEES,
  PRICE_PER_EMPLOYEE,
  TRIAL_MONTHS,
  AI_MONTHLY_GENERATIONS,
  computePrice,
  countActiveEmployees,
  syncSubscriptionQuantity,
  applySubscription,
};
