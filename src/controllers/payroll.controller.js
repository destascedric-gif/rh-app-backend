const db                  = require('../config/db');
const { computePayroll }  = require('../services/payroll.service');
const { generatePayslipPDF } = require('../services/pdf.service');

const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin',
                 'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ─────────────────────────────────────────────
// Heures planifiées + absences non rémunérées sur une période,
// pour faire entrer le planning et les congés dans le calcul de paie.
// ─────────────────────────────────────────────
const getScheduledHours = async (userId, companyId, periodStart, periodEnd) => {
  const grossResult = await db.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600), 0) AS hours
     FROM shifts s
     WHERE s.user_id = $1 AND s.company_id = $2 AND s.type = 'travail'
       AND s.date BETWEEN $3 AND $4`,
    [userId, companyId, periodStart, periodEnd]
  );
  const breakResult = await db.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (sb.end_time - sb.start_time)) / 3600), 0) AS hours
     FROM shift_breaks sb
     JOIN shifts s ON s.id = sb.shift_id
     WHERE s.user_id = $1 AND s.company_id = $2 AND s.type = 'travail'
       AND s.date BETWEEN $3 AND $4`,
    [userId, companyId, periodStart, periodEnd]
  );
  const grossHours = parseFloat(grossResult.rows[0].hours);
  const breakHours = parseFloat(breakResult.rows[0].hours);
  return Math.max(0, grossHours - breakHours);
};

const getUnpaidLeaveDays = async (userId, companyId, periodStart, periodEnd) => {
  const result = await db.query(
    `SELECT COALESCE(SUM(working_days), 0) AS days
     FROM leave_requests
     WHERE user_id = $1 AND company_id = $2 AND status = 'approuvé'
       AND leave_type = 'Congé sans solde'
       AND start_date <= $4 AND end_date >= $3`,
    [userId, companyId, periodStart, periodEnd]
  );
  return parseFloat(result.rows[0].days);
};

const getCompanyPolicy = async (companyId) => {
  const result = await db.query(
    `SELECT overtime_tier1_rate, overtime_tier2_rate, overtime_tier2_threshold_hours
     FROM company WHERE id = $1`,
    [companyId]
  );
  const row = result.rows[0] ?? {};
  return {
    overtimeTier1Rate:            row.overtime_tier1_rate ?? 1.25,
    overtimeTier2Rate:            row.overtime_tier2_rate ?? 1.50,
    overtimeTier2ThresholdHours:  row.overtime_tier2_threshold_hours ?? 43,
  };
};

// Construit les paramètres de calcul de paie pour un employé sur un mois donné
const buildPayrollInputs = async (employee, companyId, month, year) => {
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const periodEnd    = new Date(year, month, 0).toISOString().slice(0, 10);

  const [scheduledHours, unpaidLeaveDays, policy] = await Promise.all([
    getScheduledHours(employee.id, companyId, periodStart, periodEnd),
    getUnpaidLeaveDays(employee.id, companyId, periodStart, periodEnd),
    getCompanyPolicy(companyId),
  ]);

  return {
    grossSalary:     employee.gross_salary,
    weeklyHours:     employee.weekly_hours ?? 35,
    scheduledHours:  scheduledHours > 0 ? scheduledHours : null,
    unpaidLeaveDays,
    ...policy,
  };
};

// ─────────────────────────────────────────────
// LISTE DES BULLETINS — tous les employés
// ─────────────────────────────────────────────

