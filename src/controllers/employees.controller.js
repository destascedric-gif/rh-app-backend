const db = require('../config/db');
const { toLocalDateString } = require('../utils/date');

// GET /api/employees/timesheets/pending — tous les pointages en attente de
// validation de l'entreprise (pour le tableau de bord admin)
const getPendingTimesheets = async (req, res) => {
  const { companyId } = req.user;

  try {
    const result = await db.query(
      `SELECT t.id, t.date, t.clock_in, t.clock_out, t.break_minutes, t.total_hours, t.note,
              u.id AS employee_id, u.first_name || ' ' || u.last_name AS employee_name,
              u.job_title, u.photo_url
       FROM timesheets t
       JOIN users u ON u.id = t.user_id
       WHERE t.company_id = $1 AND t.status = 'en_attente'
       ORDER BY t.date DESC`,
      [companyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// LISTE DES EMPLOYÉS
// ─────────────────────────────────────────────

// GET /api/employees
// Retourne tous les employés actifs de l'entreprise
const getEmployees = async (req, res) => {
  const { companyId } = req.user;

  try {
    const result = await db.query(
      `SELECT
         id, first_name, last_name, email, phone,
         job_title, department, contract_type, work_time, weekly_hours,
         hire_date, gross_salary, photo_url, is_active, invite_accepted
       FROM users
       WHERE company_id = $1 AND role = 'employee'
       ORDER BY last_name, first_name`,
      [companyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// FICHE DÉTAILLÉE D'UN EMPLOYÉ
// ─────────────────────────────────────────────

// GET /api/employees/:id
const getEmployee = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT
         id, first_name, last_name, email, phone,
         job_title, department, contract_type, work_time, weekly_hours,
         hire_date, gross_salary, birth_date,
         photo_url, is_active, invite_accepted, created_at
       FROM users
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Employé introuvable.' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// MISE À JOUR DE LA FICHE
// ─────────────────────────────────────────────

// PUT /api/employees/:id
const updateEmployee = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;
  const {
    firstName, lastName, email, phone,
    jobTitle, department, contractType, workTime, weeklyHours,
    hireDate, grossSalary, birthDate,
  } = req.body;

  try {
    // Vérifie que l'employé appartient bien à cette entreprise
    const check = await db.query(
      'SELECT id FROM users WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Employé introuvable.' });
    }

    const result = await db.query(
      `UPDATE users SET
         first_name      = COALESCE($1,  first_name),
         last_name       = COALESCE($2,  last_name),
         email           = COALESCE($3,  email),
         phone           = COALESCE($4,  phone),
         job_title       = COALESCE($5,  job_title),
         department      = COALESCE($6,  department),
         contract_type   = COALESCE($7,  contract_type),
         work_time       = COALESCE($8,  work_time),
         weekly_hours    = COALESCE($9,  weekly_hours),
         hire_date       = COALESCE($10, hire_date),
         gross_salary    = COALESCE($11, gross_salary),
         birth_date      = COALESCE($12, birth_date),
         updated_at      = NOW()
       WHERE id = $13
       RETURNING id, first_name, last_name, email, job_title`,
      [firstName, lastName, email, phone, jobTitle, department,
       contractType, workTime, weeklyHours || null, hireDate, grossSalary, birthDate,
       id]
    );

    res.json({ message: 'Fiche mise à jour.', employee: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// DÉSACTIVATION D'UN EMPLOYÉ (soft delete)
// ─────────────────────────────────────────────

// DELETE /api/employees/:id
const deactivateEmployee = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;

  try {
    await db.query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    res.json({ message: 'Employé désactivé.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// RÉACTIVATION D'UN EMPLOYÉ
// ─────────────────────────────────────────────

// PUT /api/employees/:id/reactivate
const reactivateEmployee = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;

  try {
    const result = await db.query(
      `UPDATE users SET is_active = TRUE, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING id`,
      [id, companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Employé introuvable.' });
    }
    res.json({ message: 'Employé réactivé.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// ONGLET BULLETINS DE PAIE
// ─────────────────────────────────────────────

// GET /api/employees/:id/payslips
const getPayslips = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT id, period_month, period_year, gross_amount, net_amount, file_url, created_at
       FROM payslips
       WHERE user_id = $1 AND company_id = $2
       ORDER BY period_year DESC, period_month DESC`,
      [id, companyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// ONGLET DOCUMENTS
// ─────────────────────────────────────────────

// GET /api/employees/:id/documents
const getDocuments = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT d.id, d.name, d.type, d.file_url, d.file_size, d.created_at,
              u.first_name || ' ' || u.last_name AS uploaded_by_name
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.user_id = $1 AND d.company_id = $2
       ORDER BY d.created_at DESC`,
      [id, companyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/employees/:id/documents
const addDocument = async (req, res) => {
  const { companyId, id: adminId } = req.user;
  const { id } = req.params;
  const { name, type, fileUrl, fileSize } = req.body;

  if (!name || !type || !fileUrl) {
    return res.status(400).json({ message: 'Nom, type et fichier requis.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO documents (user_id, company_id, name, type, file_url, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, type, created_at`,
      [id, companyId, name, type, fileUrl, fileSize, adminId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// ONGLET POINTAGE
// ─────────────────────────────────────────────

// GET /api/employees/:id/timesheets?month=6&year=2025
const getTimesheets = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;
  const { month, year } = req.query;

  try {
    const rows = await fetchTimesheets({ userId: id, companyId, month, year });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Calcule le nombre d'heures nettes à partir d'une arrivée/départ/pause
const computeTotalHours = (clockIn, clockOut, breakMinutes) => {
  if (!clockIn || !clockOut) return null;
  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const minutes = toMin(clockOut) - toMin(clockIn) - (parseInt(breakMinutes, 10) || 0);
  return minutes > 0 ? parseFloat((minutes / 60).toFixed(2)) : 0;
};

const fetchTimesheets = async ({ userId, companyId, month, year }) => {
  let query = `
    SELECT id, date, clock_in, clock_out, break_minutes, total_hours, note, status
    FROM timesheets
    WHERE user_id = $1 AND company_id = $2`;
  const params = [userId, companyId];

  if (month && year) {
    query += ` AND EXTRACT(MONTH FROM date) = $3 AND EXTRACT(YEAR FROM date) = $4`;
    params.push(month, year);
  }
  query += ' ORDER BY date DESC';

  const result = await db.query(query, params);
  return result.rows;
};

// Crée ou met à jour (upsert) l'entrée de pointage d'un jour donné.
// status = 'validé' quand c'est l'admin qui saisit/corrige, 'en_attente'
// quand c'est l'employé lui-même (doit être validé avant de compter).
const upsertTimesheet = async ({ userId, companyId, date, clockIn, clockOut, breakMinutes, note, status }) => {
  const totalHours = computeTotalHours(clockIn, clockOut, breakMinutes);
  const result = await db.query(
    `INSERT INTO timesheets (user_id, company_id, date, clock_in, clock_out, break_minutes, total_hours, note, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, date) DO UPDATE SET
       clock_in = EXCLUDED.clock_in, clock_out = EXCLUDED.clock_out,
       break_minutes = EXCLUDED.break_minutes, total_hours = EXCLUDED.total_hours,
       note = EXCLUDED.note, status = EXCLUDED.status
     RETURNING id, date, clock_in, clock_out, break_minutes, total_hours, note, status`,
    [userId, companyId, date, clockIn || null, clockOut || null, breakMinutes || 0, totalHours, note || null, status]
  );
  return result.rows[0];
};

// POST /api/employees/:id/timesheets (admin) — toujours validé d'emblée
const addTimesheet = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;
  const { date, clockIn, clockOut, breakMinutes, note } = req.body;

  if (!date) return res.status(400).json({ message: 'La date est requise.' });

  try {
    const row = await upsertTimesheet({ userId: id, companyId, date, clockIn, clockOut, breakMinutes, note, status: 'validé' });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// PUT /api/employees/:id/timesheets/:timesheetId (admin) — valide au passage
const updateTimesheet = async (req, res) => {
  const { companyId } = req.user;
  const { id, timesheetId } = req.params;
  const { clockIn, clockOut, breakMinutes, note } = req.body;
  const totalHours = computeTotalHours(clockIn, clockOut, breakMinutes);

  try {
    const result = await db.query(
      `UPDATE timesheets SET clock_in = $1, clock_out = $2, break_minutes = $3, total_hours = $4, note = $5, status = 'validé'
       WHERE id = $6 AND user_id = $7 AND company_id = $8
       RETURNING id, date, clock_in, clock_out, break_minutes, total_hours, note, status`,
      [clockIn || null, clockOut || null, breakMinutes || 0, totalHours, note || null, timesheetId, id, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Pointage introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// PATCH /api/employees/:id/timesheets/:timesheetId/status (admin) — valider/refuser une saisie employé
const reviewTimesheet = async (req, res) => {
  const { companyId } = req.user;
  const { id, timesheetId } = req.params;
  const { status } = req.body;

  if (!['validé', 'refusé'].includes(status)) {
    return res.status(400).json({ message: "Statut invalide. Valeurs : validé, refusé." });
  }

  try {
    const result = await db.query(
      `UPDATE timesheets SET status = $1
       WHERE id = $2 AND user_id = $3 AND company_id = $4
       RETURNING id, date, clock_in, clock_out, break_minutes, total_hours, note, status`,
      [status, timesheetId, id, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Pointage introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// DELETE /api/employees/:id/timesheets/:timesheetId (admin)
const deleteTimesheet = async (req, res) => {
  const { companyId } = req.user;
  const { id, timesheetId } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM timesheets WHERE id = $1 AND user_id = $2 AND company_id = $3 RETURNING id',
      [timesheetId, id, companyId]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Pointage introuvable.' });
    res.json({ message: 'Pointage supprimé.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ── Auto-service (l'employé gère son propre pointage) ──

// GET /api/employees/me/timesheets?month=6&year=2025
const getMyTimesheets = async (req, res) => {
  const { id: userId, companyId } = req.user;
  const { month, year } = req.query;

  try {
    const rows = await fetchTimesheets({ userId, companyId, month, year });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/employees/me/timesheets — saisie employé : toujours en attente de validation
const addMyTimesheet = async (req, res) => {
  const { id: userId, companyId } = req.user;
  const { date, clockIn, clockOut, breakMinutes, note } = req.body;

  if (!date) return res.status(400).json({ message: 'La date est requise.' });

  try {
    const row = await upsertTimesheet({ userId, companyId, date, clockIn, clockOut, breakMinutes, note, status: 'en_attente' });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// PUT /api/employees/me/timesheets/:timesheetId — toute modification employé repasse en attente
const updateMyTimesheet = async (req, res) => {
  const { id: userId, companyId } = req.user;
  const { timesheetId } = req.params;
  const { clockIn, clockOut, breakMinutes, note } = req.body;
  const totalHours = computeTotalHours(clockIn, clockOut, breakMinutes);

  try {
    const result = await db.query(
      `UPDATE timesheets SET clock_in = $1, clock_out = $2, break_minutes = $3, total_hours = $4, note = $5, status = 'en_attente'
       WHERE id = $6 AND user_id = $7 AND company_id = $8
       RETURNING id, date, clock_in, clock_out, break_minutes, total_hours, note, status`,
      [clockIn || null, clockOut || null, breakMinutes || 0, totalHours, note || null, timesheetId, userId, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Pointage introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// DELETE /api/employees/me/timesheets/:timesheetId
const deleteMyTimesheet = async (req, res) => {
  const { id: userId, companyId } = req.user;
  const { timesheetId } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM timesheets WHERE id = $1 AND user_id = $2 AND company_id = $3 RETURNING id',
      [timesheetId, userId, companyId]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Pointage introuvable.' });
    res.json({ message: 'Pointage supprimé.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// RÉCAP MENSUEL (heures, congés, paie)
// ─────────────────────────────────────────────

// GET /api/employees/:id/monthly-summary?month=6&year=2025
const getMonthlySummary = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;
  const { month, year } = req.query;

  if (!month || !year) {
    return res.status(400).json({ message: 'month et year sont requis.' });
  }

  try {
    // Seules les heures validées comptent dans le récap (une saisie employé
    // en attente ne doit pas gonfler le total tant que l'admin ne l'a pas confirmée).
    const hoursResult = await db.query(
      `SELECT COALESCE(SUM(total_hours), 0) AS total_hours, COUNT(*) FILTER (WHERE clock_in IS NOT NULL) AS days_worked
       FROM timesheets
       WHERE user_id = $1 AND company_id = $2 AND status = 'validé'
         AND EXTRACT(MONTH FROM date) = $3 AND EXTRACT(YEAR FROM date) = $4`,
      [id, companyId, month, year]
    );

    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd = toLocalDateString(new Date(year, month, 0));

    const leavesResult = await db.query(
      `SELECT leave_type, SUM(working_days) AS days
       FROM leave_requests
       WHERE user_id = $1 AND company_id = $2 AND status = 'approuvé'
         AND start_date <= $4 AND end_date >= $3
       GROUP BY leave_type`,
      [id, companyId, periodStart, periodEnd]
    );

    const payslipResult = await db.query(
      `SELECT gross_amount, net_amount, file_url
       FROM payslips
       WHERE user_id = $1 AND company_id = $2 AND period_month = $3 AND period_year = $4`,
      [id, companyId, month, year]
    );

    res.json({
      totalHours: parseFloat(hoursResult.rows[0].total_hours) || 0,
      daysWorked: parseInt(hoursResult.rows[0].days_worked, 10) || 0,
      leaveDays: leavesResult.rows.map((r) => ({ leaveType: r.leave_type, days: parseFloat(r.days) })),
      payslip: payslipResult.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = {
  getEmployees,
  getEmployee,
  updateEmployee,
  deactivateEmployee,
  reactivateEmployee,
  getPayslips,
  getDocuments,
  addDocument,
  getTimesheets,
  addTimesheet,
  updateTimesheet,
  deleteTimesheet,
  reviewTimesheet,
  getMyTimesheets,
  addMyTimesheet,
  updateMyTimesheet,
  deleteMyTimesheet,
  getMonthlySummary,
  getPendingTimesheets,
};
