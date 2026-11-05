-- ============================================
-- PROPRIÉTAIRE D'ORGALY (page de pilotage)
-- ============================================
-- Compte à part des comptes clients : il n'appartient à aucune entreprise
-- et ne voit que des chiffres globaux (jamais le contenu des comptes).
-- Mot de passe choisi via un lien envoyé par e-mail
-- (scripts/create-owner.js), jeton stocké sous forme d'empreinte SHA-256.

CREATE TABLE IF NOT EXISTS platform_owners (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) NOT NULL UNIQUE,
  name           VARCHAR(120),
  password_hash  VARCHAR(255),
  setup_token_hash VARCHAR(64),
  setup_expires  TIMESTAMP,
  last_login_at  TIMESTAMP,
  created_at     TIMESTAMP DEFAULT NOW()
);
