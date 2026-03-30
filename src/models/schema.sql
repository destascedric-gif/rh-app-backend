-- ============================================
-- APPLICATION RH - SCHEMA BASE DE DONNÉES
-- Module : Authentification
-- ============================================

-- Extension pour les UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table : company (informations de l'entreprise)
CREATE TABLE IF NOT EXISTS company (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  siret       VARCHAR(14) UNIQUE,
  address     VARCHAR(500),
  city        VARCHAR(100),
  postal_code VARCHAR(10),
  sector      VARCHAR(100),
  logo_url    VARCHAR(500),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Table : users (admin + employés)
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES company(id) ON DELETE CASCADE,
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,
  email            VARCHAR(255) UNIQUE NOT NULL,
  password_hash    VARCHAR(255),                    -- NULL tant que l'invitation n'est pas acceptée
  role             VARCHAR(20) NOT NULL DEFAULT 'employee'
                   CHECK (role IN ('admin', 'employee')),
  job_title        VARCHAR(100),
  hire_date        DATE,
  gross_salary     NUMERIC(10, 2),
  phone            VARCHAR(20),
  is_active        BOOLEAN DEFAULT TRUE,
  invite_token     VARCHAR(255),                    -- token du lien d'invitation
  invite_expires   TIMESTAMP,                       -- expiration du lien (48h)
  invite_accepted  BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

-- Table : app_config (état du setup initial)
CREATE TABLE IF NOT EXISTS app_config (
  id             SERIAL PRIMARY KEY,
  setup_complete BOOLEAN DEFAULT FALSE,             -- false = premier lancement
  created_at     TIMESTAMP DEFAULT NOW()
);

-- Insertion de la config initiale
INSERT INTO app_config (setup_complete) VALUES (FALSE)
  ON CONFLICT DO NOTHING;

-- Index pour les recherches fréquentes
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_invite_token ON users(invite_token);
CREATE INDEX IF NOT EXISTS idx_users_company      ON users(company_id);
