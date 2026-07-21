const db = require('../config/db');

// GET /api/settings
const getSettings = async (req, res) => {
  const { companyId } = req.user;

  try {
    const result = await db.query(
      `SELECT name, sector, default_weekly_hours, leave_accrual_per_month,
              overtime_tier1_rate, overtime_tier2_rate, overtime_tier2_threshold_hours,
              primary_color
       FROM company WHERE id = $1`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Entreprise introuvable.' });
    }

    res.json(result.rows[0]);
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
    primaryColor,
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE company SET
         default_weekly_hours           = COALESCE($1, default_weekly_hours),
         leave_accrual_per_month        = COALESCE($2, leave_accrual_per_month),
         overtime_tier1_rate            = COALESCE($3, overtime_tier1_rate),
         overtime_tier2_rate            = COALESCE($4, overtime_tier2_rate),
         overtime_tier2_threshold_hours = COALESCE($5, overtime_tier2_threshold_hours),
         primary_color                  = COALESCE($6, primary_color)
       WHERE id = $7
       RETURNING default_weekly_hours, leave_accrual_per_month,
                 overtime_tier1_rate, overtime_tier2_rate, overtime_tier2_threshold_hours,
                 primary_color`,
      [defaultWeeklyHours, leaveAccrualPerMonth, overtimeTier1Rate, overtimeTier2Rate,
       overtimeTier2ThresholdHours, primaryColor, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Entreprise introuvable.' });
    }

    res.json({ message: 'Paramètres mis à jour.', settings: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = { getSettings, updateSettings };
