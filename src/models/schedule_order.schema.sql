-- ============================================
-- ORDRE D'AFFICHAGE DES EMPLOYÉS DANS LE PLANNING
-- ============================================

-- Ordre choisi à la main par le gérant (glisser-déposer) ; NULL = pas encore
-- personnalisé, on garde alors l'ordre par défaut (gérant puis alphabétique).
ALTER TABLE users ADD COLUMN IF NOT EXISTS schedule_order INTEGER;
