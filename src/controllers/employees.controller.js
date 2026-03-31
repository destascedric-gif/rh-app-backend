const db = require('../config/db');

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
         job_title, department, contract_type, work_time,
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
         job_title, department, contract_type, work_time,
         hire_date, gross_salary, birth_date, social_security,
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
    jobTitle, department, contractType, workTime,
    hireDate, grossSalary, birthDate, socialSecurity,
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
         hire_date       = COALESCE($9,  hire_date),
         gross_salary    = COALESCE($10, gross_salary),
         birth_date      = COALESCE($11, birth_date),
         social_security = COALESCE($12, social_security),
         updated_at      = NOW()
       WHERE id = $13
       RETURNING id, first_name, last_name, email, job_title`,
      [firstName, lastName, email, phone, jobTitle, department,
       contractType, workTime, hireDate, grossSalary, birthDate,
       socialSecurity, id]
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
    let query = `
      SELECT id, date, clock_in, clock_out, break_minutes, total_hours, note
      FROM timesheets
      WHERE user_id = $1 AND company_id = $2`;
    const params = [id, companyId];

    if (month && year) {
      query += ` AND EXTRACT(MONTH FROM date) = $3 AND EXTRACT(YEAR FROM date) = $4`;
      params.push(month, year);
    }

    query += ' ORDER BY date DESC';

    const result = await db.query(query, params);
    res.json(result.rows);
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
  getPayslips,
  getDocuments,
  addDocument,
  getTimesheets,
};
