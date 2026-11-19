const db     = require('../config/db');
const stripe = require('../config/stripe');
const { FRONTEND_URL, sendMail, DEMO_EMAIL_DOMAIN } = require('../config/mailer');
const { CGV_VERSION }  = require('../config/legal');
const {
  PRICING,
  AI_PRICE,
  computePrice,
  resolveBasePrice,
  checkoutMessage,
  countActiveEmployees,
  applySubscription,
  restartAfterTrialDiscount,
  billingConfigured,
  aiBillingConfigured,
} = require('../services/billing.service');
const { countMonthGenerations } = require('../services/aiUsage.service');

const billingDisabled = (res) =>
  res.status(503).json({ message: 'La facturation en ligne n\'est pas encore disponible.' });

// Le paiement est bloqué sur la démo avec la vraie clé Stripe ; en mode test
// (clé sk_test_), la démo sert justement à essayer le parcours de paiement.
const isDemoEmail = (email) => !String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')
  && String(email || '').toLowerCase().endsWith(DEMO_EMAIL_DOMAIN);

// Stripe exige qu'une période d'essai se termine au moins 48 h plus tard
const MIN_TRIAL_MS = 49 * 3600 * 1000;

// GET /api/billing — état de l'abonnement de l'entreprise
const getBilling = async (req, res) => {
  const { companyId, email } = req.user;

  try {
    const result = await db.query(
      `SELECT plan, subscription_status, current_period_end, cancel_at_period_end, billing_interval,
              stripe_customer_id, stripe_ai_subscription_id, free_forever,
              ai_planning_enabled, ai_option_requested_at,
              created_at + make_interval(months => $2) AS trial_ends_at
       FROM company WHERE id = $1`,
      [companyId, PRICING.trialMonths]
    );
    const company = result.rows[0];
    if (!company) return res.status(404).json({ message: 'Entreprise introuvable.' });

    const activeEmployees = await countActiveEmployees(companyId);
    const trialEndsAt = company.trial_ends_at;
    res.json({
      plan:                company.plan,
      subscriptionStatus:  company.subscription_status,
      currentPeriodEnd:    company.current_period_end,
      cancelAtPeriodEnd:   company.cancel_at_period_end,
      billingInterval:     company.billing_interval,
      hasBillingAccount:   Boolean(company.stripe_customer_id),
      activeEmployees,
      pricing:             PRICING,
      price:               computePrice(activeEmployees),
      freeForever:         company.free_forever,
      trialEndsAt,
      inTrial:             Boolean(trialEndsAt && new Date(trialEndsAt) > new Date()),
      aiPlanningEnabled:   company.ai_planning_enabled,
      aiOptionRequestedAt: company.ai_option_requested_at,
      aiBilledViaStripe:   Boolean(company.stripe_ai_subscription_id),
      aiGenerationsUsed:   company.ai_planning_enabled ? await countMonthGenerations(companyId) : 0,
      billingEnabled:      billingConfigured,
      aiBillingEnabled:    aiBillingConfigured,
      // Compte de démonstration (montré aux prospects) : le paiement y est affiché mais désactivé
      demo:                isDemoEmail(email),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/billing/checkout { product: 'base' | 'ai', interval } — ouvre une
// page de paiement Stripe. 'base' = abonnement Orgaly (au mois ou à l'année ;
// pris pendant l'essai, le premier prélèvement a lieu à la fin de l'essai).
// 'ai' = option IA avancée, au mois, payée dès aujourd'hui. Rien ne change
// dans Orgaly avant la réception du webhook.
const createCheckoutSession = async (req, res) => {
  const { companyId, id: userId } = req.user;
  const { product, interval } = req.body;
  if (product === 'base' ? !billingConfigured : !aiBillingConfigured) return billingDisabled(res);

  try {
    const result = await db.query(
      `SELECT c.name, c.plan, c.free_forever, c.stripe_customer_id, c.stripe_subscription_id, c.stripe_ai_subscription_id,
              c.ai_planning_enabled, u.email,
              c.created_at + make_interval(months => $3) AS trial_ends_at
       FROM company c JOIN users u ON u.id = $2 AND u.company_id = c.id
       WHERE c.id = $1`,
      [companyId, userId, PRICING.trialMonths]
    );
    const company = result.rows[0];
    if (!company) return res.status(404).json({ message: 'Entreprise introuvable.' });
    if (isDemoEmail(company.email)) {
      return res.status(403).json({ message: 'Compte de démonstration : le paiement est désactivé.' });
    }

    let lineItems;
    let employees = 0;
    const subscriptionData = { metadata: { companyId, product } };
    if (product === 'base') {
      if (company.free_forever) return res.status(409).json({ message: 'Votre abonnement est offert.' });
      if (company.stripe_subscription_id) return res.status(409).json({ message: 'Votre abonnement est déjà en place.' });
      employees = await countActiveEmployees(companyId);
      const billed = Math.max(0, employees - PRICING.freeEmployees);
      if (billed === 0) {
        return res.status(409).json({ message: `Rien à payer : Orgaly est gratuit jusqu'à ${PRICING.freeEmployees} salariés.` });
      }
      const base = resolveBasePrice(interval, billed);
      lineItems = [{ price: base.priceId, quantity: base.quantity }];
      const trialEnd = new Date(company.trial_ends_at).getTime();
      if (trialEnd - Date.now() > MIN_TRIAL_MS) subscriptionData.trial_end = Math.floor(trialEnd / 1000);
    } else {
      if (company.ai_planning_enabled || company.stripe_ai_subscription_id) {
        return res.status(409).json({ message: "L'option IA avancée est déjà active." });
      }
      lineItems = [{ price: AI_PRICE, quantity: 1 }];
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

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      customer:             customerId,
      client_reference_id:  companyId,
      line_items:           lineItems,
      // Moyens de paiement : réglés dans le tableau de bord Stripe (cartes, Apple Pay,
      // Link ; le 19 nov. 2026). Stripe refuse désormais payment_method_types ici.
      subscription_data:    subscriptionData,
      locale:               'fr',
      billing_address_collection: 'required',
      // Clientèle professionnelle : on laisse le client saisir son n° de TVA
      tax_id_collection:    { enabled: true },
      customer_update:      { name: 'auto', address: 'auto' },
      // Codes promo créés par Cédric dans Stripe (ex. Black Friday)
      allow_promotion_codes: true,
      // Explique la quantité affichée par Stripe (« × 3 » = salariés payants)
      custom_text:          { submit: { message: checkoutMessage(product, interval, employees) } },
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
      case 'customer.subscription.trial_will_end':
        // Fin d'essai dans 3 jours : relance des offres « après l'essai »
        await restartAfterTrialDiscount(event.data.object.id);
        break;
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

// POST /api/billing/ai-request — le gérant demande l'option « IA avancée »
// (16 nov. 2026) : e-mail à Orgaly (contact@myorgaly.fr) avec l'entreprise,
// le gérant et le nombre de salariés ; « Répondre » écrit au gérant. La date
// est notée (une seule demande). Cédric active ensuite l'option à la main.
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'contact@myorgaly.fr';
const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const requestAiOption = async (req, res) => {
  const { companyId, id: userId } = req.user;
  try {
    const result = await db.query(
      `SELECT c.name, c.ai_planning_enabled, c.ai_option_requested_at,
              u.email, u.first_name, u.last_name
       FROM company c JOIN users u ON u.id = $2 AND u.company_id = c.id
       WHERE c.id = $1`,
      [companyId, userId]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ message: 'Entreprise introuvable.' });
    if (row.ai_planning_enabled) return res.status(409).json({ message: "L'option IA avancée est déjà active." });
    if (row.ai_option_requested_at) return res.json({ requestedAt: row.ai_option_requested_at });

    const employees = await countActiveEmployees(companyId);
    const manager = `${row.first_name || ''} ${row.last_name || ''}`.trim();
    const line = (label, value) =>
      `<tr><td style="padding:4px 16px 4px 0;color:#666">${label}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`;
    await sendMail({
      to: CONTACT_EMAIL,
      replyTo: { email: row.email, name: manager || row.email },
      subject: `[Orgaly] Demande de l'option IA avancée — ${row.name}`,
      html: `
        <h2 style="margin:0 0 12px">Demande de l'option IA avancée</h2>
        <table style="border-collapse:collapse;margin:0 0 16px">
          ${line('Entreprise', row.name)}
          ${line('Gérant', manager)}
          ${line('E-mail', row.email)}
          ${line('Salariés', employees)}
        </table>
        <p style="color:#888;font-size:13px">Pour activer l'option : colonne company.ai_planning_enabled
        (interrupteur du pilotage à venir). « Répondre » écrit directement au gérant.</p>
      `,
    });
    const upd = await db.query(
      'UPDATE company SET ai_option_requested_at = NOW() WHERE id = $1 RETURNING ai_option_requested_at',
      [companyId]
    );
    res.json({ requestedAt: upd.rows[0].ai_option_requested_at });
  } catch (err) {
    console.error('Demande option IA :', err.message);
    res.status(502).json({ message: "La demande n'a pas pu être envoyée. Réessayez, ou écrivez à contact@myorgaly.fr." });
  }
};

module.exports = { getBilling, createCheckoutSession, createPortalSession, handleWebhook, requestAiOption };
