const db          = require('../config/db');
const { countWorkingDays } = require('../services/leaves.service');
const { getOrComputeCPBalance, recomputeUsedLeave, yearsBetween } = require('../services/leaveBalance.service');
const { sendLeaveApproved, sendLeaveRefused, sendLeaveRequestToAdmin } = require('../services/mail.service');
const { toLocalDateString } = require('../utils/date');

const LEAVE_TYPES = [
  'Congés payés',
  'RTT',
  'Congé maladie',
  'Congé sans solde',
  'Congé maternité / paternité',
];

const formatDate = (d) => new Date(d).toLocaleDateString('fr-FR');

// Demande du même employé dont la période chevauche [startDate, endDate]
// (bornes incluses), parmi les statuts donnés. excludeId : la demande en
// cours d'examen elle-même.
const findOverlappingRequest = async (userId, startDate, endDate, statuses, excludeId = null) => {
  const result = await db.query(
    `SELECT id, status, start_date, end_date FROM leave_requests
     WHERE user_id = $1 AND status::text = ANY($2::text[])
       AND start_date <= $4 AND end_date >= $3
       AND ($5::uuid IS NULL OR id <> $5::uuid)
     ORDER BY start_date LIMIT 1`,
    [userId, statuses, startDate, endDate, excludeId]
  );
  return result.rows[0] ?? null;
};

// ─────────────────────────────────────────────
// SOLDES — EMPLOYÉ
// ─────────────────────────────────────────────

// GET /api/leaves/balance
// Retourne les soldes de l'employé connecté pour l'année en cours
const getMyBalance = async (req, res) => {
  const { id: userId, companyId } = req.user;
  const year = new Date().getFullYear();

  try {
    const result = await db.query(
      `SELECT leave_type, balance_days, used_days
       FROM leave_balances
       WHERE user_id = $1 AND company_id = $2 AND year = $3`,
      [userId, companyId, year]
    );

    const balances = {};
    LEAVE_TYPES.forEach((t) => { balances[t] = { balance_days: 0, used_days: 0 }; });
    result.rows.forEach((r) => {
      balances[r.leave_type] = {
        balance_days: parseFloat(r.balance_days),
        used_days:    parseFloat(r.used_days),
      };
    });

    if (balances['Congés payés'].balance_days === 0) {
      balances['Congés payés'] = await getOrComputeCPBalance(userId, companyId, year);
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

  try {
    const workingDays = countWorkingDays(startDate, endDate);

    if (workingDays === 0) {
      return res.status(400).json({ message: 'La période sélectionnée ne contient aucun jour ouvré.' });
    }

    // Une même journée ne peut faire l'objet que d'une seule demande active
    const overlap = await findOverlappingRequest(userId, startDate, endDate, ['en_attente', 'approuvé']);
    if (overlap) {
      return res.status(409).json({
        message: `Vous avez déjà une demande ${overlap.status === 'approuvé' ? 'approuvée' : 'en attente'} `
          + `qui couvre une partie de ces dates (du ${formatDate(overlap.start_date)} au ${formatDate(overlap.end_date)}).`,
      });
    }

    // Calcule le solde réellement acquis pour l'année concernée par la demande
    // (même si elle est future) — juste à titre d'avertissement, sans bloquer :
    // l'admin garde la décision finale.
    let balanceWarning = null;
    if (leaveType === 'Congés payés') {
      const year = new Date(startDate).getFullYear();
      const { balance_days, used_days } = await getOrComputeCPBalance(userId, companyId, year);
      const available = balance_days - used_days;
      if (workingDays > available) {
        balanceWarning = { available, requested: workingDays };
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
      [userId, requestId, `Votre demande de ${leaveType} du ${new Date(startDate).toLocaleDateString('fr-FR')} au ${new Date(endDate).toLocaleDateString('fr-FR')} a bien été envoyée.`]
    );

    // Email à l'admin
    let emailSent = true;
    try {
      await sendLeaveRequestToAdmin({
        adminEmail:   user.admin_email,
        employeeName: `${user.first_name} ${user.last_name}`,
        leaveType, startDate, endDate, workingDays, reason,
      });
    } catch (mailErr) {
      console.error('Erreur email admin:', mailErr.message);
      emailSent = false;
    }

    res.status(201).json({ message: 'Demande envoyée.', requestId, workingDays, emailSent, balanceWarning });
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

    // Deux congés approuvés ne peuvent pas couvrir les mêmes jours
    if (status === 'approuvé') {
      const overlap = await findOverlappingRequest(
        request.employee_id, request.start_date, request.end_date, ['approuvé'], request.id
      );
      if (overlap) {
        return res.status(409).json({
          message: `Ces dates chevauchent un congé déjà approuvé pour cet employé `
            + `(du ${formatDate(overlap.start_date)} au ${formatDate(overlap.end_date)}). `
            + 'Refusez cette demande ou ajustez le planning.',
        });
      }
    }

    // Met à jour le statut
    await db.query(
      `UPDATE leave_requests
       SET status = $1, admin_note = $2, reviewed_by = $3,
           reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [status, adminNote, adminId, id]
    );

    // Si approuvé : intègre automatiquement le congé dans le planning, jour
    // par jour, en créneaux de type "congé" (ou "absence" pour maladie /
    // sans solde) — écrase un éventuel créneau de travail déjà prévu ce jour.
    if (status === 'approuvé') {
      const shiftType = ['Congé maladie', 'Congé sans solde'].includes(request.leave_type)
        ? 'absence' : 'conge';

      const dates = [];
      const cursor = new Date(request.start_date);
      const end    = new Date(request.end_date);
      while (cursor <= end) {
        dates.push(toLocalDateString(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }

      for (const date of dates) {
        await db.query(
          `INSERT INTO shifts (user_id, company_id, date, start_time, end_time, note, type, created_by)
           VALUES ($1, $2, $3, '00:00', '23:59', $4, $5, $6)
           ON CONFLICT (user_id, date) DO UPDATE SET
             start_time = '00:00', end_time = '23:59', note = $4, type = $5, updated_at = NOW()`,
          [request.employee_id, companyId, date, request.leave_type, shiftType, adminId]
        );
      }

      // Le solde est déduit du planning qu'on vient d'écrire (voir
      // recomputeUsedLeave) : chaque jour n'est compté qu'une fois.
      for (const year of yearsBetween(request.start_date, request.end_date)) {
        await recomputeUsedLeave(request.employee_id, companyId, year);
      }
    }

    // Notification in-app pour l'employé — dates formatées en français, pas
    // le résultat brut de Date.toString() qu'on obtient en interpolant
    // directement un objet Date dans un template literal.
    const startLabel = new Date(request.start_date).toLocaleDateString('fr-FR');
    const endLabel   = new Date(request.end_date).toLocaleDateString('fr-FR');
    const notifMsg = status === 'approuvé'
      ? `✅ Votre demande de ${request.leave_type} (${startLabel} → ${endLabel}) a été approuvée.`
      : `❌ Votre demande de ${request.leave_type} (${startLabel} → ${endLabel}) a été refusée.${adminNote ? ` Motif : ${adminNote}` : ''}`;

    await db.query(
      `INSERT INTO leave_notifications (user_id, request_id, message)
       VALUES ($1, $2, $3)`,
      [request.employee_id, id, notifMsg]
    );

    // Email à l'employé
    let emailSent = true;
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
      emailSent = false;
    }

    res.json({ message: `Demande ${status}.`, emailSent });
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
