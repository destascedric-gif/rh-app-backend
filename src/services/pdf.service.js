const PDFDocument = require('pdfkit');

const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin',
                 'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

const fmt = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (t) => `${(t * 100).toFixed(2)} %`;

/**
 * Génère un bulletin de paie PDF et le retourne en Buffer
 */
const generatePayslipPDF = ({
  company,
  employee,
  payslip,
  cotisations,
  leaveBalance,
}) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 45 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end',  ()      => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W       = 505; // largeur utile
    const GRAY    = '#f5f5f3';
    const DARK    = '#1a1a1a';
    const MUTED   = '#6b6b68';
    const BLUE    = '#185FA5';
    const BORDER  = '#d3d1c7';

    // ── EN-TÊTE ENTREPRISE ───────────────────────────────
    doc.rect(45, 45, W, 70).fill(BLUE);

    doc.fillColor('#ffffff')
       .font('Helvetica-Bold').fontSize(16)
       .text(company.name, 55, 58, { width: W - 20 });

    doc.font('Helvetica').fontSize(9).fillColor('#cce0f5')
       .text(`SIRET : ${company.siret ?? '—'}`, 55, 80)
       .text(`${company.address ?? ''} ${company.postal_code ?? ''} ${company.city ?? ''}`, 55, 92);

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
       .text('BULLETIN DE PAIE', 350, 68, { width: 190, align: 'right' });

    doc.font('Helvetica').fontSize(9).fillColor('#cce0f5')
       .text(`Période : ${MONTHS[payslip.period_month - 1]} ${payslip.period_year}`, 350, 85, { width: 190, align: 'right' });

    // ── INFORMATIONS EMPLOYÉ ─────────────────────────────
    let y = 130;
    doc.rect(45, y, W, 72).fill(GRAY).stroke(BORDER);

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
       .text('Employé', 55, y + 10);

    const col2 = 280;
    doc.font('Helvetica').fontSize(9).fillColor(DARK);

    const empLines = [
      ['Nom complet',   `${employee.first_name} ${employee.last_name}`],
      ['Poste',         employee.job_title ?? '—'],
      ['Type contrat',  employee.contract_type ?? '—'],
    ];
    empLines.forEach(([label, val], i) => {
      doc.fillColor(MUTED).text(label, 55,     y + 24 + i * 14);
      doc.fillColor(DARK) .text(val,  180,    y + 24 + i * 14);
    });

    const empLines2 = [
      ['Date d\'embauche', employee.hire_date
        ? new Date(employee.hire_date).toLocaleDateString('fr-FR') : '—'],
      ['Temps de travail', employee.work_time ?? '—'],
      ['N° SS',            employee.social_security
        ? '•'.repeat(11) + employee.social_security.slice(-4) : '—'],
    ];
    empLines2.forEach(([label, val], i) => {
      doc.fillColor(MUTED).text(label, col2,      y + 24 + i * 14);
      doc.fillColor(DARK) .text(val,  col2 + 110, y + 24 + i * 14);
    });

    // ── TABLEAU COTISATIONS ──────────────────────────────
    y += 90;
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
       .text('Détail des cotisations salariales', 45, y);

    y += 16;

    // En-tête tableau
    doc.rect(45, y, W, 18).fill(BLUE);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    doc.text('Libellé',         55,  y + 5);
    doc.text('Base (€)',        280, y + 5, { width: 70, align: 'right' });
    doc.text('Taux',            355, y + 5, { width: 55, align: 'right' });
    doc.text('Montant (€)',     415, y + 5, { width: 75, align: 'right' });

    y += 18;

    // Groupement par catégorie
    const categories = [...new Set(cotisations.lignes.map(l => l.categorie))];
    let rowBg = false;

    categories.forEach((cat) => {
      const lignes = cotisations.lignes.filter(l => l.categorie === cat);

      // Titre catégorie
      doc.rect(45, y, W, 14).fill('#eef4fb');
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(8)
         .text(cat, 55, y + 3);
      y += 14;

      lignes.forEach((ligne) => {
        doc.rect(45, y, W, 14).fill(rowBg ? GRAY : '#ffffff');
        rowBg = !rowBg;

        doc.fillColor(DARK).font('Helvetica').fontSize(8);
        doc.text(ligne.label,          55,  y + 3);
        doc.text(fmt(ligne.assiette),  280, y + 3, { width: 70,  align: 'right' });
        doc.text(fmtPct(ligne.taux),   355, y + 3, { width: 55,  align: 'right' });
        doc.text(fmt(ligne.montant),   415, y + 3, { width: 75,  align: 'right' });

        // Ligne de séparation légère
        doc.moveTo(45, y + 14).lineTo(550, y + 14).strokeColor(BORDER).lineWidth(0.5).stroke();
        y += 14;
      });
    });

    // Total cotisations
    doc.rect(45, y, W, 18).fill('#e8f0fb');
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9);
    doc.text('Total cotisations salariales', 55, y + 4);
    doc.text(fmt(cotisations.totalSalarial), 415, y + 4, { width: 75, align: 'right' });
    y += 18;

    // ── RÉCAPITULATIF NET ────────────────────────────────
    y += 12;
    doc.rect(45, y, W, 80).fill(GRAY).stroke(BORDER);

    const recap = [
      { label: 'Salaire brut',        val: fmt(payslip.gross_amount), bold: false },
      { label: 'Total cotisations',   val: `- ${fmt(cotisations.totalSalarial)}`, bold: false },
      { label: 'Net imposable',       val: fmt(cotisations.netImposable), bold: false },
    ];

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
       .text('Récapitulatif', 55, y + 10);

    recap.forEach((r, i) => {
      doc.font(r.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(MUTED)
         .text(r.label, 55, y + 28 + i * 14);
      doc.fillColor(DARK)
         .text(r.val, 380, y + 28 + i * 14, { width: 120, align: 'right' });
    });

    // NET À PAYER (mis en valeur)
    doc.rect(350, y + 10, 190, 32).fill(BLUE);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(8)
       .text('NET À PAYER', 360, y + 16);
    doc.font('Helvetica-Bold').fontSize(16)
       .text(`${fmt(payslip.net_amount)} €`, 360, y + 26, { width: 170, align: 'right' });

    y += 92;

    // ── CONGÉS ───────────────────────────────────────────
    if (leaveBalance) {
      doc.rect(45, y, W, 36).fill(GRAY).stroke(BORDER);
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9)
         .text('Congés payés', 55, y + 8);

      const cp = leaveBalance['Congés payés'];
      if (cp) {
        const available = Math.max(0, cp.balance_days - cp.used_days);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        doc.text(`Acquis : ${cp.balance_days} j`, 200, y + 8);
        doc.text(`Pris : ${cp.used_days} j`,      310, y + 8);
        doc.fillColor(BLUE).font('Helvetica-Bold')
           .text(`Restants : ${available} j`,     415, y + 8, { width: 120, align: 'right' });
      }

      const rtt = leaveBalance['RTT'];
      if (rtt) {
        const availRtt = Math.max(0, rtt.balance_days - rtt.used_days);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        doc.text('RTT', 55, y + 22);
        doc.text(`Acquis : ${rtt.balance_days} j`, 200, y + 22);
        doc.text(`Pris : ${rtt.used_days} j`,      310, y + 22);
        doc.fillColor(BLUE).font('Helvetica-Bold')
           .text(`Restants : ${availRtt} j`,       415, y + 22, { width: 120, align: 'right' });
      }
      y += 48;
    }

    // ── PIED DE PAGE ─────────────────────────────────────
    y += 16;
    doc.moveTo(45, y).lineTo(550, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    y += 8;

    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
       .text(
         `Bulletin généré le ${new Date().toLocaleDateString('fr-FR')} — ${company.name} — SIRET ${company.siret ?? '—'}`,
         45, y, { width: W, align: 'center' }
       );

    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
       .text(
         'Conserver ce bulletin sans limitation de durée (art. L3243-4 du Code du travail)',
         45, y + 12, { width: W, align: 'center' }
       );

    doc.end();
  });
};

module.exports = { generatePayslipPDF };
