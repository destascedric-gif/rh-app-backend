const db     = require('../config/db');
const stripe = require('../config/stripe');
const { FRONTEND_URL } = require('../config/mailer');
const { CGV_VERSION }  = require('../config/legal');
const {
  FREE_EMPLOYEE_LIMIT,
  PRO_PRICE_PER_EMPLOYEE,
  countActiveEmployees,
  applySubscription,
} = require('../services/billing.service');

const billingDisabled = (res) =>
  res.status(503).json({ message: 'La facturation en ligne n\'est pas encore disponible.' });

// GET /api/billing — état de l'abonnement de l'entreprise
const getBilling = async (req, res) => {
  const { companyId } = req.user;

  try {
    const result = await db.query(
      `SELECT plan, subscription_status, current_period_end, cancel_at_period_end,
              stripe_customer_id
       FROM company WHERE id = $1`,
      [companyId]
    );
    const company = result.rows[0];
    if (!company) return res.status(404).json({ message: 'Entreprise introuvable.' });

    res.json({
      plan:                company.plan,
      subscriptionStatus:  company.subscription_status,
      currentPeriodEnd:    company.current_period_end,
      cancelAtPeriodEnd:   company.cancel_at_period_end,
      hasBillingAccount:   Boolean(company.stripe_customer_id),
      activeEmployees:     await countActiveEmployees(companyId),
      freeEmployeeLimit:   FREE_EMPLOYEE_LIMIT,
      pricePerEmployee:    PRO_PRICE_PER_EMPLOYEE,
      billingEnabled:      Boolean(stripe && process.env.STRIPE_PRICE_ID),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/billing/checkout — ouvre une session de paiement Stripe pour
// passer au plan Pro. Le plan ne change qu'à la réception du webhook.
const createCheckoutSession = async (req, res) => {
  if (!stripe || !process.env.STRIPE_PRICE_ID) return billingDisabled(res);
  const { companyId, id: userId } = req.user;

  try {
    const result = await db.query(
      `SELECT c.name, c.plan, c.stripe_customer_id, u.email, u.first_name, u.last_name
       FROM company c JOIN users u ON u.id = $2 AND u.company_id = c.id
       WHERE c.id = $1`,
      [companyId, userId]
    );
    const company = result.rows[0];
    if (!company) return res.status(404).json({ message: 'Entreprise introuvable.' });
    if (company.plan === 'pro') {
      return res.status(409).json({ message: 'Votre entreprise est déjà abonnée au plan Pro.' });
    }

    // Un client Stripe par entreprise, créé une seule fois et réutilisé
    // (factures, moyens de paiement et portail restent ainsi regroupés).
    let customerId = company.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name:     company.name,
        email:    company.email,
        metadata: { companyId },
      });
      customerId = customer.id;
      await db.query('UPDATE company SET stripe_customer_id = $1 WHERE id = $2', [customerId, companyId]);
    }

    // Preuve d'acceptation des CGV (case cochée côté frontend, exigée par le validateur)
    await db.query(
      'UPDATE company SET cgv_accepted_at = NOW(), cgv_version = $1 WHERE id = $2',
      [CGV_VERSION, companyId]
    );

    const quantity = Math.max(1, await countActiveEmployees(companyId));

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      customer:             customerId,
      client_reference_id:  companyId,
      line_items:           [{ price: process.env.STRIPE_PRICE_ID, quantity }],
      subscription_data:    { metadata: { companyId } },
      locale:               'fr',
      billing_address_collection: 'required',
      // Clientèle professionnelle : on laisse le client saisir son n° de TVA
      tax_id_collection:    { enabled: true },
      customer_update:      { name: 'auto', address: 'auto' },
      success_url:          `${FRONTEND_URL}/abonnement?statut=succes`,
      cancel_url:           `${FRONTEND_URL}/abonnement?statut=annule`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Impossible d\'ouvrir la page de paiement.' });
  }
};

// POST /api/billing/portal — portail client Stripe : moyen de paiement,
// factures, et résiliation en ligne (obligation légale de résiliation en
// quelques clics, assurée par le portail).
const createPortalSession = async (req, res) => {
  if (!stripe) return billingDisabled(res);
  const { companyId } = req.user;

  try {
    const result = await db.query('SELECT stripe_customer_id FROM company WHERE id = $1', [companyId]);
    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({ message: 'Aucun abonnement n\'a encore été souscrit.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      locale:     'fr',
      return_url: `${FRONTEND_URL}/abonnement`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Impossible d\'ouvrir l\'espace de facturation.' });
  }
};

// POST /api/billing/webhook — appelé par Stripe (corps brut, signature vérifiée)
const handleWebhook = async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return billingDisabled(res);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.warn('Webhook Stripe rejeté (signature invalide) :', err.message);
    return res.status(400).json({ message: 'Signature invalide.' });
  }

  // Stripe ne garantit pas l'ordre de livraison des événements : on relit
  // toujours l'abonnement à jour plutôt que de se fier au contenu de l'événement.
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          await applySubscription(await stripe.subscriptions.retrieve(session.subscription));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(await stripe.subscriptions.retrieve(event.data.object.id));
        break;
      default:
        break; // événement non utilisé : accusé de réception quand même
    }
    res.json({ received: true });
  } catch (err) {
    // 500 → Stripe renverra l'événement plus tard (nouvelles tentatives automatiques)
    console.error('Traitement webhook Stripe :', err);
    res.status(500).json({ message: 'Erreur de traitement.' });
  }
};

module.exports = { getBilling, createCheckoutSession, createPortalSession, handleWebhook };
