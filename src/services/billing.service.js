const db     = require('../config/db');
const stripe = require('../config/stripe');

// Plan gratuit : jusqu'à 5 employés actifs (l'administrateur n'est pas compté).
// Plan Pro : 3,90 € HT par employé actif et par mois, facturé par Stripe
// (le prix lui-même est défini côté Stripe, STRIPE_PRICE_ID).
const FREE_EMPLOYEE_LIMIT  = 5;
const PRO_PRICE_PER_EMPLOYEE = 3.9;

// Statuts Stripe qui donnent accès au plan Pro. "past_due" en fait partie :
// Stripe relance le paiement pendant plusieurs jours, on ne coupe pas l'accès
// au premier échec de carte.
const PRO_STATUSES = ['active', 'trialing', 'past_due'];

const countActiveEmployees = async (companyId) => {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count FROM users
     WHERE company_id = $1 AND role = 'employee' AND is_active = TRUE`,
    [companyId]
  );
  return result.rows[0].count;
};

const getCompanyPlan = async (companyId) => {
  const result = await db.query('SELECT plan FROM company WHERE id = $1', [companyId]);
  return result.rows[0]?.plan ?? 'free';
};

// Renvoie un message d'erreur si l'entreprise ne peut pas ajouter (ou
// réactiver) un employé de plus avec son plan actuel, sinon null.
const checkEmployeeLimit = async (companyId) => {
  const plan = await getCompanyPlan(companyId);
  if (plan === 'pro') return null;

  const count = await countActiveEmployees(companyId);
  if (count < FREE_EMPLOYEE_LIMIT) return null;

  return `Le plan gratuit est limité à ${FREE_EMPLOYEE_LIMIT} employés actifs. `
    + 'Passez au plan Pro pour en ajouter davantage.';
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
  FREE_EMPLOYEE_LIMIT,
  PRO_PRICE_PER_EMPLOYEE,
  countActiveEmployees,
  checkEmployeeLimit,
  syncSubscriptionQuantity,
  applySubscription,
};
