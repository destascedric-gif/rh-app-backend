-- ============================================
-- APPLICATION RH - RÈGLES DE PRÉSENCE PAR POSTE (PLANNING)
-- ============================================

-- Règles de présence (11 nov. 2026, demande de Cédric) : fixées par le gérant
-- dans Paramètres, par exemple « au moins 1 Opticien à chaque heure
-- d'ouverture ». Le planning généré par IA les respecte et Orgaly les vérifie
-- (src/services/aiPlanning/rules.js).
--   job_title : poste tel qu'il est écrit dans les fiches (comparé sans tenir
--               compte des majuscules ni des espaces autour)
--   min_count : nombre minimum de personnes de ce poste
--   scope     : 'toujours' = à chaque heure d'ouverture (pauses comprises)
--               'jour'     = au moins une fois dans la journée
CREATE TABLE IF NOT EXISTS presence_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  job_title   VARCHAR(100) NOT NULL,
  min_count   SMALLINT NOT NULL DEFAULT 1 CHECK (min_count BETWEEN 1 AND 9),
  scope       VARCHAR(10) NOT NULL DEFAULT 'toujours' CHECK (scope IN ('toujours', 'jour')),
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presence_rules_company ON presence_rules(company_id);
