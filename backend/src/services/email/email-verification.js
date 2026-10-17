const { renderLayout, paragraph, smallText, codeBlock, noticeBox, escapeHtml } = require('./layout');

/**
 * Email carrying the code that confirms the address of a new account.
 * @returns {{ subject: string, html: string, text: string }}
 */
function emailVerificationEmail({ code, displayName, email, validMinutes }) {
  const greeting = displayName ? `Bonjour ${displayName},` : 'Bonjour,';

  const html = renderLayout({
    title: 'Confirmez votre adresse email',
    preheader: `Votre code de confirmation est valable ${validMinutes} minutes.`,
    content: [
      paragraph(escapeHtml(greeting)),
      paragraph('Bienvenue sur Mesnia ! Pour confirmer que cette adresse est bien la vôtre, saisissez ce code dans l’application :'),
      codeBlock(code),
      smallText(`Ce code est valable <strong>${validMinutes} minutes</strong>. Une adresse confirmée vous permet de récupérer votre compte si vous oubliez votre mot de passe.`),
      noticeBox(
        'Vous n’avez pas créé de compte Mesnia ?',
        'Quelqu’un a peut-être saisi votre adresse par erreur. Ignorez simplement cet email : sans ce code, l’adresse ne sera pas confirmée.'
      )
    ].join('\n'),
    footer: `Cet email a été envoyé à ${escapeHtml(email)} suite à la création d’un compte Mesnia.`
  });

  const text = [
    greeting,
    '',
    'Bienvenue sur Mesnia ! Pour confirmer que cette adresse est bien la vôtre, saisissez ce code dans l’application :',
    '',
    `    ${code}`,
    '',
    `Ce code est valable ${validMinutes} minutes.`,
    '',
    'Vous n’avez pas créé de compte Mesnia ? Ignorez simplement cet email.',
    '',
    '—',
    'Mesnia · Email automatique, merci de ne pas y répondre.'
  ].join('\n');

  return { subject: 'Confirmez votre adresse email Mesnia', html, text };
}

module.exports = { emailVerificationEmail };
