const db = require('../config/db');
const { computeLegalBalance, getFrenchHolidays, DEFAULT_LEAVE_ACCRUAL } = require('./leaves.service');
const { toLocalDateString } = require('../utils/date');

// Calcule (et persiste au passage) le solde de Congés payés d'un employé
// pour une année de référence donnée — y compris une année future pas
// encore "vécue", pour ne pas pénaliser une demande anticipée.
const getOrComputeCPBalance = async (userId, companyId, year) => {
  const existing = await db.query(
    `SELECT balance_days, used_days FROM leave_balances
     WHERE user_id = $1 AND company_id = $2 AND leave_type = 'Congés payés' AND year = $3`,
    [userId, companyId, year]
  );
  if (existing.rows[0]) {
    return {
      balance_days: parseFloat(existing.rows[0].balance_days),
      used_days:    parseFloat(existing.rows[0].used_days),
    };
  }

  const userResult = await db.query('SELECT hire_date FROM users WHERE id = $1', [userId]);
  const hireDate = userResult.rows[0]?.hire_date;
  if (!hireDate) return { balance_days: 0, used_days: 0 };

  const companyResult = await db.query('SELECT leave_accrual_per_month FROM company WHERE id = $1', [companyId]);
  const accrualPerMonth = companyResult.rows[0]?.leave_accrual_per_month ?? DEFAULT_LEAVE_ACCRUAL;
  const legalDays = computeLegalBalance(hireDate, year, accrualPerMonth);

  await db.query(
    `INSERT INTO leave_balances (user_id, company_id, leave_type, balance_days, year)
     VALUES ($1, $2, 'Congés payés', $3, $4)
     ON CONFLICT (user_id, leave_type, year)
     DO UPDATE SET balance_days = $3, updated_at = NOW()`,
    [userId, companyId, legalDays, year]
  );

  return { balance_days: legalDays, used_days: 0 };
};

// Recalcule les jours pris de chaque type de congé d'un employé pour une
// année, à partir du planning (source de vérité) plutôt qu'en ajoutant au
// compteur à chaque approbation. Un jour compte s'il porte un créneau de
// congé/absence ET tombe dans une demande approuvée de ce type ; seuls les
// jours ouvrés comptent, comme pour le calcul des demandes.
// Conséquences : un même jour ne peut être compté qu'une fois (deux demandes
// qui se chevauchent ne débitent plus deux fois), et supprimer ou remplacer
// un jour de congé dans le planning le rend automatiquement au solde.
const recomputeUsedLeave = async (userId, companyId, year) => {
  // Garantit la ligne Congés payés (avec le solde acquis) avant de la mettre à jour
  await getOrComputeCPBalance(userId, companyId, year);

  const result = await db.query(
    `SELECT DISTINCT r.leave_type, s.date
     FROM shifts s
     JOIN leave_requests r
       ON r.user_id = s.user_id
      AND r.status = 'approuvé'
      AND s.date BETWEEN r.start_date AND r.end_date
     WHERE s.user_id = $1 AND s.company_id = $2
       AND s.type IN ('conge', 'absence')
       AND s.date BETWEEN $3 AND $4`,
    [userId, companyId, `${year}-01-01`, `${year}-12-31`]
  );

  const holidays = getFrenchHolidays(year);
  const used = {};
  for (const row of result.rows) {
    const dateStr = toLocalDateString(row.date);
    const dow = new Date(`${dateStr}T12:00:00`).getDay();
    if (dow === 0 || dow === 6 || holidays.has(dateStr)) continue;
    used[row.leave_type] = (used[row.leave_type] ?? 0) + 1;
  }

  // Types ayant des jours pris : création ou mise à jour de la ligne
  for (const [leaveType, days] of Object.entries(used)) {
    await db.query(
      `INSERT INTO leave_balances (user_id, company_id, leave_type, used_days, year)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, leave_type, year)
       DO UPDATE SET used_days = $4, updated_at = NOW()`,
      [userId, companyId, leaveType, days, year]
    );
  }

  // Types sans plus aucun jour pris : remise à zéro
  await db.query(
    `UPDATE leave_balances SET used_days = 0, updated_at = NOW()
     WHERE user_id = $1 AND company_id = $2 AND year = $3
       AND used_days <> 0 AND NOT (leave_type::text = ANY($4::text[]))`,
    [userId, companyId, year, Object.keys(used)]
  );
};

// Recalcule les congés payés acquis de tous les employés d'une entreprise
// après un changement du nombre de jours acquis par mois : le solde n'est
// sinon calculé qu'une fois, à la première consultation de l'année.
const recomputeAccruedLeave = async (companyId, accrualPerMonth) => {
  const rows = await db.query(
    `SELECT b.user_id, b.year, u.hire_date
     FROM leave_balances b
     JOIN users u ON u.id = b.user_id
     WHERE b.company_id = $1 AND b.leave_type = 'Congés payés'`,
    [companyId]
  );
  for (const row of rows.rows) {
    const days = row.hire_date ? computeLegalBalance(row.hire_date, row.year, Number(accrualPerMonth)) : 0;
    await db.query(
      `UPDATE leave_balances SET balance_days = $1, updated_at = NOW()
       WHERE user_id = $2 AND company_id = $3 AND leave_type = 'Congés payés' AND year = $4`,
      [days, row.user_id, companyId, row.year]
    );
  }
};

// Années civiles couvertes par une période (une demande de fin décembre à
// début janvier touche deux soldes annuels).
const yearsBetween = (start, end) => {
  const first = new Date(start).getFullYear();
  const last  = new Date(end).getFullYear();
  const years = [];
  for (let y = first; y <= last; y++) years.push(y);
  return years;
};

module.exports = { getOrComputeCPBalance, recomputeUsedLeave, recomputeAccruedLeave, yearsBetween };
