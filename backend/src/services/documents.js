const { GridFSBucket } = require('mongodb');
const { getDB } = require('../config/database');
const documentCrypto = require('./document-crypto');

// Household documents: metadata in "documents", files in the GridFS bucket "document_files"
// (see routes/document.routes.js), encrypted when DOCUMENTS_ENCRYPTION_KEY is set.

const bucket = () => new GridFSBucket(getDB(), { bucketName: 'document_files' });

function writeFile(buffer, filename, metadata) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(filename, { metadata });
    upload.once('error', reject);
    upload.once('finish', () => resolve(upload.id));
    upload.end(buffer);
  });
}

async function readFile(fileId) {
  const chunks = [];
  for await (const chunk of bucket().openDownloadStream(fileId)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Stores a file, encrypted when possible.
 * @returns {Promise<{ id: import('mongodb').ObjectId, encrypted: boolean }>}
 */
async function storeFile(buffer, filename, metadata) {
  const encrypted = documentCrypto.isEnabled();
  const id = await writeFile(encrypted ? documentCrypto.encrypt(buffer) : buffer, filename, metadata);
  return { id, encrypted };
}

/** The file as it was uploaded (decrypted). Files are capped at 10 MB, so memory is fine. */
async function loadFile(file) {
  const stored = await readFile(file.id);
  return file.encrypted ? documentCrypto.decrypt(stored) : stored;
}

async function deleteFile(fileId) {
  try {
    await bucket().delete(fileId);
  } catch (error) {
    // Already gone: nothing left to clean up
    console.warn(`Document file ${fileId} could not be deleted:`, error.message);
  }
}

/**
 * Deletes the matching documents and their files. Used when a household is deleted (all of
 * its documents) and when a member leaves it (their private documents, which nobody else
 * can see): sensitive papers must not stay in the database once nobody can reach them.
 */
async function deleteDocuments(query) {
  const documents = await getDB().collection('documents').find(query, { projection: { file: 1 } }).toArray();
  if (documents.length === 0) return 0;

  await getDB().collection('documents').deleteMany({ _id: { $in: documents.map(doc => doc._id) } });
  for (const doc of documents) {
    if (doc.file?.id) await deleteFile(doc.file.id);
  }
  return documents.length;
}

/** Bytes of files stored by a household (for its quota). */
async function householdStorage(householdId) {
  const [result] = await getDB().collection('documents').aggregate([
    { $match: { householdId, 'file.size': { $exists: true } } },
    { $group: { _id: null, total: { $sum: '$file.size' } } }
  ]).toArray();
  return result?.total || 0;
}

/** Files uploaded before encryption existed are encrypted at startup, once the key is set. */
async function encryptLegacyDocuments() {
  if (!documentCrypto.isEnabled()) return;
  const documents = await getDB().collection('documents')
    .find({ 'file.id': { $exists: true }, 'file.encrypted': { $ne: true } })
    .toArray();

  for (const doc of documents) {
    try {
      const clear = await readFile(doc.file.id);
      const { id } = await storeFile(clear, doc.file.name, { householdId: doc.householdId, documentId: doc._id, mimeType: doc.file.mimeType });
      await getDB().collection('documents').updateOne(
        { _id: doc._id },
        { $set: { 'file.id': id, 'file.encrypted': true } }
      );
      await deleteFile(doc.file.id);
    } catch (error) {
      console.error(`[documents] Could not encrypt the file of document ${doc._id}:`, error.message);
    }
  }
  if (documents.length > 0) console.log(`🔒 Encrypted ${documents.length} existing document file(s)`);
}

module.exports = { storeFile, loadFile, deleteFile, deleteDocuments, householdStorage, encryptLegacyDocuments };
