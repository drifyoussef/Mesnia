const { renderLayout, paragraph, smallText, noticeBox, escapeHtml } = require('./layout');

const formatDate = date => new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris'
}).format(date);

/**
 * Security alert sent after a password change or reset.
 * @returns {{ subject: string, html: string, text: string }}
 */
function passwordChangedEmail({ displayName, email, changedAt = new Date() }) {
  const greeting = displayName ? `Bonjour ${displayName},` : 'Bonjour,';
  const when = formatDate(changedAt);

  const html = renderLayout({
    title: 'Votre mot de passe a été modifié',
    preheader: `Le mot de passe de votre compte Mesnia a été modifié le ${when}.`,
    content: [
      paragraph(escapeHtml(greeting)),
      paragraph(`Le mot de passe de votre compte Mesnia a été modifié le <strong>${when}</strong> (heure de Paris).`),
      smallText('Par sécurité, tous vos appareils ont été déconnectés, sauf celui qui a fait la modification.'),
      noticeBox(
        'Ce n’était pas vous ?',
        'Utilisez tout de suite « Mot de passe oublié » sur l’écran de connexion de l’application pour reprendre la main sur votre compte : un code vous sera envoyé à cette adresse.'
      )
    ].join('\n'),
    footer: `Cet email de sécurité a été envoyé à ${escapeHtml(email)}, l’adresse de votre compte Mesnia.`
  });

  const text = [
    greeting,
    '',
    `Le mot de passe de votre compte Mesnia a été modifié le ${when} (heure de Paris).`,
    'Par sécurité, tous vos appareils ont été déconnectés, sauf celui qui a fait la modification.',
    '',
    'Ce n’était pas vous ? Utilisez tout de suite « Mot de passe oublié » sur l’écran de connexion de l’application.',
    '',
    '—',
    'Mesnia · Email automatique, merci de ne pas y répondre.'
  ].join('\n');

  return { subject: 'Votre mot de passe Mesnia a été modifié', html, text };
}

module.exports = { passwordChangedEmail };
