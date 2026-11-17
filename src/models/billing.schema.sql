-- ============================================
-- APPLICATION RH - SCHEMA FACTURATION (Stripe) & ACCEPTATION DES CONDITIONS
-- ============================================

-- Abonnement de l'entreprise. Pas d'abonnement Stripe = plan gratuit
-- (plafonné en nombre d'employés actifs). Le plan est mis à jour uniquement
-- par le webhook Stripe, jamais par le frontend.
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS plan                        VARCHAR(20) NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id          VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id      VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS subscription_status         VARCHAR(30),
  ADD COLUMN IF NOT EXISTS current_period_end          TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Preuve d'acceptation des CGV au moment de la souscription
  ADD COLUMN IF NOT EXISTS cgv_accepted_at             TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cgv_version                 VARCHAR(20);

-- Ajouté le 17 nov. 2026 (paiement Stripe, tarifs du 13 nov. : 3 salariés
-- offerts, plafond 79 €, au mois ou à l'année, option IA avancée).
-- L'abonnement Orgaly et l'option IA sont deux abonnements Stripe séparés :
-- l'abonnement peut démarrer pendant l'essai (premier prélèvement à la fin
-- de l'essai) alors que l'IA est payée dès le premier jour.
-- billing_interval = rythme de l'abonnement Orgaly ('month' ou 'year'), pour
-- re-choisir le bon prix quand le nombre de salariés change.
-- stripe_ai_subscription_id n'est rempli que si l'IA est payée via Stripe :
-- les entreprises où Cédric l'active à la main (démo, SAS LLDB) n'y sont pas.
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS billing_interval          VARCHAR(10)
    CHECK (billing_interval IN ('month', 'year')),
  ADD COLUMN IF NOT EXISTS stripe_ai_subscription_id VARCHAR(255) UNIQUE;

-- Preuve d'acceptation des CGU par l'administrateur à l'inscription
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cgu_accepted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cgu_version     VARCHAR(20);
