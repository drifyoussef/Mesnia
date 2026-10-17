const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { requireHouseholdMember } = require('../middleware/household.middleware');
const { storeFile, loadFile, deleteFile, householdStorage } = require('../services/documents');
const { handle } = require('../utils/handle');

// Household documents (ordonnances, attestations CAF, avis d'impôt...), sorted by category.
// The metadata lives in "documents", the file itself (encrypted) in the GridFS bucket "document_files":
// { householdId, title, category, memberId?, documentDate?, expiresAt?, notes, private,
//   file?: { id: ObjectId, name, mimeType, size, uploadedAt, encrypted },
//   reminders?: { 30?: Date, 7?: Date, 0?: Date },   // expiry reminders already sent
//   createdBy, createdAt, updatedAt }
// A private document is only visible to the member who added it. Any member can edit a shared
// document, but only its author or an admin of the household can delete it or replace its file.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = [
  'sante', 'caf', 'impots', 'logement', 'identite', 'banque', 'assurance', 'travail', 'vehicule', 'ecole', 'autre'
];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const HOUSEHOLD_QUOTA_BYTES = 500 * 1024 * 1024;

router.use(authenticateUser);
router.use('/:householdId', requireHouseholdMember);

// ---------- Helpers ----------

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Deleting a document, or replacing its file, destroys it for everyone: author or admin only */
const canManage = (req, doc) => doc.createdBy === req.user.uid || req.isAdmin;
const NOT_ALLOWED = 'Seuls la personne qui a ajouté ce document et les admins du foyer peuvent faire ça';

/** Documents of the household this member may see: shared ones and their own private ones. */
function visibleTo(req) {
  return { householdId: req.householdId, $or: [{ private: { $ne: true } }, { createdBy: req.user.uid }] };
}

function toClient(doc) {
  const { _id, householdId, file, reminders, ...rest } = doc;
  return {
    ...rest,
    id: _id.toString(),
    householdId: householdId.toString(),
    private: Boolean(doc.private),
    ...(file ? { file: { name: file.name, mimeType: file.mimeType, size: file.size, uploadedAt: file.uploadedAt } } : {})
  };
}

function readDocument(body, memberIds) {
  const title = text(body?.title, 120);
  if (!title) return { error: 'Donne un nom à ce document' };
  if (!CATEGORIES.includes(body.category)) return { error: 'Choisis une catégorie' };
  for (const field of ['documentDate', 'expiresAt']) {
    if (body[field] && !DATE_PATTERN.test(body[field])) return { error: 'Date invalide' };
  }

  const set = {
    title,
    category: body.category,
    notes: text(body.notes, 3000),
    private: body.private === true
  };
  // Optional fields: an empty value removes them on update
  const unset = {};
  if (memberIds.includes(body.memberId)) set.memberId = body.memberId; else unset.memberId = '';
  if (body.documentDate) set.documentDate = body.documentDate; else unset.documentDate = '';
  if (body.expiresAt) set.expiresAt = body.expiresAt; else unset.expiresAt = '';
  return { set, unset };
}

/**
 * The file type comes from its first bytes, not from what the client claims: only PDFs and
 * photos are accepted, and nothing a browser could run (HTML, SVG...) is ever served back.
 */
function detectMimeType(buffer) {
  const ascii = (start, end) => buffer.subarray(start, end).toString('latin1');
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'heif'].includes(ascii(8, 12))) return 'image/heic';
  return null;
}

async function loadDocument(req, res) {
  if (!ObjectId.isValid(req.params.documentId)) {
    res.status(404).json({ error: 'Document introuvable' });
    return null;
  }
  const doc = await getDB().collection('documents').findOne({ _id: new ObjectId(req.params.documentId), ...visibleTo(req) });
  if (!doc) {
    res.status(404).json({ error: 'Document introuvable' });
    return null;
  }
  return doc;
}

// ---------- Documents ----------

router.get('/:householdId', handle('documents', async (req, res) => {
  const documents = await getDB().collection('documents')
    .find(visibleTo(req))
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ documents: documents.map(toClient) });
}));

