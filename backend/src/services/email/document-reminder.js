const { renderLayout, paragraph, smallText, escapeHtml, COLORS } = require('./layout');

const FONT = "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const formatDate = iso => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' })
  .format(new Date(`${iso}T00:00:00Z`));

/** "expire dans 30 jours" / "expire demain" / "expire aujourd'hui" / "a expiré" */
function dueLabel(daysLeft) {
  if (daysLeft < 0) return 'a expiré';
  if (daysLeft === 0) return 'expire aujourd’hui';
  if (daysLeft === 1) return 'expire demain';
  return `expire dans ${daysLeft} jours`;
}

/** One row of the document list: title on the left, expiry on the right. */
function documentRow({ title, expiresAt, daysLeft }) {
  const urgent = daysLeft <= 7;
  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid ${COLORS.border};font-family:${FONT};font-size:15px;line-height:22px;font-weight:700;color:${COLORS.text}">${escapeHtml(title)}</td>
      <td align="right" style="padding:14px 0 14px 12px;border-bottom:1px solid ${COLORS.border};font-family:${FONT};font-size:13px;line-height:20px;white-space:nowrap;color:${urgent ? '#B45309' : COLORS.muted}">
        ${escapeHtml(dueLabel(daysLeft))}<br><span style="color:${COLORS.faint}">${formatDate(expiresAt)}</span>
      </td>
    </tr>`;
}

/**
 * Reminder of the documents a member has to renew soon.
 * @param {{ displayName?: string, email: string, documents: { title: string, expiresAt: string, daysLeft: number }[] }} details
 * @returns {{ subject: string, html: string, text: string }}
 */
function documentReminderEmail({ displayName, email, documents }) {
  const greeting = displayName ? `Bonjour ${displayName},` : 'Bonjour,';
  const single = documents.length === 1;
  const subject = single
    ? `« ${documents[0].title} » ${dueLabel(documents[0].daysLeft)}`
    : `${documents.length} documents à renouveler bientôt`;

  const html = renderLayout({
    title: single ? 'Un document est à renouveler' : 'Des documents sont à renouveler',
    preheader: subject,
    content: [
      paragraph(escapeHtml(greeting)),
      paragraph(single
        ? 'Un document rangé dans Mesnia arrive à expiration. Pensez à lancer son renouvellement à temps :'
        : 'Plusieurs documents rangés dans Mesnia arrivent à expiration. Pensez à lancer leur renouvellement à temps :'),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">${documents.map(documentRow).join('')}</table>`,
      smallText('Retrouvez-les dans l’application, rubrique <strong>Documents</strong> › <strong>À renouveler</strong>. Une fois le nouveau document reçu, mettez à jour sa date d’expiration : les rappels repartiront de cette date.'),
    ].join('\n'),
    footer: `Cet email a été envoyé à ${escapeHtml(email)}. Vous pouvez désactiver ces rappels dans l’application : Paramètres › Notifications.`
  });

  const text = [
    greeting,
    '',
    single ? 'Un document rangé dans Mesnia arrive à expiration :' : 'Plusieurs documents rangés dans Mesnia arrivent à expiration :',
    '',
    ...documents.map(doc => `- ${doc.title} : ${dueLabel(doc.daysLeft)} (${formatDate(doc.expiresAt)})`),
    '',
    'Retrouvez-les dans l’application, rubrique Documents › À renouveler.',
    'Vous pouvez désactiver ces rappels dans Paramètres › Notifications.',
    '',
    '—',
    'Mesnia · Email automatique, merci de ne pas y répondre.'
  ].join('\n');

  return { subject, html, text };
}

module.exports = { documentReminderEmail, dueLabel };
