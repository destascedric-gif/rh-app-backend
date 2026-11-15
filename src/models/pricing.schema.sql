-- ============================================
-- TARIFS DU 13 NOV. 2026 (appliqués à l'affichage le 15 nov. 2026)
-- ============================================

-- Entreprise gratuite pour toujours, quel que soit son nombre de salariés
-- (SAS LLDB, premier client, décision de Cédric du 13 nov. 2026).
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS free_forever BOOLEAN NOT NULL DEFAULT FALSE;
