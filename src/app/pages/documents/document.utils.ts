import { DOCUMENT_CATEGORIES, DocumentCategory, DocumentCategoryInfo, HouseholdDocument } from '../../models/document.model';
import { HouseholdMember } from '../../models/user.model';
import { toIsoDate } from '../../utils/date.utils';

/** A document expiring within this many days shows up in "À renouveler" */
export const EXPIRY_WARNING_DAYS = 30;

export function categoryInfo(category: DocumentCategory | string): DocumentCategoryInfo {
  return DOCUMENT_CATEGORIES.find(c => c.value === category) || DOCUMENT_CATEGORIES[DOCUMENT_CATEGORIES.length - 1];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/** "2026-03-12" -> "12 mars 2026" */
export function formatDocumentDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

/** Days until expiry (negative once expired), or null when the document never expires. */
export function daysUntilExpiry(doc: HouseholdDocument): number | null {
  if (!doc.expiresAt) return null;
  const today = new Date(toIsoDate(new Date()));
  return Math.round((new Date(doc.expiresAt).getTime() - today.getTime()) / 86400000);
}

export function needsRenewal(doc: HouseholdDocument): boolean {
  const days = daysUntilExpiry(doc);
  return days !== null && days <= EXPIRY_WARNING_DAYS;
}

/** "Expiré", "Expire aujourd'hui", "Expire dans 12 j" */
export function expiryLabel(doc: HouseholdDocument): string {
  const days = daysUntilExpiry(doc);
  if (days === null) return '';
  if (days < 0) return 'Expiré';
  if (days === 0) return "Expire aujourd'hui";
  return `Expire dans ${days} j`;
}

/** Deleting a document or replacing its file: its author or an admin only (same rule as the backend) */
export function canManageDocument(doc: HouseholdDocument, members: HouseholdMember[], currentUserId: string | null): boolean {
  if (!currentUserId) return false;
  return doc.createdBy === currentUserId || members.some(m => m.userId === currentUserId && m.role === 'admin');
}

/** Drops accents: NFD splits "é" into "e" + a combining mark, and the marks are removed */
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Accent- and case-insensitive search on the title, notes, file name and category. */
export function matchesSearch(doc: HouseholdDocument, query: string): boolean {
  const needle = normalize(query.trim());
  if (!needle) return true;
  return [doc.title, doc.notes, doc.file?.name || '', categoryInfo(doc.category).label]
    .some(field => normalize(field).includes(needle));
}
