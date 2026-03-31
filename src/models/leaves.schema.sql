-- ============================================
-- APPLICATION RH - SCHEMA CONGÉS / ABSENCES
-- ============================================

-- Types de congés gérés
CREATE TYPE leave_type AS ENUM (
  'Congés payés',
  'RTT',
  'Congé maladie',
  'Congé sans solde',
  'Congé maternité / paternité'
);

-- Statut d'une demande
CREATE TYPE leave_status AS ENUM (
  'en_attente',
  'approuvé',
  'refusé'
);

-- Table : leave_balances (soldes par employé et par type)
-- Mis à jour automatiquement chaque mois (cron) ou manuellement
CREATE TABLE IF NOT EXISTS leave_balances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  leave_type   leave_type NOT NULL,
  balance_days NUMERIC(5,1) DEFAULT 0,   -- jours disponibles
  used_days    NUMERIC(5,1) DEFAULT 0,   -- jours posés
  year         INTEGER NOT NULL,          -- année de référence
  updated_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, leave_type, year)
);

-- Table : leave_requests (demandes de congés)
CREATE TABLE IF NOT EXISTS leave_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  leave_type   leave_type NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  working_days NUMERIC(4,1) NOT NULL,    -- nb jours ouvrés calculés
  reason       VARCHAR(500),             -- motif (optionnel)
  status       leave_status DEFAULT 'en_attente',
  reviewed_by  UUID REFERENCES users(id), -- admin qui a traité
  reviewed_at  TIMESTAMP,
  admin_note   VARCHAR(500),             -- commentaire de l'admin
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

-- Table : leave_notifications (suivi des notifications in-app)
CREATE TABLE IF NOT EXISTS leave_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id  UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  message     VARCHAR(500) NOT NULL,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_leave_requests_user    ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company ON leave_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status  ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_balances_user    ON leave_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user     ON leave_notifications(user_id, is_read);
