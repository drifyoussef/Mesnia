const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { bucket, deleteFile } = require('../services/documents');

// Household documents (ordonnances, attestations CAF, avis d'impôt...), sorted by category.
// The metadata lives in "documents", the file itself in the GridFS bucket "document_files":
// { householdId, title, category, memberId?, documentDate?, expiresAt?, notes, private,
//   file?: { id: ObjectId, name, mimeType, size, uploadedAt },
//   createdBy, createdAt, updatedAt }
// A private document is only visible to the member who added it. Any member can edit a shared
// document, but only its author or an admin of the household can delete it or replace its file.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = [
  'sante', 'caf', 'impots', 'logement', 'identite', 'banque', 'assurance', 'travail', 'vehicule', 'ecole', 'autre'
];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

router.use(authenticateUser);

// Only members of the household in the URL get in (same rule as trips / calendar / schedules)
router.use('/:householdId', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.householdId)) {
      return res.status(400).json({ error: 'Invalid household id' });
    }

    const householdId = new ObjectId(req.params.householdId);
    const [user, household] = await Promise.all([
      getDB().collection('users').findOne({ _id: new ObjectId(req.user.uid) }),
      getDB().collection('households').findOne({ _id: householdId })
    ]);
    if (!user || !household || user.householdId?.toString() !== req.params.householdId) {
      return res.status(403).json({ error: 'Access to this household is not allowed' });
    }

    req.householdId = householdId;
    req.memberIds = (household.members || []).map(member => member.userId);
    req.isAdmin = (household.members || []).some(member => member.userId === req.user.uid && member.role === 'admin');
    next();
  } catch (error) {
    console.error('Household authorization error:', error);
    res.status(500).json({ error: error.message });
  }
});

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
  const { _id, householdId, file, ...rest } = doc;
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

function storeFile(buffer, filename, metadata) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(filename, { metadata });
    upload.once('error', reject);
    upload.once('finish', () => resolve(upload.id));
    upload.end(buffer);
  });
}

async function loadDocument(req, res) {
  if (!ObjectId.isValid(req.params.documentId)) {
    res.status(404).json({ error: 'Document not found' });
    return null;
  }
  const doc = await getDB().collection('documents').findOne({ _id: new ObjectId(req.params.documentId), ...visibleTo(req) });
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return null;
  }
  return doc;
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.error(`Document route error (${req.method} ${req.originalUrl}):`, error);
      res.status(500).json({ error: error.message });
    }
  };
}

// ---------- Documents ----------

router.get('/:householdId', handle(async (req, res) => {
  const documents = await getDB().collection('documents')
    .find(visibleTo(req))
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ documents: documents.map(toClient) });
}));

router.post('/:householdId', handle(async (req, res) => {
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

router.put('/:householdId/:documentId', handle(async (req, res) => {
  const doc = await loadDocument(req, res);
  if (!doc) return;
  const { set, unset, error } = readDocument(req.body, req.memberIds);
  if (error) return res.status(400).json({ error });
  // Only its author can make a document private or shared again
  if (doc.createdBy !== req.user.uid) set.private = Boolean(doc.private);

  const result = await getDB().collection('documents').findOneAndUpdate(
    { _id: doc._id },
    { $set: { ...set, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: 'after' }
  );
  res.json({ document: toClient(result) });
}));

router.delete('/:householdId/:documentId', handle(async (req, res) => {
  const doc = await loadDocument(req, res);
  if (!doc) return;
  if (!canManage(req, doc)) return res.status(403).json({ error: NOT_ALLOWED });
  await getDB().collection('documents').deleteOne({ _id: doc._id });
  if (doc.file?.id) await deleteFile(doc.file.id);
  res.json({ message: 'Document deleted' });
}));

// ---------- File ----------

// Raw body (the file itself), not multipart: the name travels URI-encoded in X-File-Name.
// Adds the file or replaces the previous one.
router.put(
  '/:householdId/:documentId/file',
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  handle(async (req, res) => {
    const doc = await loadDocument(req, res);
    if (!doc) return;
    if (doc.file && !canManage(req, doc)) return res.status(403).json({ error: NOT_ALLOWED });

    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return res.status(400).json({ error: 'Fichier vide' });
    const mimeType = detectMimeType(buffer);
    if (!mimeType) return res.status(400).json({ error: 'Seuls les PDF et les photos sont acceptés' });

    let name = 'document';
    try {
      name = text(decodeURIComponent(req.get('X-File-Name') || ''), 200) || name;
    } catch {
      // Malformed name: keep the default
    }

    const fileId = await storeFile(buffer, name, { householdId: req.householdId, documentId: doc._id, mimeType });
    const result = await getDB().collection('documents').findOneAndUpdate(
      { _id: doc._id },
      { $set: { file: { id: fileId, name, mimeType, size: buffer.length, uploadedAt: new Date() }, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (doc.file?.id) await deleteFile(doc.file.id);
    res.json({ document: toClient(result) });
  })
);

router.get('/:householdId/:documentId/file', handle(async (req, res) => {
  const doc = await loadDocument(req, res);
  if (!doc) return;
  if (!doc.file?.id) return res.status(404).json({ error: 'Ce document n’a pas de fichier' });

  res.set({
    'Content-Type': doc.file.mimeType,
    'Content-Length': doc.file.size,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.file.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store'
  });
  bucket().openDownloadStream(doc.file.id)
    .once('error', error => {
      console.error('Document file stream error:', error);
      if (!res.headersSent) {
        res.removeHeader('Content-Length');
        res.removeHeader('Content-Disposition');
        res.status(404).json({ error: 'Fichier introuvable' });
      }
      else res.destroy(error);
    })
    .pipe(res);
}));

module.exports = router;
