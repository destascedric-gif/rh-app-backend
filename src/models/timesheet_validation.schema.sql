-- ============================================
-- APPLICATION RH - VALIDATION DU POINTAGE
-- ============================================

-- Une saisie de pointage faite par l'employé lui-même doit être validée
-- par l'admin avant de compter dans les totaux ; une saisie faite par
-- l'admin est considérée validée d'emblée.
ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'validé'
    CHECK (status IN ('en_attente', 'validé', 'refusé'));

CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);