router.post('/:householdId', handle('documents', async (req, res) => {
  const { set, error } = readDocument(req.body, req.memberIds);
  if (error) return res.status(400).json({ error });

  const doc = {
    ...set,
    householdId: req.householdId,
    createdBy: req.user.uid,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const result = await getDB().collection('documents').insertOne(doc);
  doc._id = result.insertedId;
  res.status(201).json({ document: toClient(doc) });
}));

router.put('/:householdId/:documentId', handle('documents', async (req, res) => {
  const doc = await loadDocument(req, res);
  if (!doc) return;
  const { set, unset, error } = readDocument(req.body, req.memberIds);
  if (error) return res.status(400).json({ error });
  // Only its author can make a document private or shared again
  if (doc.createdBy !== req.user.uid) set.private = Boolean(doc.private);
  // New expiry date: its reminders start over
  if ((set.expiresAt || null) !== (doc.expiresAt || null)) unset.reminders = '';

  const result = await getDB().collection('documents').findOneAndUpdate(
    { _id: doc._id },
    { $set: { ...set, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: 'after' }
  );
  res.json({ document: toClient(result) });
}));

router.delete('/:householdId/:documentId', handle('documents', async (req, res) => {
  const doc = await loadDocument(req, res);
  if (!doc) return;
  if (!canManage(req, doc)) return res.status(403).json({ error: NOT_ALLOWED });
  await getDB().collection('documents').deleteOne({ _id: doc._id });
  if (doc.file?.id) await deleteFile(doc.file.id);
  res.json({ message: 'Document supprimé' });
}));

// ---------- File ----------

// Raw body (the file itself), not multipart: the name travels URI-encoded in X-File-Name.
// Adds the file or replaces the previous one.
router.put(
  '/:householdId/:documentId/file',
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  handle('documents', async (req, res) => {
    const doc = await loadDocument(req, res);
    if (!doc) return;
    if (doc.file && !canManage(req, doc)) return res.status(403).json({ error: NOT_ALLOWED });

    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return res.status(400).json({ error: 'Fichier vide' });
    const mimeType = detectMimeType(buffer);
    if (!mimeType) return res.status(400).json({ error: 'Seuls les PDF et les photos sont acceptés' });

    const used = await householdStorage(req.householdId) - (doc.file?.size || 0);
    if (used + buffer.length > HOUSEHOLD_QUOTA_BYTES) {
      return res.status(413).json({ error: 'Espace de stockage du foyer plein (500 Mo) : supprime des documents pour en ajouter' });
    }

    let name = 'document';
    try {
      name = text(decodeURIComponent(req.get('X-File-Name') || ''), 200) || name;
    } catch {
      // Malformed name: keep the default
    }

    const { id, encrypted } = await storeFile(buffer, name, { householdId: req.householdId, documentId: doc._id, mimeType });
    const result = await getDB().collection('documents').findOneAndUpdate(
      { _id: doc._id },
      { $set: { file: { id, name, mimeType, size: buffer.length, uploadedAt: new Date(), encrypted }, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (doc.file?.id) await deleteFile(doc.file.id);
    res.json({ document: toClient(result) });
  })
);

router.get('/:householdId/:documentId/file', handle('documents', async (req, res) => {
  const doc = await loadDocument(req, res);
  if (!doc) return;
  if (!doc.file?.id) return res.status(404).json({ error: 'Ce document n’a pas de fichier' });

  let content;
  try {
    content = await loadFile(doc.file);
  } catch (error) {
    console.error(`Document file ${doc.file.id} could not be read:`, error.message);
    return res.status(404).json({ error: 'Fichier introuvable' });
  }

  res.set({
    'Content-Type': doc.file.mimeType,
    'Content-Length': content.length,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.file.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    // A PDF may embed scripts: opened directly, it runs with no rights at all
    'Content-Security-Policy': 'sandbox'
  });
  res.end(content);
}));

module.exports = router;
