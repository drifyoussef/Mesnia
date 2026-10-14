const { GridFSBucket } = require('mongodb');
const { getDB } = require('../config/database');

// Household documents: metadata in "documents", files in the GridFS bucket "document_files"
// (see routes/document.routes.js).

const bucket = () => new GridFSBucket(getDB(), { bucketName: 'document_files' });

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

module.exports = { bucket, deleteFile, deleteDocuments };
