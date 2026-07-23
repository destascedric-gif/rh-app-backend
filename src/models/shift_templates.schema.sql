-- ============================================
-- APPLICATION RH - SCHEMA HORAIRES TYPES (PLANNING)
-- ============================================

-- Modèles d'horaires réutilisables, définis par l'admin (ex: "Matin 9h-17h"),
-- glissés sur le planning pour créer un créneau sans ressaisir les heures.
CREATE TABLE IF NOT EXISTS shift_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  break_start  TIME,             -- pause optionnelle, une seule par modèle
  break_end    TIME,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_company ON shift_templates(company_id);
