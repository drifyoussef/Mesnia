import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons, IonIcon, IonSpinner,
  AlertController, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  close, createOutline, trashOutline, downloadOutline, openOutline, personOutline, calendarOutline,
  hourglassOutline, attachOutline, lockClosedOutline, documentTextOutline, alertCircleOutline, home,
  medkit, people, receipt, idCard, card, shieldCheckmark, briefcase, carSport, school, folderOpen
} from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { HouseholdDocument } from '../../models/document.model';
import { HouseholdMember } from '../../models/user.model';
import { DocumentService } from '../../services/document.service';
import { ToastService } from '../../services/toast.service';
import { DocumentFormModalComponent } from './document-form-modal.component';
import { canManageDocument, categoryInfo, daysUntilExpiry, expiryLabel, formatDocumentDate, formatFileSize, needsRenewal } from './document.utils';

/** Shows a document and its file. Dismisses with `{ changed: true }` after an edit or a deletion. */
@Component({
  selector: 'app-document-viewer-modal',
  standalone: true,
  imports: [CommonModule, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons, IonIcon, IonSpinner],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button fill="clear" (click)="dismiss()" aria-label="Fermer">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ document.title }}</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" (click)="edit()" aria-label="Modifier">
            <ion-icon slot="icon-only" name="create-outline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (document.file) {
        <div class="preview" [class.pdf]="isPdf">
          @if (loadingFile) {
            <ion-spinner name="crescent"></ion-spinner>
          } @else if (fileError) {
            <div class="preview-message">
              <ion-icon name="alert-circle-outline"></ion-icon>
              <span>{{ fileError }}</span>
            </div>
          } @else if (isPdf && pdfUrl && canEmbedPdf) {
            <iframe [src]="pdfUrl" title="Aperçu du document"></iframe>
          } @else if (isPdf) {
            <button class="preview-message" (click)="open()">
              <ion-icon name="document-text-outline"></ion-icon>
              <span>{{ document.file.name }}</span>
              <span class="preview-action">Ouvrir le PDF</span>
            </button>
          } @else if (objectUrl) {
            <img [src]="objectUrl" [alt]="document.title" />
          }
        </div>

        <div class="actions">
          <button class="action-btn" (click)="open()" [disabled]="!objectUrl">
            <ion-icon name="open-outline"></ion-icon>
            Ouvrir
          </button>
          <button class="action-btn" (click)="download()" [disabled]="!objectUrl">
            <ion-icon name="download-outline"></ion-icon>
            Télécharger
          </button>
        </div>
      }

      <div class="settings-card info-card">
        <div class="settings-row">
          <span class="settings-row-icon" [style.background]="tint" [style.color]="category.color">
            <ion-icon [name]="category.icon"></ion-icon>
          </span>
          <span class="settings-row-label">{{ category.label }}</span>
        </div>
        <div class="settings-row">
          <span class="settings-row-icon"><ion-icon [name]="member ? 'person-outline' : 'home'"></ion-icon></span>
          <span class="settings-row-label">{{ member?.displayName || 'Tout le foyer' }}</span>
        </div>
        @if (document.documentDate) {
          <div class="settings-row">
            <span class="settings-row-icon"><ion-icon name="calendar-outline"></ion-icon></span>
            <span class="settings-row-label">Daté du {{ formatDocumentDate(document.documentDate) }}</span>
          </div>
        }
        @if (document.expiresAt) {
          <div class="settings-row">
            <span class="settings-row-icon"><ion-icon name="hourglass-outline"></ion-icon></span>
            <span class="settings-row-label">Expire le {{ formatDocumentDate(document.expiresAt) }}</span>
            @if (renewal) {
              <span class="expiry" [class.expired]="expired">{{ expiry }}</span>
            }
          </div>
        }
        @if (document.file) {
          <div class="settings-row">
            <span class="settings-row-icon"><ion-icon name="attach-outline"></ion-icon></span>
            <span class="settings-row-label file-label">{{ document.file.name }}</span>
            <span class="row-value">{{ formatFileSize(document.file.size) }}</span>
          </div>
        }
        @if (document.private) {
          <div class="settings-row">
            <span class="settings-row-icon"><ion-icon name="lock-closed-outline"></ion-icon></span>
            <span class="settings-row-label">Privé, visible uniquement par toi</span>
          </div>
        }
      </div>

      @if (document.notes) {
        <section class="settings-section">
          <h2 class="settings-section-title">Notes</h2>
          <p class="notes">{{ document.notes }}</p>
        </section>
      }

      <p class="added-by">Ajouté {{ author ? 'par ' + author + ' ' : '' }}le {{ formatDocumentDate(document.createdAt.slice(0, 10)) }}</p>

      @if (canManage) {
        <button class="delete-btn" (click)="remove()">
          <ion-icon name="trash-outline"></ion-icon>
          Supprimer le document
        </button>
      }
    </ion-content>
  `,
  styles: [`
    .preview {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 180px;
      margin-bottom: 12px;
      border-radius: var(--radius-2xl);
      overflow: hidden;
      background: #FFFFFF;
      box-shadow: var(--shadow-base);
    }

    .preview.pdf { min-height: 0; }

    .preview img {
      display: block;
      width: 100%;
      max-height: 60vh;
      object-fit: contain;
      background: var(--ion-color-light);
    }

    .preview iframe {
      display: block;
      width: 100%;
      height: 60vh;
      border: none;
    }

    .preview ion-spinner { --color: var(--tile-icon); margin: 48px 0; }

    .preview-message {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 28px 16px;
      border: none;
      background: transparent;
      color: var(--ion-color-dark-tint);
      font: inherit;
      font-size: var(--text-sm);
      text-align: center;
      word-break: break-word;
    }

    .preview-message ion-icon { font-size: 36px; color: var(--tile-icon); }

    .preview-action {
      margin-top: 4px;
      font-weight: 700;
      color: var(--tile-icon-dark);
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 20px;
    }

    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 46px;
      border: none;
      border-radius: var(--radius-xl);
      background: var(--tile-bg);
      color: var(--tile-icon-dark);
      font: inherit;
      font-size: var(--text-sm);
      font-weight: 700;
      cursor: pointer;
    }

    .action-btn ion-icon { font-size: 18px; }
    .action-btn:disabled { opacity: 0.5; }

    .info-card { margin-bottom: 24px; }

    .file-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-value {
      flex-shrink: 0;
      font-size: var(--text-sm);
      color: var(--ion-color-medium-shade);
    }

    .expiry {
      flex-shrink: 0;
      padding: 3px 8px;
      border-radius: var(--radius-full);
      background: rgba(var(--ion-color-warning-rgb), 0.18);
      color: var(--ion-color-warning-shade);
      font-size: 11px;
      font-weight: 700;
    }

    .expiry.expired {
      background: rgba(var(--ion-color-danger-rgb), 0.12);
      color: var(--ion-color-danger);
    }

    .notes {
      margin: 0;
      padding: 14px 16px;
      border-radius: var(--radius-xl);
      background: #FFFFFF;
      box-shadow: var(--shadow-base);
      white-space: pre-wrap;
      line-height: 1.45;
    }

    .added-by {
      margin: 0 0 16px;
      font-size: 12px;
      color: var(--ion-color-medium-shade);
      text-align: center;
    }

    .delete-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      min-height: 50px;
      margin-bottom: 24px;
      border: none;
      border-radius: var(--radius-xl);
      background: rgba(var(--ion-color-danger-rgb), 0.08);
      color: var(--ion-color-danger);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
  `]
})
export class DocumentViewerModalComponent implements OnInit, OnDestroy {
  @Input({ required: true }) document!: HouseholdDocument;
  @Input() members: HouseholdMember[] = [];
  @Input() currentUserId: string | null = null;

  readonly formatDocumentDate = formatDocumentDate;
  readonly formatFileSize = formatFileSize;
  /** The Android WebView cannot draw a PDF inside the page: it gets an "open" button instead */
  readonly canEmbedPdf = Capacitor.getPlatform() !== 'android';

  objectUrl: string | null = null;
  pdfUrl: SafeResourceUrl | null = null;
  loadingFile = false;
  fileError = '';

  private changed = false;

  constructor(
    private documentService: DocumentService,
    private toastService: ToastService,
    private modalController: ModalController,
    private alertController: AlertController,
    private sanitizer: DomSanitizer
  ) {
    addIcons({
      close, createOutline, trashOutline, downloadOutline, openOutline, personOutline, calendarOutline,
      hourglassOutline, attachOutline, lockClosedOutline, documentTextOutline, alertCircleOutline, home,
      medkit, people, receipt, idCard, card, shieldCheckmark, briefcase, carSport, school, folderOpen
    });
  }

  ngOnInit() {
    this.loadFile();
  }

  ngOnDestroy() {
    this.releaseFile();
  }

  get category() {
    return categoryInfo(this.document.category);
  }

  get tint(): string {
    return `color-mix(in srgb, ${this.category.color} 16%, #FFFFFF)`;
  }

  get member(): HouseholdMember | undefined {
    return this.members.find(m => m.userId === this.document.memberId);
  }

  get author(): string {
    if (this.document.createdBy === this.currentUserId) return 'toi';
    return this.members.find(m => m.userId === this.document.createdBy)?.displayName || '';
  }

  get isPdf(): boolean {
    return this.document.file?.mimeType === 'application/pdf';
  }

  get canManage(): boolean {
    return canManageDocument(this.document, this.members, this.currentUserId);
  }

  get renewal(): boolean {
    return needsRenewal(this.document);
  }

  get expired(): boolean {
    return (daysUntilExpiry(this.document) ?? 0) < 0;
  }

  get expiry(): string {
    return expiryLabel(this.document);
  }

  private async loadFile() {
    this.releaseFile();
    if (!this.document.file) return;

    this.loadingFile = true;
    this.fileError = '';
    try {
      const blob = await this.documentService.downloadFile(this.document.id);
      this.objectUrl = URL.createObjectURL(blob);
      if (this.isPdf) this.pdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl);
    } catch (error) {
      console.error('Error loading document file:', error);
      this.fileError = 'Impossible de charger le fichier. Vérifie ta connexion et réessaie.';
    } finally {
      this.loadingFile = false;
    }
  }

  private releaseFile() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.pdfUrl = null;
  }

  open() {
    if (this.objectUrl) window.open(this.objectUrl, '_blank');
  }

  download() {
    if (!this.objectUrl || !this.document.file) return;
    const link = window.document.createElement('a');
    link.href = this.objectUrl;
    link.download = this.document.file.name;
    link.click();
  }

  async edit() {
    const modal = await this.modalController.create({
      component: DocumentFormModalComponent,
      componentProps: { document: this.document, members: this.members, currentUserId: this.currentUserId },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      cssClass: 'auto-sheet'
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (!data?.document) return;

    const fileChanged = data.document.file?.uploadedAt !== this.document.file?.uploadedAt;
    this.document = data.document;
    this.changed = true;
    this.toastService.success('Document enregistré');
    if (fileChanged) this.loadFile();
  }

  async remove() {
    const alert = await this.alertController.create({
      header: 'Supprimer ce document ?',
      message: this.document.file ? 'Le fichier sera supprimé pour tout le foyer.' : undefined,
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        { text: 'Supprimer', role: 'destructive' }
      ]
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;

    try {
      await this.documentService.deleteDocument(this.document.id);
      this.toastService.success('Document supprimé');
      this.modalController.dismiss({ changed: true });
    } catch (error) {
      console.error('Error deleting document:', error);
      this.toastService.error((error as Error).message || 'Impossible de supprimer le document');
    }
  }

  dismiss() {
    this.modalController.dismiss(this.changed ? { changed: true } : undefined);
  }
}
