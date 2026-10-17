// Pure functions: no database.

const { assertPublicUrl, isPublicAddress, safeFetch } = require('../src/services/recipe-import/safe-fetch');
const { mergeItems, cleanItem } = require('../src/services/shopping');
const { addPeriod, addDays } = require('../src/utils/dates');
const { passwordResetEmail } = require('../src/services/email/password-reset');
const documentCrypto = require('../src/services/document-crypto');

describe('SSRF guard', () => {
  test.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::'
  ])('%s is private', address => {
    expect(isPublicAddress(address)).toBe(false);
  });

  test.each(['8.8.8.8', '2606:4700::1111'])('%s is public', address => {
    expect(isPublicAddress(address)).toBe(true);
  });

  test.each([
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/latest/meta-data', 'http://localhost:3000/',
    'http://0x7f000001/', 'file:///etc/passwd', 'ftp://example.com/'
  ])('%s is refused', async url => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });

  test('a connection to a private address is refused even past the first check', async () => {
    const http = require('http');
    const server = http.createServer((req, res) => res.end('internal')).listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    try {
      // "localhost" resolves to a private address: refused (first check, then the connection itself)
      await expect(safeFetch(`http://localhost:${server.address().port}/`)).rejects.toThrow("Ce lien n'est pas autorisé");
    } finally {
      server.close();
    }
  });
});

describe('Shopping list merge', () => {
  test('same name and unit add up, accents and case aside', () => {
    const items = mergeItems(
      [cleanItem({ name: 'Crème', quantity: 10, unit: 'cl' })],
      [cleanItem({ name: 'creme', quantity: 20, unit: 'cl' }, { recipeName: 'Gratin' }), cleanItem({ name: 'Crème', quantity: 1, unit: 'pot' })]
    );
    expect(items).toHaveLength(2);
    expect(items[0].quantity).toBe(30);
    expect(items[0].recipeName).toBe('Gratin');
  });

  test('a checked item is not merged', () => {
    const items = mergeItems([cleanItem({ name: 'Lait', quantity: 1, unit: 'l', isChecked: true })], [cleanItem({ name: 'Lait', quantity: 1, unit: 'l' })]);
    expect(items).toHaveLength(2);
  });
});

describe('Dates', () => {
  test('monthly recurrence keeps the end of the month', () => {
    expect(addPeriod('2026-01-31', 'month')).toBe('2026-02-28');
    expect(addPeriod('2026-12-15', 'month')).toBe('2027-01-15');
    expect(addPeriod('2026-10-17', 'week')).toBe('2026-10-24');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });
});

describe('Document encryption', () => {
  test('round trip, a different output each time, tampering detected', () => {
    const clear = Buffer.from('ordonnance');
    const a = documentCrypto.encrypt(clear);
    const b = documentCrypto.encrypt(clear);
    expect(a.equals(b)).toBe(false);
    expect(documentCrypto.decrypt(a).equals(clear)).toBe(true);
    a[20] ^= 1;
    expect(() => documentCrypto.decrypt(a)).toThrow();
  });
});

describe('Emails', () => {
  test('reset email has a text version and no remote resource', () => {
    const email = passwordResetEmail({ code: '123456', displayName: 'Léa', email: 'lea@example.com', validMinutes: 15 });
    expect(email.text).toContain('123456');
    expect(email.html).toContain('cid:mesnia-logo');
    expect(email.html).not.toMatch(/https?:\/\/fonts\./);
  });
});
