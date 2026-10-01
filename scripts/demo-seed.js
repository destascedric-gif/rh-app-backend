// Compte de démonstration Orgaly : une pharmacie fictive, prête à être
// montrée à un prospect (gérant + employés, planning, congés, pointages).
//
//   npm run demo
//
// Crée le compte s'il n'existe pas, sinon le remet à neuf : toutes ses
// données sont effacées puis recréées autour de la date du jour, pour que la
// démo ait toujours l'air vivante. Le mot de passe est conservé d'une remise à
// neuf à l'autre ; il n'est généré qu'à la création et écrit dans
// ../demo-identifiants.txt (dossier Orgaly, hors des dépôts git).
//
// Les adresses en @demo.myorgaly.fr ne reçoivent jamais d'e-mail (mailer.js).
require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db     = require('../src/config/db');
const { DEMO_EMAIL_DOMAIN } = require('../src/config/mailer');
const { toLocalDateString } = require('../src/utils/date');
const { recomputeUsedLeave } = require('../src/services/leaveBalance.service');

const ADMIN_EMAIL = `gerant${DEMO_EMAIL_DOMAIN}`;
const EMPLOYEE_EMAIL = `sarah${DEMO_EMAIL_DOMAIN}`;
const CREDENTIALS_FILE = path.join(__dirname, '..', '..', 'demo-identifiants.txt');

const COMPANY = {
  name: 'Pharmacie des Tilleuls (démo)',
  address: '12 rue des Tilleuls', postal_code: '77380', city: 'Combs-la-Ville', sector: 'Pharmacie',
};

// Créneaux types de la pharmacie (ouverte du lundi au samedi, 8h30 – 20h),
// tous avec une pause, chacun avec sa couleur (palette de shiftColors.js)
const SLOTS = {
  O: { name: 'Ouverture', start: '08:30', end: '15:00', brk: ['12:00', '12:30'], color: '#3457D5' },
  F: { name: 'Fermeture', start: '13:30', end: '20:00', brk: ['16:30', '17:00'], color: '#B9791E' },
  J: { name: 'Journée',   start: '09:00', end: '18:00', brk: ['12:30', '13:30'], color: '#1F7A5A' },
};
const breakMinutes = (slot) => {
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return toMin(slot.brk[1]) - toMin(slot.brk[0]);
};

// Équipe : semaine type du lundi au samedi (O/F/J = créneau, R = repos),
// décalée d'un jour chaque semaine pour varier le planning.
const TEAM = [
  { first: 'Sarah',  last: 'Benali',   email: EMPLOYEE_EMAIL, job: 'Préparatrice en pharmacie', contract: 'CDI', time: 'Temps plein', hours: 35, salary: 2150, hire: '2022-09-01', week: 'JOFRJO' },
  { first: 'Julie',  last: 'Moreau',   job: 'Pharmacienne adjointe',     contract: 'CDI', time: 'Temps plein', hours: 35, salary: 3400, hire: '2019-03-15', week: 'OJRFJF' },
  { first: 'Mehdi',  last: 'Lefèvre',  job: 'Préparateur en pharmacie',  contract: 'CDI', time: 'Temps plein', hours: 35, salary: 2150, hire: '2021-01-04', week: 'FRJOFJ' },
  { first: 'Camille', last: 'Roux',    job: 'Préparatrice en pharmacie', contract: 'CDI', time: 'Temps plein', hours: 35, salary: 2200, hire: '2023-05-02', week: 'RFOJOJ' },
  { first: 'Inès',   last: 'Fontaine', job: 'Apprentie préparatrice',    contract: 'Alternance', time: 'Temps partiel', hours: 28, salary: 1100, hire: '2025-09-01', week: 'ORFROF' },
  { first: 'Thomas', last: 'Girard',   job: 'Rayonniste',                contract: 'CDD', time: 'Temps partiel', hours: 24, salary: 1450, hire: '2026-04-01', week: 'RORFRF' },
];

const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const iso = (d) => toLocalDateString(d);
const mondayOf = (d) => { const r = new Date(d); r.setHours(12, 0, 0, 0); return addDays(r, -((r.getDay() + 6) % 7)); };

const readablePassword = () =>
  `Tilleuls-${crypto.randomInt(1000, 10000)}-${crypto.randomBytes(2).toString('hex')}`;

const wipeCompany = async (companyId) => {
  // Références vers les utilisateurs sans suppression en cascade : d'abord
  await db.query('DELETE FROM documents WHERE company_id = $1', [companyId]);
  await db.query('DELETE FROM leave_requests WHERE company_id = $1', [companyId]);
  await db.query('DELETE FROM shifts WHERE company_id = $1', [companyId]);
  await db.query('DELETE FROM payslips WHERE company_id = $1', [companyId]);
  await db.query("DELETE FROM users WHERE company_id = $1 AND role = 'employee'", [companyId]);
  await db.query('DELETE FROM shift_templates WHERE company_id = $1', [companyId]);
};

