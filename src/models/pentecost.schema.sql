-- ============================================
-- LUNDI DE PENTECÔTE : FÉRIÉ OU JOURNÉE DE SOLIDARITÉ
-- ============================================
-- FALSE (par défaut) : le lundi de Pentecôte est férié (un congé posé ce
-- jour-là ne coûte rien, « Férié » dans le planning).
-- TRUE : l'entreprise en fait sa journée de solidarité, c'est un jour
-- travaillé normal (un congé ce jour-là compte).
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS pentecost_monday_worked BOOLEAN NOT NULL DEFAULT FALSE;
