-- ============================================
-- JOURNAL DES ACTIONS (page de pilotage)
-- ============================================
-- Qui (rôle, entreprise), quoi (code de l'action), quand et avec quel
-- résultat — jamais le contenu (ni motif, ni horaires, ni destinataire).
-- Purgé automatiquement au-delà de 90 jours (services/activityLog.service.js).

CREATE TABLE IF NOT EXISTS activity_log (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id   UUID REFERENCES company(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role   VARCHAR(20),
  action       VARCHAR(120) NOT NULL,
  status       VARCHAR(10) NOT NULL CHECK (status IN ('ok', 'refused', 'error')),
  http_status  SMALLINT,
  duration_ms  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_company ON activity_log(company_id, created_at);
