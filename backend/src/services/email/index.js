// Sending emails (Gmail with an app password, see GMAIL_USER / GMAIL_APP_PASSWORD in .env).
// Each email is a template ({ subject, html, text }) built on layout.js.

const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { LOGO_CID } = require('./layout');
const { passwordResetEmail } = require('./password-reset');
const { emailVerificationEmail } = require('./email-verification');
const { passwordChangedEmail } = require('./password-changed');
const { documentReminderEmail } = require('./document-reminder');

let transporter = null;
let customTransport = null;

function getTransporter() {
  if (customTransport) return customTransport;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

const LOGO_ATTACHMENT = {
  filename: 'mesnia.png',
  path: path.join(__dirname, 'assets', 'logo.png'),
  cid: LOGO_CID
};

function send(to, { subject, html, text }) {
  return getTransporter().sendMail({
    from: `"Mesnia" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    text,
    attachments: [LOGO_ATTACHMENT],
    // A fresh id per email: without it Gmail folds successive codes into one thread
    headers: { 'X-Entity-Ref-ID': crypto.randomUUID() }
  });
}

/** @param {{ code: string, displayName?: string, validMinutes: number }} details */
const sendPasswordResetEmail = (to, details) => send(to, passwordResetEmail({ ...details, email: to }));

/** @param {{ code: string, displayName?: string, validMinutes: number }} details */
const sendEmailVerificationEmail = (to, details) => send(to, emailVerificationEmail({ ...details, email: to }));

/** @param {{ displayName?: string }} details */
const sendPasswordChangedEmail = (to, details) => send(to, passwordChangedEmail({ ...details, email: to }));

/** @param {{ displayName?: string, documents: object[] }} details */
const sendDocumentReminderEmail = (to, details) => send(to, documentReminderEmail({ ...details, email: to }));

/**
 * Sends without making the caller wait (and without revealing, by the response time, whether
 * an email was sent at all). Failures are logged.
 */
function sendInBackground(label, sending) {
  sending()
    .then(info => console.info(`[email] ${label}: accepted ${info.accepted.length}, rejected ${info.rejected.length} (${info.messageId})`))
    .catch(error => console.error(`[email] ${label} failed:`, error));
}

/** Tests replace the transport (null restores Gmail). */
function setTransport(transport) {
  customTransport = transport;
}

module.exports = {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
  sendPasswordChangedEmail,
  sendDocumentReminderEmail,
  sendInBackground,
  setTransport
};
