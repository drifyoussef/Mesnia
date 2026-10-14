import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import { HouseholdService } from './household.service';
import { DocumentInput, HouseholdDocument } from '../models/document.model';

/** Same cap as the backend */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Large enough to read the small print of a scanned page */
const PHOTO_MAX_SIDE = 2400;
const PHOTO_JPEG_QUALITY = 0.85;

/** Household documents, stored on the server and shared by every member (unless private). */
@Injectable({
  providedIn: 'root'
})
export class DocumentService {
  constructor(private api: ApiService, private householdService: HouseholdService) {}

  async getDocuments(): Promise<HouseholdDocument[]> {
    const householdId = await this.householdId();
    const response = await this.api.getAsync<{ documents: HouseholdDocument[] }>(`documents/${householdId}`);
    return response.documents || [];
  }

  async createDocument(input: DocumentInput): Promise<HouseholdDocument> {
    const householdId = await this.householdId();
    return (await this.api.postAsync<{ document: HouseholdDocument }>(`documents/${householdId}`, input)).document;
  }

  async updateDocument(documentId: string, input: DocumentInput): Promise<HouseholdDocument> {
    const householdId = await this.householdId();
    return (await this.api.putAsync<{ document: HouseholdDocument }>(`documents/${householdId}/${documentId}`, input)).document;
  }

  async deleteDocument(documentId: string): Promise<void> {
    const householdId = await this.householdId();
    await this.api.deleteAsync(`documents/${householdId}/${documentId}`);
  }

  /** Adds the file to the document, or replaces its current one. */
  async uploadFile(documentId: string, file: Blob, fileName: string): Promise<HouseholdDocument> {
    const householdId = await this.householdId();
    const endpoint = `documents/${householdId}/${documentId}/file`;
    return (await this.api.putFileAsync<{ document: HouseholdDocument }>(endpoint, file, fileName)).document;
  }

  async downloadFile(documentId: string): Promise<Blob> {
    const householdId = await this.householdId();
    return this.api.getBlobAsync(`documents/${householdId}/${documentId}/file`);
  }

  /**
   * Photos straight from the camera weigh several MB: they are shrunk to a JPEG that stays
   * readable. PDFs, and photos that would not get any lighter, are sent as they are.
   */
  async prepareFile(file: File): Promise<{ blob: Blob; name: string }> {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return { blob: file, name: file.name };

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode(); // also applies the EXIF orientation

      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY));

      if (!jpeg || jpeg.size >= file.size) return { blob: file, name: file.name };
      return { blob: jpeg, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
    } catch {
      // Format the browser cannot draw (HEIC on Android...): the server checks it anyway
      return { blob: file, name: file.name };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private async householdId(): Promise<string> {
    const household = await this.householdService.getCurrentHousehold();
    if (!household) throw new Error('Rejoins ou crée un foyer pour ranger tes documents');
    return household.id;
  }
}
