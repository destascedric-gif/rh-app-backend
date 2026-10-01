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

-- Preuve d'acceptation des CGU par l'administrateur à l'inscription
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cgu_accepted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cgu_version     VARCHAR(20);