// GET /api/payroll?year=2025&month=6
const getAllPayslips = async (req, res) => {
  const { companyId } = req.user;
  const { year, month } = req.query;

  try {
    let query = `
      SELECT p.*,
             u.first_name, u.last_name, u.job_title, u.photo_url
      FROM payslips p
      JOIN users u ON u.id = p.user_id
      WHERE p.company_id = $1`;

    const params = [companyId];

    if (year)  { query += ` AND p.period_year  = $${params.length + 1}`; params.push(year);  }
    if (month) { query += ` AND p.period_month = $${params.length + 1}`; params.push(month); }

    query += ' ORDER BY p.period_year DESC, p.period_month DESC, u.last_name';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// GÉNÉRATION AUTOMATIQUE D'UN BULLETIN
// ─────────────────────────────────────────────

// POST /api/payroll/generate
// Body: { userId, month, year }
const generatePayslip = async (req, res) => {
  const { companyId } = req.user;
  const { userId, month, year } = req.body;

  if (!userId || !month || !year) {
    return res.status(400).json({ message: 'userId, month et year sont requis.' });
  }

  try {
    // Récupère l'employé avec son salaire
    const empResult = await db.query(
      `SELECT u.*, c.name AS company_name, c.siret, c.address, c.city, c.postal_code
       FROM users u
       JOIN company c ON c.id = u.company_id
       WHERE u.id = $1 AND u.company_id = $2`,
      [userId, companyId]
    );

    const employee = empResult.rows[0];
    if (!employee) {
      return res.status(404).json({ message: 'Employé introuvable.' });
    }

    if (!employee.gross_salary) {
      return res.status(400).json({ message: 'Aucun salaire brut renseigné pour cet employé.' });
    }

    // Vérifie si un bulletin existe déjà pour ce mois
    const existing = await db.query(
      `SELECT id FROM payslips
       WHERE user_id = $1 AND period_month = $2 AND period_year = $3`,
      [userId, month, year]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        message: `Un bulletin existe déjà pour ${MONTHS[month - 1]} ${year}. Supprimez-le avant de regénérer.`,
      });
    }

    // Calcul des cotisations, en tenant compte du planning et des congés sans solde
    const payrollInputs = await buildPayrollInputs(employee, companyId, month, year);
    const cotisations = computePayroll(payrollInputs);

    // Récupère les soldes de congés
    const balanceResult = await db.query(
      `SELECT leave_type, balance_days, used_days
       FROM leave_balances
       WHERE user_id = $1 AND year = $2`,
      [userId, year]
    );

    const leaveBalance = {};
    balanceResult.rows.forEach(r => {
      leaveBalance[r.leave_type] = {
        balance_days: parseFloat(r.balance_days),
        used_days:    parseFloat(r.used_days),
      };
    });

    // Cumul brut annuel (mois précédents de l'année)
    const cumulResult = await db.query(
      `SELECT COALESCE(SUM(gross_amount), 0) AS cumul
       FROM payslips
       WHERE user_id = $1 AND period_year = $2 AND period_month < $3`,
      [userId, year, month]
    );
    const cumulBrut = parseFloat(cumulResult.rows[0].cumul) + cotisations.adjustedGross;

    // Sauvegarde en base — le brut stocké est celui réellement dû ce mois-ci
    // (salaire contractuel + heures sup planifiées - absence non rémunérée)
    const payslip = {
      period_month: parseInt(month),
      period_year:  parseInt(year),
      gross_amount: cotisations.adjustedGross,
      net_amount:   cotisations.netSalary,
    };

    const insertResult = await db.query(
      `INSERT INTO payslips (user_id, company_id, period_month, period_year, gross_amount, net_amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [userId, companyId, payslip.period_month, payslip.period_year,
       payslip.gross_amount, payslip.net_amount]
    );

    payslip.id = insertResult.rows[0].id;

    // Génère le PDF
    const company = {
      name:        employee.company_name,
      siret:       employee.siret,
      address:     employee.address,
      city:        employee.city,
      postal_code: employee.postal_code,
    };

    const pdfBuffer = await generatePayslipPDF({
      company,
      employee,
      payslip: { ...payslip, cumul_brut: cumulBrut },
      cotisations,
      leaveBalance,
    });

    // Retourne le PDF directement
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="bulletin_${employee.last_name}_${MONTHS[month-1]}_${year}.pdf"`,
      'Content-Length':       pdfBuffer.length,
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la génération du bulletin.' });
  }
};

// ─────────────────────────────────────────────
// REGÉNÉRER LE PDF D'UN BULLETIN EXISTANT
// ─────────────────────────────────────────────

// GET /api/payroll/:id/pdf
const downloadPayslip = async (req, res) => {
  const { companyId } = req.user;
  const { id }        = req.params;

  try {
    const result = await db.query(
      `SELECT p.*,
              u.first_name, u.last_name, u.job_title, u.contract_type,
              u.work_time, u.hire_date, u.social_security, u.gross_salary,
              c.name AS company_name, c.siret, c.address, c.city, c.postal_code
       FROM payslips p
       JOIN users u   ON u.id = p.user_id
       JOIN company c ON c.id = p.company_id
       WHERE p.id = $1 AND p.company_id = $2`,
      [id, companyId]
    );

    const row = result.rows[0];
    if (!row) return res.status(404).json({ message: 'Bulletin introuvable.' });

    // On recalcule les cotisations à partir du brut réellement stocké sur ce
    // bulletin (déjà ajusté heures sup / absence à la génération), pas du
    // salaire contractuel actuel de l'employé qui a pu changer depuis.
    const cotisations = computePayroll({ grossSalary: row.gross_amount });

    const balanceResult = await db.query(
      `SELECT leave_type, balance_days, used_days
       FROM leave_balances
       WHERE user_id = $1 AND year = $2`,
      [row.user_id, row.period_year]
    );
    const leaveBalance = {};
    balanceResult.rows.forEach(r => {
      leaveBalance[r.leave_type] = {
        balance_days: parseFloat(r.balance_days),
        used_days:    parseFloat(r.used_days),
      };
    });

    const pdfBuffer = await generatePayslipPDF({
      company:  { name: row.company_name, siret: row.siret, address: row.address, city: row.city, postal_code: row.postal_code },
      employee: row,
      payslip:  { period_month: row.period_month, period_year: row.period_year, gross_amount: row.gross_amount, net_amount: row.net_amount },
      cotisations,
      leaveBalance,
    });

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="bulletin_${row.last_name}_${MONTHS[row.period_month-1]}_${row.period_year}.pdf"`,
      'Content-Length':       pdfBuffer.length,
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du téléchargement.' });
  }
};

// ─────────────────────────────────────────────
// SUPPRESSION D'UN BULLETIN
// ─────────────────────────────────────────────

// DELETE /api/payroll/:id
const deletePayslip = async (req, res) => {
  const { companyId } = req.user;
  const { id }        = req.params;

  try {
    const result = await db.query(
      'DELETE FROM payslips WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Bulletin introuvable.' });
    }
    res.json({ message: 'Bulletin supprimé.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// GÉNÉRATION GROUPÉE — tous les employés d'un mois
// ─────────────────────────────────────────────

// POST /api/payroll/generate-all
// Body: { month, year }
const generateAllPayslips = async (req, res) => {
  const { companyId } = req.user;
  const { month, year } = req.body;

  if (!month || !year) {
    return res.status(400).json({ message: 'month et year sont requis.' });
  }

  try {
    const employees = await db.query(
      `SELECT id FROM users
       WHERE company_id = $1 AND role = 'employee'
         AND is_active = TRUE AND gross_salary IS NOT NULL`,
      [companyId]
    );

    const results = { success: [], skipped: [], errors: [] };

    for (const emp of employees.rows) {
      const existing = await db.query(
        `SELECT id FROM payslips WHERE user_id=$1 AND period_month=$2 AND period_year=$3`,
        [emp.id, month, year]
      );
      if (existing.rows.length > 0) {
        results.skipped.push(emp.id);
        continue;
      }

      try {
        const empData       = await db.query('SELECT * FROM users WHERE id = $1', [emp.id]);
        const employee       = empData.rows[0];
        const payrollInputs  = await buildPayrollInputs(employee, companyId, month, year);
        const cotisations    = computePayroll(payrollInputs);

        await db.query(
          `INSERT INTO payslips (user_id, company_id, period_month, period_year, gross_amount, net_amount)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [emp.id, companyId, month, year,
           cotisations.adjustedGross, cotisations.netSalary]
        );
        results.success.push(emp.id);
      } catch (e) {
        results.errors.push({ userId: emp.id, error: e.message });
      }
    }

    res.json({
      message: `${results.success.length} bulletin(s) généré(s), ${results.skipped.length} ignoré(s).`,
      ...results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = {
  getAllPayslips,
  generatePayslip,
  downloadPayslip,
  deletePayslip,
  generateAllPayslips,
};
