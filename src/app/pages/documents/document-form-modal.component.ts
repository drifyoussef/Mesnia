import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButton, IonButtons, IonIcon, IonSpinner, IonToggle, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  close, camera, documentAttachOutline, documentTextOutline, imageOutline, swapHorizontal, lockClosedOutline,
  medkit, people, receipt, home, idCard, card, shieldCheckmark, briefcase, carSport, school, folderOpen
} from 'ionicons/icons';
import { HouseholdMember } from '../../models/user.model';
import { DOCUMENT_CATEGORIES, DocumentCategory, DocumentInput, HouseholdDocument } from '../../models/document.model';
import { DocumentService, DOCUMENT_MAX_BYTES } from '../../services/document.service';
import { memberColor, memberInitial } from '../../utils/member.utils';
import { canManageDocument, formatFileSize } from './document.utils';

/**
 * Add a document, or edit one when `document` is given. Saves it (file included) itself,
 * then dismisses with `{ document: HouseholdDocument }`.
 */
@Component({
  selector: 'app-document-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonHeader, IonToolbar, IonTitle, IonButton, IonButtons, IonIcon, IonSpinner, IonToggle],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>{{ document ? 'Modifier le document' : 'Nouveau document' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" (click)="dismiss()" [disabled]="saving" aria-label="Fermer">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <div class="sheet-body ion-content-scroll-host">
      <input #photoInput class="file-input" type="file" accept="image/*" capture="environment" (change)="onFileSelected($event)" />
      <input #fileInput class="file-input" type="file" accept="application/pdf,image/*" (change)="onFileSelected($event)" />

      <section class="form-group">
        <h3 class="form-group-title">Fichier</h3>
        @if (file || document?.file) {
          <div class="file-card">
            <span class="file-icon">
              <ion-icon [name]="isPdf ? 'document-text-outline' : 'image-outline'"></ion-icon>
            </span>
            <span class="file-text">
              <span class="file-name">{{ file?.name || document?.file?.name }}</span>
              <span class="file-size">{{ file ? formatFileSize(file.size) + ' · nouveau' : formatFileSize(document?.file?.size || 0) }}</span>
            </span>
            @if (canReplaceFile) {
              <button class="file-replace" (click)="fileInput.click()" aria-label="Remplacer le fichier">
                <ion-icon name="swap-horizontal"></ion-icon>
              </button>
            }
          </div>
        } @else {
          <div class="pick-row">
            <button class="pick-btn" (click)="photoInput.click()">
              <ion-icon name="camera"></ion-icon>
              Photographier
            </button>
            <button class="pick-btn" (click)="fileInput.click()">
              <ion-icon name="document-attach-outline"></ion-icon>
              PDF ou image
            </button>
          </div>
          <p class="hint">Facultatif : tu peux aussi juste noter un numéro (allocataire, sécu...).</p>
        }
      </section>

      <section class="form-group">
        <h3 class="form-group-title">Document</h3>
        <input class="form-input" type="text" [(ngModel)]="title" placeholder="Ex : Attestation CAF, Ordonnance Dr Martin" maxlength="120" aria-label="Nom du document" />
      </section>

      <section class="form-group">
        <h3 class="form-group-title">Catégorie</h3>
        <div class="categories">
          @for (option of categories; track option.value) {
            <button
              class="category"
              [class.selected]="category === option.value"
              [style.--category-color]="option.color"
              (click)="category = option.value"
              [attr.aria-pressed]="category === option.value"
            >
              <ion-icon [name]="option.icon"></ion-icon>
              <span>{{ option.label }}</span>
            </button>
          }
        </div>
      </section>

      @if (members.length > 1) {
        <section class="form-group">
          <h3 class="form-group-title">Concerne</h3>
          <div class="chips">
            <button class="chip" [class.selected]="!memberId" (click)="memberId = ''">
              <span class="chip-avatar household"><ion-icon name="home"></ion-icon></span>
              Tout le foyer
            </button>
            @for (member of members; track member.userId) {
              <button class="chip" [class.selected]="memberId === member.userId" (click)="memberId = member.userId">
                <span class="chip-avatar" [style.background]="color(member.displayName)">{{ initial(member.displayName) }}</span>
                {{ member.displayName }}
              </button>
            }
          </div>
        </section>
      }

      <section class="form-group">
        <h3 class="form-group-title">Dates</h3>
        <div class="date-row">
          <label class="date-field">
            <span>Date du document</span>
            <input type="date" [(ngModel)]="documentDate" />
          </label>
          <label class="date-field">
            <span>Expire le</span>
            <input type="date" [(ngModel)]="expiresAt" />
          </label>
        </div>
      </section>

      <section class="form-group">
        <h3 class="form-group-title">Notes</h3>
        <textarea class="form-input" rows="3" [(ngModel)]="notes" placeholder="N° allocataire, médecin, montant..." maxlength="3000" aria-label="Notes"></textarea>
      </section>

      @if (canChangePrivacy) {
        <div class="settings-card private-card">
          <div class="settings-row">
            <span class="settings-row-icon"><ion-icon name="lock-closed-outline"></ion-icon></span>
            <span class="settings-row-label">
              Privé
              <span class="private-hint">Visible uniquement par toi</span>
            </span>
            <ion-toggle [(ngModel)]="isPrivate" aria-label="Document privé"></ion-toggle>
          </div>
        </div>
      }

      @if (error) {
        <p class="form-error">{{ error }}</p>
      }

      <button class="primary-btn" (click)="save()" [disabled]="saving">
        @if (saving) {
          <ion-spinner name="crescent"></ion-spinner>
        } @else {
          {{ document ? 'Enregistrer' : 'Ajouter le document' }}
        }
      </button>
    </div>
  `,
  styles: [`
    .file-input { display: none; }

    .form-group { margin-bottom: 22px; }

    .form-group-title {
      margin: 0 0 10px 2px;
      font-size: var(--text-sm);
      font-weight: 700;
      color: var(--ion-color-dark-tint);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .pick-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .pick-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 16px 8px;
      border: 1.5px dashed var(--tile-icon-light);
      border-radius: var(--radius-xl);
      background: var(--tile-bg);
      color: var(--tile-icon-dark);
      font: inherit;
      font-size: var(--text-sm);
      font-weight: 700;
      cursor: pointer;
    }

    .pick-btn ion-icon { font-size: 26px; }
    .pick-btn:active { transform: scale(0.98); }

    .hint {
      margin: 8px 2px 0;
      font-size: 12px;
      color: var(--ion-color-medium-shade);
    }

    .file-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 10px 10px 12px;
      border-radius: var(--radius-xl);
      background: #FFFFFF;
      box-shadow: var(--shadow-base);
    }

    .file-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      border-radius: 10px;
      background: var(--tile-bg);
      color: var(--tile-icon);
      font-size: 20px;
    }

    .file-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .file-name {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-size {
      font-size: 12px;
      color: var(--ion-color-medium-shade);
    }

    .file-replace {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: var(--ion-color-light);
      color: var(--ion-text-color);
      font-size: 18px;
      cursor: pointer;
    }

    .categories {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }

    .category {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      min-width: 0;
      padding: 10px 4px;
      border: 1.5px solid transparent;
      border-radius: var(--radius-xl);
      background: #FFFFFF;
      box-shadow: var(--shadow-base);
      color: var(--ion-text-color);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .category ion-icon {
      font-size: 22px;
      color: var(--category-color);
    }

    .category span {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .category.selected {
      border-color: var(--category-color);
      background: color-mix(in srgb, var(--category-color) 12%, #FFFFFF);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px 6px 6px;
      border: 1px solid var(--ion-border-color);
      border-radius: var(--radius-full);
      background: #FFFFFF;
      color: var(--ion-text-color);
      font: inherit;
      font-size: var(--text-sm);
      font-weight: 600;
      cursor: pointer;
      opacity: 0.6;
    }

    .chip.selected {
      border-color: var(--tile-icon);
      background: var(--tile-bg);
      opacity: 1;
    }

    .chip-avatar {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      color: #FFFFFF;
      font-size: 11px;
      font-weight: 700;
    }

    .chip-avatar.household {
      background: var(--tile-icon);
      font-size: 13px;
    }

    .date-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .date-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      padding: 10px 16px;
      border-radius: var(--radius-xl);
      background: #FFFFFF;
      box-shadow: var(--shadow-base);
    }

    .date-field span {
      font-size: 12px;
      font-weight: 600;
      color: var(--ion-color-medium-shade);
    }

    .date-field input {
      width: 100%;
      min-width: 0;
      border: none;
      outline: none;
      background: transparent;
      font: inherit;
      font-size: var(--text-base);
      font-weight: 700;
      color: var(--ion-text-color);
    }

    .private-card { margin-bottom: 22px; }

    .private-hint {
      display: block;
      font-size: 12px;
      color: var(--ion-color-medium-shade);
    }

    .form-error {
      margin: 0 0 14px;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(var(--ion-color-danger-rgb), 0.1);
      color: var(--ion-color-danger);
      font-size: var(--text-sm);
    }

    .primary-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 54px;
      margin: 8px 0 24px;
      padding: 16px;
      border: none;
      border-radius: var(--radius-xl);
      background: linear-gradient(145deg, var(--tile-icon-light), var(--tile-icon));
      box-shadow: var(--shadow-base);
      color: #FFFFFF;
      font: inherit;
      font-size: var(--text-base);
      font-weight: 700;
      cursor: pointer;
    }

    .primary-btn ion-spinner { --color: #FFFFFF; width: 22px; height: 22px; }
    .primary-btn:active { transform: scale(0.98); }
  `]
})
export class DocumentFormModalComponent implements OnInit {
  @Input() document?: HouseholdDocument;
  @Input() members: HouseholdMember[] = [];
  @Input() currentUserId: string | null = null;
  /** Preselected category when adding from a category page */
  @Input() initialCategory?: DocumentCategory;

  readonly categories = DOCUMENT_CATEGORIES;
  readonly formatFileSize = formatFileSize;

  title = '';
  category: DocumentCategory = 'autre';
  memberId = '';
  documentDate = '';
  expiresAt = '';
  notes = '';
  isPrivate = false;
  /** New file to send (already shrunk if it was a photo) */
  file: { blob: Blob; name: string; size: number } | null = null;

  error = '';
  saving = false;

  constructor(private modalController: ModalController, private documentService: DocumentService) {
    addIcons({
      close, camera, documentAttachOutline, documentTextOutline, imageOutline, swapHorizontal, lockClosedOutline,
      medkit, people, receipt, home, idCard, card, shieldCheckmark, briefcase, carSport, school, folderOpen
    });
  }

  ngOnInit() {
    if (this.document) {
      this.title = this.document.title;
      this.category = this.document.category;
      this.memberId = this.document.memberId || '';
      this.documentDate = this.document.documentDate || '';
      this.expiresAt = this.document.expiresAt || '';
      this.notes = this.document.notes;
      this.isPrivate = this.document.private;
    } else if (this.initialCategory) {
      this.category = this.initialCategory;
    }
  }

  /** Only the author decides who sees a document */
  get canChangePrivacy(): boolean {
    return !this.document || this.document.createdBy === this.currentUserId;
  }

  /** Replacing the file destroys the current one: its author or an admin only */
  get canReplaceFile(): boolean {
    return !this.document?.file || canManageDocument(this.document, this.members, this.currentUserId);
  }

  get isPdf(): boolean {
    const type = this.file ? this.file.blob.type : this.document?.file?.mimeType;
    return type === 'application/pdf';
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0];
    input.value = ''; // picking the same file again must fire (change) again
    if (!picked) return;

    this.error = '';
    const prepared = await this.documentService.prepareFile(picked);
    if (prepared.blob.size > DOCUMENT_MAX_BYTES) {
      this.error = `Fichier trop lourd (${formatFileSize(prepared.blob.size)}, 10 Mo max)`;
      return;
    }
    this.file = { ...prepared, size: prepared.blob.size };
    if (!this.title.trim()) {
      this.title = picked.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120);
    }
  }

  color(name: string): string {
    return memberColor(name);
  }

  initial(name: string): string {
    return memberInitial(name);
  }

  async save() {
    if (this.saving) return;
    if (!this.title.trim()) {
      this.error = 'Donne un nom à ce document';
      return;
    }

    const input: DocumentInput = {
      title: this.title.trim(),
      category: this.category,
      memberId: this.memberId || undefined,
      documentDate: this.documentDate || undefined,
      expiresAt: this.expiresAt || undefined,
      notes: this.notes.trim(),
      private: this.isPrivate
    };

    this.saving = true;
    this.error = '';
    let created: HouseholdDocument | null = null;
    try {
      let saved: HouseholdDocument;
      if (this.document) {
        saved = await this.documentService.updateDocument(this.document.id, input);
      } else {
        saved = created = await this.documentService.createDocument(input);
      }
      if (this.file) {
        saved = await this.documentService.uploadFile(saved.id, this.file.blob, this.file.name);
      }
      this.modalController.dismiss({ document: saved });
    } catch (error) {
      console.error('Error saving document:', error);
      // A new document whose file could not be sent is removed: no half-saved document left behind
      if (created) await this.documentService.deleteDocument(created.id).catch(() => undefined);
      this.error = (error as Error).message || "Impossible d'enregistrer le document";
    } finally {
      this.saving = false;
    }
  }

  dismiss() {
    this.modalController.dismiss();
  }
}
