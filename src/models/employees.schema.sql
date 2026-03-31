-- ============================================
-- APPLICATION RH - SCHEMA FICHES EMPLOYÉS
-- ============================================

-- Ajout des colonnes manquantes sur la table users existante
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_date        DATE,
  ADD COLUMN IF NOT EXISTS social_security   VARCHAR(15),  -- stocké chiffré en prod
  ADD COLUMN IF NOT EXISTS photo_url         VARCHAR(500),
  ADD COLUMN IF NOT EXISTS contract_type     VARCHAR(20)
    CHECK (contract_type IN ('CDI', 'CDD', 'Alternance', 'Stage', 'Freelance')),
  ADD COLUMN IF NOT EXISTS work_time         VARCHAR(20)
    CHECK (work_time IN ('Temps plein', 'Temps partiel')),
  ADD COLUMN IF NOT EXISTS department        VARCHAR(100);

-- Table : documents (contrats, avenants, autres fichiers RH)
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,       -- ex: "Contrat CDI - Jan 2024"
  type          VARCHAR(50) NOT NULL         -- 'contrat', 'avenant', 'autre'
    CHECK (type IN ('contrat', 'avenant', 'autre')),
  file_url      VARCHAR(500) NOT NULL,       -- chemin vers le fichier stocké
  file_size     INTEGER,                     -- en octets
  uploaded_by   UUID REFERENCES users(id),  -- admin qui a uploadé
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Table : payslips (bulletins de paie)
CREATE TABLE IF NOT EXISTS payslips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  period_month  INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year   INTEGER NOT NULL,
  gross_amount  NUMERIC(10,2) NOT NULL,
  net_amount    NUMERIC(10,2) NOT NULL,
  file_url      VARCHAR(500),               -- PDF du bulletin
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, period_month, period_year)
);

-- Table : timesheets (pointage)
CREATE TABLE IF NOT EXISTS timesheets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  clock_in      TIME,
  clock_out     TIME,
  break_minutes INTEGER DEFAULT 0,
  total_hours   NUMERIC(4,2),               -- calculé automatiquement
  note          VARCHAR(255),
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, date)
);

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_documents_user    ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_payslips_user     ON payslips(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_user   ON timesheets(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_date   ON timesheets(date);
