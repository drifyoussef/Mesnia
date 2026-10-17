// Shared look of every email Mesnia sends. Email clients (Gmail, Outlook, Apple Mail...) only
// render a small subset of HTML/CSS reliably: tables for the layout, inline styles, no SVG,
// so everything here stays deliberately old-school. The logo is attached inline (cid:).

const LOGO_CID = 'mesnia-logo';

const COLORS = {
  page: '#EEF4F1',
  card: '#FFFFFF',
  border: '#E1EBE6',
  brand: '#74B39D',
  brandDark: '#3F7A66',
  brandSoft: '#F1F7F4',
  text: '#2D2D2D',
  muted: '#6B7280',
  faint: '#9CA3AF'
};

const FONT = "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/** Every user-provided value (name, email...) goes through this before landing in the HTML. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Building blocks (they take HTML: escape user values first) ----------

const paragraph = html =>
  `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:26px;color:${COLORS.text}">${html}</p>`;

const smallText = html =>
  `<p class="muted" style="margin:0 0 12px;font-family:${FONT};font-size:14px;line-height:22px;color:${COLORS.muted}">${html}</p>`;

/** The one-time code, big enough to read at a glance and copy without stray spaces. */
function codeBlock(code) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-collapse:separate">
      <tr>
        <td align="center" class="code-box" style="background:${COLORS.brandSoft};border:1px solid #D3E5DD;border-radius:14px;padding:22px 12px">
          <div style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.brandDark};margin:0 0 8px">Votre code</div>
          <div class="code" style="font-family:${MONO};font-size:36px;line-height:44px;font-weight:700;letter-spacing:10px;padding-left:10px;color:${COLORS.text}">${escapeHtml(code)}</div>
        </td>
      </tr>
    </table>`;
}

/** Highlighted box for security advice ("you didn't ask for this?"). */
function noticeBox(title, html) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;border-collapse:separate">
      <tr>
        <td class="notice" style="background:#FAFAF9;border-left:4px solid ${COLORS.brand};border-radius:8px;padding:16px 18px">
          <p style="margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:700;color:${COLORS.text}">${title}</p>
          <p class="muted" style="margin:0;font-family:${FONT};font-size:14px;line-height:22px;color:${COLORS.muted}">${html}</p>
        </td>
      </tr>
    </table>`;
}

// ---------- Page ----------

/**
 * @param {object} options
 * @param {string} options.title      <title> and main heading (plain text)
 * @param {string} options.preheader  preview line shown next to the subject in the inbox (plain text)
 * @param {string} options.content    body HTML, made of the blocks above
 * @param {string} options.footer     footer HTML (why this email was received)
 */
function renderLayout({ title, preheader, content, footer }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <title>${escapeHtml(title)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; border-collapse:collapse; }
    img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
    a { color:${COLORS.brandDark}; }
    @media only screen and (max-width:620px) {
      .container { width:100% !important; }
      .card-pad { padding:28px 22px !important; }
      .code { font-size:30px !important; letter-spacing:7px !important; padding-left:7px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .page-bg { background:#111816 !important; }
      .card { background:#1B2421 !important; border-color:#2A3632 !important; }
      .card h1, .card p, .card div, .card td { color:#E8EFEC !important; }
      .card .muted, .footer p { color:#9DB0A8 !important; }
      .code-box { background:#22302B !important; border-color:#33453E !important; }
      .notice { background:#202A27 !important; }
    }
  </style>
</head>
<body class="page-bg" style="margin:0;padding:0;background:${COLORS.page}">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.page}">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page-bg" style="background:${COLORS.page}">
    <tr>
      <td align="center" style="padding:32px 12px">
        <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" class="container" style="width:560px;max-width:560px;border-collapse:separate">
          <tr>
            <td align="center" style="padding:0 0 24px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle">
                    <img src="cid:${LOGO_CID}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:10px">
                  </td>
                  <td style="vertical-align:middle;font-family:${FONT};font-size:22px;line-height:28px;font-weight:800;color:${COLORS.brandDark};letter-spacing:-0.3px">Mesnia</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="card card-pad" style="background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:18px;padding:40px 40px 36px">
              <h1 style="margin:0 0 20px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:800;color:${COLORS.text}">${escapeHtml(title)}</h1>
              ${content}
            </td>
          </tr>
          <tr>
            <td class="footer" align="center" style="padding:24px 24px 0">
              <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.faint}">${footer}</p>
              <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.faint}">© ${year} Mesnia · Email automatique, merci de ne pas y répondre.</p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderLayout, paragraph, smallText, codeBlock, noticeBox, escapeHtml, LOGO_CID, COLORS };
