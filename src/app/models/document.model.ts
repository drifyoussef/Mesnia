export type DocumentCategory =
  | 'sante' | 'caf' | 'impots' | 'logement' | 'identite' | 'banque'
  | 'assurance' | 'travail' | 'vehicule' | 'ecole' | 'autre';

export interface DocumentCategoryInfo {
  value: DocumentCategory;
  label: string;
  icon: string;
  /** What goes in it, shown under the name */
  hint: string;
  color: string;
}

export const DOCUMENT_CATEGORIES: DocumentCategoryInfo[] = [
  { value: 'sante', label: 'Santé', icon: 'medkit', hint: 'Ordonnances, carte Vitale, mutuelle, vaccins', color: '#E39AA6' },
  { value: 'caf', label: 'CAF & aides', icon: 'people', hint: 'Attestations, quotient familial', color: '#6FA8DC' },
  { value: 'impots', label: 'Impôts', icon: 'receipt', hint: "Avis d'imposition, déclarations", color: '#B8A9D9' },
  { value: 'logement', label: 'Logement', icon: 'home', hint: 'Bail, quittances, énergie, internet', color: '#74B39D' },
  { value: 'identite', label: 'Identité', icon: 'id-card', hint: 'Carte d’identité, passeport, permis, livret de famille', color: '#E0A77F' },
  { value: 'banque', label: 'Banque', icon: 'card', hint: 'RIB, relevés, prêts', color: '#5C9EA6' },
  { value: 'assurance', label: 'Assurances', icon: 'shield-checkmark', hint: 'Habitation, auto, responsabilité civile', color: '#7A68B0' },
  { value: 'travail', label: 'Travail', icon: 'briefcase', hint: 'Contrats, fiches de paie, France Travail', color: '#9FB5AC' },
  { value: 'vehicule', label: 'Véhicule', icon: 'car-sport', hint: 'Carte grise, contrôle technique, entretien', color: '#516B62' },
  { value: 'ecole', label: 'École', icon: 'school', hint: 'Certificats de scolarité, cantine, activités', color: '#F7C873' },
  { value: 'autre', label: 'Autres', icon: 'folder-open', hint: 'Tout le reste', color: '#A0A8A4' },
];

export interface DocumentFile {
  name: string;
  mimeType: string;
  /** Bytes */
  size: number;
  uploadedAt: string;
}

export interface HouseholdDocument {
  id: string;
  householdId: string;
  title: string;
  category: DocumentCategory;
  /** userId of the member it is about; absent when it concerns the whole household */
  memberId?: string;
  documentDate?: string; // YYYY-MM-DD
  expiresAt?: string;    // YYYY-MM-DD
  notes: string;
  /** Only visible to the member who added it */
  private: boolean;
  file?: DocumentFile;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentInput {
  title: string;
  category: DocumentCategory;
  memberId?: string;
  documentDate?: string;
  expiresAt?: string;
  notes: string;
  private: boolean;
}
