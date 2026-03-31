const db          = require('../config/db');
const { countWorkingDays, computeLegalBalance } = require('../services/leaves.service');
const { sendLeaveApproved, sendLeaveRefused, sendLeaveRequestToAdmin } = require('../services/mail.service');

const LEAVE_TYPES = [
  'Congés payés',
  'RTT',
  'Congé maladie',
  'Congé sans solde',
  'Congé maternité / paternité',
];

// ─────────────────────────────────────────────
// SOLDES — EMPLOYÉ
// ─────────────────────────────────────────────

// GET /api/leaves/balance
// Retourne les soldes de l'employé connecté pour l'année en cours
const getMyBalance = async (req, res) => {
  const { id: userId, companyId } = req.user;
  const year = new Date().getFullYear();

  try {
    // Récupère ou initialise les soldes
    const result = await db.query(
      `SELECT leave_type, balance_days, used_days
       FROM leave_balances
       WHERE user_id = $1 AND company_id = $2 AND year = $3`,
      [userId, companyId, year]
    );

    // Si pas encore de solde CP, on le calcule depuis la date d'embauche
    const balances = {};
    LEAVE_TYPES.forEach((t) => { balances[t] = { balance_days: 0, used_days: 0 }; });
    result.rows.forEach((r) => {
      balances[r.leave_type] = {
        balance_days: parseFloat(r.balance_days),
        used_days:    parseFloat(r.used_days),
      };
    });

    // Calcul automatique CP si non initialisé
    if (balances['Congés payés'].balance_days === 0) {
      const userResult = await db.query('SELECT hire_date FROM users WHERE id = $1', [userId]);
      const hireDate   = userResult.rows[0]?.hire_date;
      if (hireDate) {
        const legalDays = computeLegalBalance(hireDate, year);
        balances['Congés payés'].balance_days = legalDays;

        // Persiste le solde calculé
        await db.query(
          `INSERT INTO leave_balances (user_id, company_id, leave_type, balance_days, year)
           VALUES ($1, $2, 'Congés payés', $3, $4)
           ON CONFLICT (user_id, leave_type, year)
           DO UPDATE SET balance_days = $3, updated_at = NOW()`,
          [userId, companyId, legalDays, year]
        );
      }
    }

    res.json({ year, balances });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// DEMANDES — EMPLOYÉ
// ─────────────────────────────────────────────

// GET /api/leaves/my-requests
const getMyRequests = async (req, res) => {
  const { id: userId } = req.user;

  try {
    const result = await db.query(
      `SELECT r.id, r.leave_type, r.start_date, r.end_date,
              r.working_days, r.reason, r.status,
              r.admin_note, r.created_at, r.reviewed_at,
              u.first_name || ' ' || u.last_name AS reviewed_by_name
       FROM leave_requests r
       LEFT JOIN users u ON u.id = r.reviewed_by
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/leaves/request
// L'employé soumet une demande de congé
const submitRequest = async (req, res) => {
  const { id: userId, companyId } = req.user;
  const { leaveType, startDate, endDate, reason } = req.body;

  if (!leaveType || !startDate || !endDate) {
    return res.status(400).json({ message: 'Type, date de début et de fin requis.' });
  }

  if (!LEAVE_TYPES.includes(leaveType)) {
    return res.status(400).json({ message: 'Type de congé invalide.' });
  }

  if (new Date(startDate) > new Date(endDate)) {
    return res.status(400).json({ message: 'La date de début doit être avant la date de fin.' });
  }

  try {
    const workingDays = countWorkingDays(startDate, endDate);

    if (workingDays === 0) {
      return res.status(400).json({ message: 'La période sélectionnée ne contient aucun jour ouvré.' });
    }

    // Vérifie le solde disponible pour les CP
    if (leaveType === 'Congés payés') {
      const year    = new Date(startDate).getFullYear();
      const balance = await db.query(
        `SELECT balance_days, used_days FROM leave_balances
         WHERE user_id = $1 AND leave_type = 'Congés payés' AND year = $2`,
        [userId, year]
      );
      const row       = balance.rows[0];
      const available = row ? (parseFloat(row.balance_days) - parseFloat(row.used_days)) : 0;
      if (workingDays > available) {
        return res.status(400).json({
          message: `Solde insuffisant. Disponible : ${available} jour(s), demandé : ${workingDays} jour(s).`,
        });
      }
    }

    // Insère la demande
    const result = await db.query(
      `INSERT INTO leave_requests
         (user_id, company_id, leave_type, start_date, end_date, working_days, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, companyId, leaveType, startDate, endDate, workingDays, reason]
    );

    const requestId = result.rows[0].id;

    // Récupère infos employé + admin pour les emails
    const userResult = await db.query(
      `SELECT u.first_name, u.last_name, u.email,
              a.email AS admin_email
       FROM users u
       JOIN users a ON a.company_id = u.company_id AND a.role = 'admin'
       WHERE u.id = $1`,
      [userId]
    );
    const user = userResult.rows[0];

    // Notification in-app
    await db.query(
      `INSERT INTO leave_notifications (user_id, request_id, message)
       VALUES ($1, $2, $3)`,
      [userId, requestId, `Votre demande de ${leaveType} du ${startDate} au ${endDate} a bien été envoyée.`]
    );

    // Email à l'admin
    try {
      await sendLeaveRequestToAdmin({
        adminEmail:   user.admin_email,
        employeeName: `${user.first_name} ${user.last_name}`,
        leaveType, startDate, endDate, workingDays, reason,
      });
    } catch (mailErr) {
      console.error('Erreur email admin:', mailErr.message);
    }

    res.status(201).json({ message: 'Demande envoyée.', requestId, workingDays });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// NOTIFICATIONS IN-APP — EMPLOYÉ
// ─────────────────────────────────────────────

// GET /api/leaves/notifications
const getNotifications = async (req, res) => {
  const { id: userId } = req.user;
  try {
    const result = await db.query(
      `SELECT id, message, is_read, created_at
       FROM leave_notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// PATCH /api/leaves/notifications/read-all
const markAllRead = async (req, res) => {
  const { id: userId } = req.user;
  try {
    await db.query(
      'UPDATE leave_notifications SET is_read = TRUE WHERE user_id = $1',
      [userId]
    );
    res.json({ message: 'Notifications lues.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// ADMIN — TOUTES LES DEMANDES
// ─────────────────────────────────────────────

// GET /api/leaves/admin/requests?status=en_attente
const getAllRequests = async (req, res) => {
  const { companyId } = req.user;
  const { status } = req.query;

  try {
    let query = `
      SELECT r.id, r.leave_type, r.start_date, r.end_date,
             r.working_days, r.reason, r.status,
             r.admin_note, r.created_at, r.reviewed_at,
             u.id AS employee_id,
             u.first_name || ' ' || u.last_name AS employee_name,
             u.email AS employee_email, u.photo_url, u.job_title
      FROM leave_requests r
      JOIN users u ON u.id = r.user_id
      WHERE r.company_id = $1`;

    const params = [companyId];

    if (status) {
      query  += ` AND r.status = $2`;
      params.push(status);
    }

    query += ' ORDER BY r.created_at DESC';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// PATCH /api/leaves/admin/requests/:id — Approuver ou refuser
const reviewRequest = async (req, res) => {
  const { companyId, id: adminId } = req.user;
  const { id } = req.params;
  const { status, adminNote } = req.body;

  if (!['approuvé', 'refusé'].includes(status)) {
    return res.status(400).json({ message: 'Statut invalide. Valeurs : approuvé, refusé.' });
  }

  try {
    // Récupère la demande
    const reqResult = await db.query(
      `SELECT r.*, u.first_name, u.last_name, u.email, u.id AS employee_id
       FROM leave_requests r
       JOIN users u ON u.id = r.user_id
       WHERE r.id = $1 AND r.company_id = $2`,
      [id, companyId]
    );

    const request = reqResult.rows[0];
    if (!request) {
      return res.status(404).json({ message: 'Demande introuvable.' });
    }

    if (request.status !== 'en_attente') {
      return res.status(400).json({ message: 'Cette demande a déjà été traitée.' });
    }

    // Met à jour le statut
    await db.query(
      `UPDATE leave_requests
       SET status = $1, admin_note = $2, reviewed_by = $3,
           reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [status, adminNote, adminId, id]
    );

    // Si approuvé : débite le solde
    if (status === 'approuvé' && request.leave_type === 'Congés payés') {
      const year = new Date(request.start_date).getFullYear();
      await db.query(
        `UPDATE leave_balances
         SET used_days = used_days + $1, updated_at = NOW()
         WHERE user_id = $2 AND leave_type = 'Congés payés' AND year = $3`,
        [request.working_days, request.employee_id, year]
      );
    }

    // Notification in-app pour l'employé
    const notifMsg = status === 'approuvé'
      ? `✅ Votre demande de ${request.leave_type} (${request.start_date} → ${request.end_date}) a été approuvée.`
      : `❌ Votre demande de ${request.leave_type} (${request.start_date} → ${request.end_date}) a été refusée.${adminNote ? ` Motif : ${adminNote}` : ''}`;

    await db.query(
      `INSERT INTO leave_notifications (user_id, request_id, message)
       VALUES ($1, $2, $3)`,
      [request.employee_id, id, notifMsg]
    );

    // Email à l'employé
    try {
      if (status === 'approuvé') {
        await sendLeaveApproved({
          email: request.email, firstName: request.first_name,
          leaveType: request.leave_type, startDate: request.start_date,
          endDate: request.end_date, workingDays: request.working_days,
        });
      } else {
        await sendLeaveRefused({
          email: request.email, firstName: request.first_name,
          leaveType: request.leave_type, startDate: request.start_date,
          endDate: request.end_date, adminNote,
        });
      }
    } catch (mailErr) {
      console.error('Erreur email employé:', mailErr.message);
    }

    res.json({ message: `Demande ${status}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// GET /api/leaves/admin/balances/:userId — Solde d'un employé (vue admin)
const getEmployeeBalance = async (req, res) => {
  const { companyId } = req.user;
  const { userId }    = req.params;
  const year = new Date().getFullYear();

  try {
    const result = await db.query(
      `SELECT leave_type, balance_days, used_days
       FROM leave_balances
       WHERE user_id = $1 AND company_id = $2 AND year = $3`,
      [userId, companyId, year]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = {
  getMyBalance, getMyRequests, submitRequest,
  getNotifications, markAllRead,
  getAllRequests, reviewRequest, getEmployeeBalance,
};
