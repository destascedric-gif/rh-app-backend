-- ============================================
-- APPLICATION RH - PLANNING GÉNÉRÉ PAR IA
-- ============================================

-- Fiche confirmée (11 nov. 2026) : quand les heures du contrat diffèrent
-- beaucoup de ce que montre le planning (ex. 35 h au contrat, 8 h en moyenne),
-- Orgaly demande au gérant si la fiche est juste. S'il répond oui, on garde
-- ici la durée du contrat qu'il a confirmée : la question n'est plus posée
-- et l'IA suit l'habitude. Si le contrat change ensuite, la valeur ne
-- correspond plus et la question revient.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS planning_hours_confirmed NUMERIC(4,2);
