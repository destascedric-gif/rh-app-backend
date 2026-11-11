const db = require('../config/db');
const { recomputeAccruedLeave, recomputeCompanyUsedLeave } = require('../services/leaveBalance.service');

// GET /api/settings
const getSettings = async (req, res) => {
  const { companyId } = req.user;

  try {
    const result = await db.query(
      `SELECT name, sector, default_weekly_hours, leave_accrual_per_month,
              overtime_tier1_rate, overtime_tier2_rate, overtime_tier2_threshold_hours,
              primary_color, manager_in_schedule, meetings_count_as_work, team_schedule_visible,
              open_days, pentecost_monday_worked, idcc, collective_agreement,
              ai_planning_enabled
       FROM company WHERE id = $1`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Entreprise introuvable.' });
    }

    // Poste du gérant connecté (12 nov. 2026) : quand il travaille en boutique,
    // il compte pour les règles de présence (ex. « Opticien diplômé »)
    const me = (await db.query(
      "SELECT NULLIF(TRIM(job_title), '') AS job_title FROM users WHERE id = $1 AND company_id = $2",
      [req.user.id, companyId]
    )).rows[0];

    res.json({ ...result.rows[0], manager_job_title: me?.job_title ?? '' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// PUT /api/settings
const updateSettings = async (req, res) => {
  const { companyId } = req.user;
  const {
    defaultWeeklyHours, leaveAccrualPerMonth,
    overtimeTier1Rate, overtimeTier2Rate, overtimeTier2ThresholdHours,
    primaryColor, managerInSchedule, meetingsCountAsWork, teamScheduleVisible, openDays,
    pentecostMondayWorked, idcc, collectiveAgreement, managerJobTitle,
  } = req.body;

  try {
    const before = await db.query(
      'SELECT leave_accrual_per_month, pentecost_monday_worked FROM company WHERE id = $1', [companyId]
    );

    const result = await db.query(
      `UPDATE company SET
         default_weekly_hours           = COALESCE($1, default_weekly_hours),
         leave_accrual_per_month        = COALESCE($2, leave_accrual_per_month),
         overtime_tier1_rate            = COALESCE($3, overtime_tier1_rate),
         overtime_tier2_rate            = COALESCE($4, overtime_tier2_rate),
         overtime_tier2_threshold_hours = COALESCE($5, overtime_tier2_threshold_hours),
         primary_color                  = COALESCE($6, primary_color),
         manager_in_schedule            = COALESCE($8, manager_in_schedule),
         meetings_count_as_work         = COALESCE($9, meetings_count_as_work),
         team_schedule_visible          = COALESCE($10, team_schedule_visible),
         open_days                      = COALESCE($11, open_days),
         pentecost_monday_worked        = COALESCE($12, pentecost_monday_worked),
         -- Convention : absent = inchangé, chaîne vide = effacé
         idcc                 = CASE WHEN $13::text IS NULL THEN idcc ELSE NULLIF($13, '') END,
         collective_agreement = CASE WHEN $14::text IS NULL THEN collective_agreement ELSE NULLIF($14, '') END
       WHERE id = $7
       RETURNING default_weekly_hours, leave_accrual_per_month,
                 overtime_tier1_rate, overtime_tier2_rate, overtime_tier2_threshold_hours,
                 primary_color, manager_in_schedule, meetings_count_as_work, team_schedule_visible,
                 open_days, pentecost_monday_worked, idcc, collective_agreement`,
      [defaultWeeklyHours, leaveAccrualPerMonth, overtimeTier1Rate, overtimeTier2Rate,
       overtimeTier2ThresholdHours, primaryColor, companyId, managerInSchedule, meetingsCountAsWork,
       teamScheduleVisible, openDays, pentecostMondayWorked,
       idcc ?? null, collectiveAgreement ?? null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Entreprise introuvable.' });
    }

    // Poste du gérant connecté ('' = remis à « Gérant »)
    if (managerJobTitle !== undefined) {
      await db.query(
        "UPDATE users SET job_title = NULLIF($1, ''), updated_at = NOW() WHERE id = $2 AND company_id = $3 AND role = 'admin'",
        [managerJobTitle, req.user.id, companyId]
      );
    }

    // Nouveau rythme d'acquisition : les soldes déjà calculés suivent
    const accrual = result.rows[0].leave_accrual_per_month;
    if (Number(accrual) !== Number(before.rows[0]?.leave_accrual_per_month)) {
      await recomputeAccruedLeave(companyId, accrual);
    }

    // Lundi de Pentecôte férié ↔ travaillé : un congé posé ce jour-là
    // coûte un jour ou non, les jours pris sont donc recalculés
    if (result.rows[0].pentecost_monday_worked !== before.rows[0]?.pentecost_monday_worked) {
      await recomputeCompanyUsedLeave(companyId);
    }

    res.json({ message: 'Paramètres mis à jour.', settings: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = { getSettings, updateSettings };
