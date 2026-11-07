-- ============================================
-- JOURS D'OUVERTURE DE LA BOUTIQUE (affichage du planning)
-- ============================================
-- 7 caractères, du lundi au dimanche : '1' = ouvert, '0' = fermé.
-- Sert uniquement à griser les jours fermés ; le décompte des congés suit
-- sa propre règle (jours ouvrés).
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS open_days VARCHAR(7) NOT NULL DEFAULT '1111100';