const main = async () => {
  const existing = await db.query(
    'SELECT id, company_id, password_hash FROM users WHERE email = $1', [ADMIN_EMAIL]
  );

  let password = null;
  let passwordHash;
  let companyId;
  let adminId;

  if (existing.rows[0]) {
    ({ company_id: companyId, id: adminId, password_hash: passwordHash } = existing.rows[0]);
    await wipeCompany(companyId);
    await db.query(
      `UPDATE company SET name = $1, address = $2, postal_code = $3, city = $4, sector = $5,
              plan = 'pro', primary_color = DEFAULT WHERE id = $6`,
      [COMPANY.name, COMPANY.address, COMPANY.postal_code, COMPANY.city, COMPANY.sector, companyId]
    );
    console.log('Compte de démonstration existant : données remises à neuf.');
  } else {
    password = readablePassword();
    passwordHash = await bcrypt.hash(password, 12);
    // Plan Pro : la démo compte plus de 5 employés, et l'ajout d'un employé
    // doit rester possible pendant une présentation.
    companyId = (await db.query(
      `INSERT INTO company (name, address, postal_code, city, sector, plan)
       VALUES ($1, $2, $3, $4, $5, 'pro') RETURNING id`,
      [COMPANY.name, COMPANY.address, COMPANY.postal_code, COMPANY.city, COMPANY.sector]
    )).rows[0].id;
    adminId = (await db.query(
      `INSERT INTO users (company_id, first_name, last_name, email, password_hash, role, invite_accepted,
                          job_title, phone, cgu_accepted_at, cgu_version)
       VALUES ($1, 'Claire', 'Martin', $2, $3, 'admin', TRUE, 'Pharmacienne titulaire', '01 60 00 00 00', NOW(), 'demo')
       RETURNING id`,
      [companyId, ADMIN_EMAIL, passwordHash]
    )).rows[0].id;
    console.log('Compte de démonstration créé.');
  }

  // ── Horaires types ─────────────────────────────────────
  await db.query(
    `INSERT INTO shift_templates (company_id, name, start_time, end_time, break_start, break_end, color)
     SELECT $1, s.name, s.start_time::time, s.end_time::time, s.break_start::time, s.break_end::time, s.color
     FROM json_to_recordset($2) AS s(name text, start_time text, end_time text, break_start text, break_end text, color text)`,
    [companyId, JSON.stringify(Object.values(SLOTS).map((s) => ({
      name: s.name, start_time: s.start, end_time: s.end, break_start: s.brk[0], break_end: s.brk[1], color: s.color,
    })))]
  );

  // ── Équipe ─────────────────────────────────────────────
  const ids = {};
  for (const [i, p] of TEAM.entries()) {
    const email = p.email ?? `${p.first.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}${DEMO_EMAIL_DOMAIN}`;
    ids[p.first] = (await db.query(
      `INSERT INTO users (company_id, first_name, last_name, email, password_hash, role, invite_accepted,
                          job_title, hire_date, gross_salary, contract_type, work_time, weekly_hours, phone)
       VALUES ($1,$2,$3,$4,$5,'employee',TRUE,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [companyId, p.first, p.last, email, passwordHash, p.job, p.hire, p.salary,
       p.contract, p.time, p.hours, `06 12 34 56 ${String(10 + i).padStart(2, '0')}`]
    )).rows[0].id;
  }

  // ── Planning : 4 semaines passées + semaine en cours + 3 à venir ──
  const thisMonday = mondayOf(new Date());
  const firstMonday = addDays(thisMonday, -28);

  const leaves = [
    // Congé passé, approuvé (Sarah = compte employé de démo)
    { who: 'Sarah',  type: 'Congés payés', from: addDays(thisMonday, -14), to: addDays(thisMonday, -10), status: 'approuvé', reason: 'Vacances' },
    // Arrêt maladie récent, approuvé
    { who: 'Inès',   type: 'Congé maladie', from: addDays(thisMonday, -6), to: addDays(thisMonday, -6), status: 'approuvé' },
    // Congé à venir, approuvé
    { who: 'Julie',  type: 'Congés payés', from: addDays(thisMonday, 14), to: addDays(thisMonday, 18), status: 'approuvé', reason: 'Vacances de la Toussaint' },
    // Demandes à traiter (alimentent le tableau de bord et la cloche)
    { who: 'Mehdi',  type: 'Congés payés', from: addDays(thisMonday, 21), to: addDays(thisMonday, 25), status: 'en_attente', reason: 'Mariage de mon frère' },
    { who: 'Thomas', type: 'RTT',          from: addDays(thisMonday, 9),  to: addDays(thisMonday, 9),  status: 'en_attente' },
  ];
  const onLeave = (who, date) => leaves.find((l) => l.status === 'approuvé' && l.who === who && date >= l.from && date <= l.to);

  for (let w = 0; w < 8; w++) {
    const monday = addDays(firstMonday, w * 7);
    for (let d = 0; d < 6; d++) {
      const date = addDays(monday, d);
      for (const p of TEAM) {
        const leave = onLeave(p.first, date);
        if (leave) {
          const type = leave.type === 'Congé maladie' ? 'absence' : 'conge';
          await db.query(
            `INSERT INTO shifts (user_id, company_id, date, start_time, end_time, note, type, created_by)
             VALUES ($1,$2,$3,'00:00','23:59',$4,$5,$6)`,
            [ids[p.first], companyId, iso(date), leave.type, type, adminId]
          );
          continue;
        }
        const code = p.week[(d + w) % 6];
        if (code === 'R') {
          await db.query(
            `INSERT INTO shifts (user_id, company_id, date, start_time, end_time, type, created_by)
             VALUES ($1,$2,$3,'00:00','23:59','repos',$4)`,
            [ids[p.first], companyId, iso(date), adminId]
          );
          continue;
        }
        const slot = SLOTS[code];
        const shiftId = (await db.query(
          `INSERT INTO shifts (user_id, company_id, date, start_time, end_time, type, created_by)
           VALUES ($1,$2,$3,$4,$5,'travail',$6) RETURNING id`,
          [ids[p.first], companyId, iso(date), slot.start, slot.end, adminId]
        )).rows[0].id;
        await db.query(
          `INSERT INTO shift_breaks (shift_id, start_time, end_time, label) VALUES ($1,$2,$3,'Pause')`,
          [shiftId, slot.brk[0], slot.brk[1]]
        );
      }
    }
  }

  // ── Demandes de congé ──────────────────────────────────
  const workingDays = (from, to) => {
    let n = 0;
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) if (d.getDay() !== 0 && d.getDay() !== 6) n++;
    return n;
  };
  for (const l of leaves) {
    const reqId = (await db.query(
      `INSERT INTO leave_requests (user_id, company_id, leave_type, start_date, end_date, working_days, reason,
                                   status, reviewed_by, reviewed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, $11) RETURNING id`,
      [ids[l.who], companyId, l.type, iso(l.from), iso(l.to), workingDays(l.from, l.to), l.reason ?? null,
       l.status, l.status === 'approuvé' ? adminId : null, l.status === 'approuvé' ? addDays(l.from, -10) : null,
       addDays(l.from, -12)]
    )).rows[0].id;
    if (l.who === 'Sarah' && l.status === 'approuvé') {
      await db.query(
        `INSERT INTO leave_notifications (user_id, request_id, message, is_read) VALUES ($1,$2,$3,FALSE)`,
        [ids.Sarah, reqId, `✅ Votre demande de ${l.type} (${l.from.toLocaleDateString('fr-FR')} → ${l.to.toLocaleDateString('fr-FR')}) a été approuvée.`]
      );
    }
  }

  // ── Pointages de Sarah sur les 2 dernières semaines ───
  const shifts = (await db.query(
    `SELECT date, start_time, end_time FROM shifts
     WHERE user_id = $1 AND type = 'travail' AND date >= $2 AND date < $3 ORDER BY date`,
    [ids.Sarah, iso(addDays(thisMonday, -14)), iso(new Date())]
  )).rows;
  for (const [i, s] of shifts.entries()) {
    const slot = Object.values(SLOTS).find((x) => s.start_time.startsWith(x.start));
    const brk = slot ? breakMinutes(slot) : 0;
    const [sh, sm] = s.start_time.split(':').map(Number);
    const [eh, em] = s.end_time.split(':').map(Number);
    const total = ((eh * 60 + em) - (sh * 60 + sm) - brk) / 60;
    await db.query(
      `INSERT INTO timesheets (user_id, company_id, date, clock_in, clock_out, break_minutes, total_hours, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ids.Sarah, companyId, toLocalDateString(s.date), s.start_time, s.end_time, brk, total,
       i === shifts.length - 1 ? 'en_attente' : 'validé'] // le dernier reste à valider
    );
  }

  // ── Soldes de congés calculés à partir du planning ────
  const year = new Date().getFullYear();
  for (const id of Object.values(ids)) await recomputeUsedLeave(id, companyId, year);

  // ── Identifiants ───────────────────────────────────────
  if (password) {
    fs.writeFileSync(CREDENTIALS_FILE, [
      'Compte de démonstration Orgaly — myorgaly.fr',
      '',
      `Gérant  : ${ADMIN_EMAIL}`,
      `Employée : ${EMPLOYEE_EMAIL} (Sarah Benali)`,
      `Mot de passe (le même pour les deux) : ${password}`,
      '',
      'Remettre la démo à neuf : dans backend-propre, lancer « npm run demo ».',
      'Le mot de passe ne change pas lors d\'une remise à neuf.',
      '',
    ].join('\r\n'));
    console.log(`Identifiants écrits dans ${CREDENTIALS_FILE}`);
  } else {
    console.log('Mot de passe inchangé (voir demo-identifiants.txt).');
  }
};

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => db.end());
