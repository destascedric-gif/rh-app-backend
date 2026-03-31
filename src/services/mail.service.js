const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const formatDate = (d) =>
  new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

// Email envoyé à l'employé quand sa demande est approuvée
const sendLeaveApproved = async ({ email, firstName, leaveType, startDate, endDate, workingDays }) => {
  await transporter.sendMail({
    from: `"RH App" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `✅ Demande de congé approuvée`,
    html: `
      <h2>Bonjour ${firstName},</h2>
      <p>Votre demande de congé a été <strong>approuvée</strong>.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 16px 6px 0;color:#666">Type</td>
            <td style="padding:6px 0"><strong>${leaveType}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666">Du</td>
            <td style="padding:6px 0"><strong>${formatDate(startDate)}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666">Au</td>
            <td style="padding:6px 0"><strong>${formatDate(endDate)}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666">Durée</td>
            <td style="padding:6px 0"><strong>${workingDays} jour(s) ouvré(s)</strong></td></tr>
      </table>
      <p>Bonne vacances !</p>
    `,
  });
};

// Email envoyé à l'employé quand sa demande est refusée
const sendLeaveRefused = async ({ email, firstName, leaveType, startDate, endDate, adminNote }) => {
  await transporter.sendMail({
    from: `"RH App" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `❌ Demande de congé refusée`,
    html: `
      <h2>Bonjour ${firstName},</h2>
      <p>Votre demande de congé a été <strong>refusée</strong>.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 16px 6px 0;color:#666">Type</td>
            <td style="padding:6px 0"><strong>${leaveType}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666">Du</td>
            <td style="padding:6px 0"><strong>${formatDate(startDate)}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666">Au</td>
            <td style="padding:6px 0"><strong>${formatDate(endDate)}</strong></td></tr>
      </table>
      ${adminNote ? `<p><strong>Motif :</strong> ${adminNote}</p>` : ''}
      <p>N'hésitez pas à contacter votre responsable pour plus d'informations.</p>
    `,
  });
};

// Email envoyé à l'admin quand un employé soumet une demande
const sendLeaveRequestToAdmin = async ({ adminEmail, employeeName, leaveType, startDate, endDate, workingDays, reason }) => {
  const appUrl = `${process.env.FRONTEND_URL}/admin/leaves`;
  await transporter.sendMail({
    from: `"RH App" <${process.env.SMTP_USER}>`,
    to: adminEmail,
    subject: `📋 Nouvelle demande de congé — ${employeeName}`,
    html: `
      <h2>Nouvelle demande de congé</h2>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 16px 6px 0;color:#666">Employé</td>
            <td style="padding:6px 0"><strong>${employeeName}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666">Type</td>
            <td style="padding:6px 0"><strong>${leaveType}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666">Du</td>
            <td style="padding:6px 0"><strong>${formatDate(startDate)}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666">Au</td>
            <td style="padding:6px 0"><strong>${formatDate(endDate)}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#666">Durée</td>
            <td style="padding:6px 0"><strong>${workingDays} jour(s) ouvré(s)</strong></td></tr>
        ${reason ? `<tr><td style="padding:6px 16px 6px 0;color:#666">Motif</td>
            <td style="padding:6px 0">${reason}</td></tr>` : ''}
      </table>
      <a href="${appUrl}" style="
        display:inline-block;padding:10px 20px;background:#4F46E5;
        color:#fff;border-radius:6px;text-decoration:none;font-weight:bold
      ">Traiter la demande →</a>
    `,
  });
};

module.exports = { sendLeaveApproved, sendLeaveRefused, sendLeaveRequestToAdmin };
