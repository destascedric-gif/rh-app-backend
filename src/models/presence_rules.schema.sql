-- ============================================
-- APPLICATION RH - RÈGLES DE PRÉSENCE PAR POSTE (PLANNING)
-- ============================================

-- Règles de présence (11 nov. 2026, demande de Cédric) : fixées par le gérant
-- dans Paramètres → Planning, par exemple « au moins 1 Opticien diplômé ou
-- Opticienne diplômée à chaque heure d'ouverture ». Le planning généré par IA
-- les respecte et Orgaly les vérifie (src/services/aiPlanning/rules.js).
--   job_titles : un ou plusieurs postes, tels qu'ils sont écrits dans les
--                fiches (comparés sans tenir compte des majuscules ni des
--                espaces autour) ; une personne de l'un d'eux suffit
--   min_count  : nombre minimum de personnes parmi ces postes
--   scope      : 'toujours' = à chaque heure d'ouverture (pauses comprises)
--                'jour'     = au moins une fois dans la journée
CREATE TABLE IF NOT EXISTS presence_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  job_titles  TEXT[] NOT NULL DEFAULT '{}',
  min_count   SMALLINT NOT NULL DEFAULT 1 CHECK (min_count BETWEEN 1 AND 9),
  scope       VARCHAR(10) NOT NULL DEFAULT 'toujours' CHECK (scope IN ('toujours', 'jour')),
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presence_rules_company ON presence_rules(company_id);

-- Première version (11 nov. 2026, jamais mise en ligne, table vide) : un seul
-- poste par règle dans job_title. Remplacé le jour même par job_titles.
ALTER TABLE presence_rules ADD COLUMN IF NOT EXISTS job_titles TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE presence_rules DROP COLUMN IF EXISTS job_title;
