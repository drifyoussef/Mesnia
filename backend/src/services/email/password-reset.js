const { renderLayout, paragraph, smallText, codeBlock, noticeBox, escapeHtml } = require('./layout');

/**
 * Email carrying a password reset code.
 * @returns {{ subject: string, html: string, text: string }}
 */
function passwordResetEmail({ code, displayName, email, validMinutes }) {
  const greeting = displayName ? `Bonjour ${displayName},` : 'Bonjour,';
  const title = 'Réinitialisation de votre mot de passe';

  const html = renderLayout({
    title,
    preheader: `Votre code est valable ${validMinutes} minutes. Saisissez-le dans l'application pour choisir un nouveau mot de passe.`,
    content: [
      paragraph(escapeHtml(greeting)),
      paragraph('Vous avez demandé à réinitialiser le mot de passe de votre compte Mesnia. Saisissez ce code dans l’application pour en choisir un nouveau :'),
      codeBlock(code),
      smallText(`Ce code est valable <strong>${validMinutes} minutes</strong> et ne peut servir qu’une seule fois.`),
      noticeBox(
        'Vous n’êtes pas à l’origine de cette demande ?',
        'Ignorez simplement cet email : votre mot de passe reste inchangé et personne ne peut accéder à votre compte sans ce code. Ne le communiquez jamais, même à quelqu’un qui se présente comme l’équipe Mesnia.'
      )
    ].join('\n'),
    footer: `Cet email a été envoyé à ${escapeHtml(email)} suite à une demande de réinitialisation de mot de passe sur Mesnia.`
  });

  const text = [
    greeting,
    '',
    'Vous avez demandé à réinitialiser le mot de passe de votre compte Mesnia.',
    'Saisissez ce code dans l’application pour en choisir un nouveau :',
    '',
    `    ${code}`,
    '',
    `Ce code est valable ${validMinutes} minutes et ne peut servir qu’une seule fois.`,
    '',
    'Vous n’êtes pas à l’origine de cette demande ? Ignorez simplement cet email : votre mot de passe reste inchangé.',
    'Ne communiquez jamais ce code, même à quelqu’un qui se présente comme l’équipe Mesnia.',
    '',
    '—',
    'Mesnia · Email automatique, merci de ne pas y répondre.'
  ].join('\n');

  return { subject: 'Votre code de réinitialisation Mesnia', html, text };
}

module.exports = { passwordResetEmail };
