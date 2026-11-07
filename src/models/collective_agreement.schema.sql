-- ============================================
-- CONVENTION COLLECTIVE (mention obligatoire du bulletin de paie)
-- ============================================
-- idcc : identifiant à 4 chiffres de la convention collective de branche
-- (9999 = aucune convention, le Code du travail s'applique seul).
-- collective_agreement : son intitulé, imprimé sur le bulletin.
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS idcc VARCHAR(4),
  ADD COLUMN IF NOT EXISTS collective_agreement VARCHAR(150);

-- Convention en vigueur au moment de la génération du bulletin : un bulletin
-- est un document historique, il ne doit pas changer si le réglage change.
ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS idcc VARCHAR(4),
  ADD COLUMN IF NOT EXISTS collective_agreement VARCHAR(150);
