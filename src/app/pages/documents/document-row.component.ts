import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { documentTextOutline, imageOutline, readerOutline, lockClosed } from 'ionicons/icons';
import { HouseholdDocument } from '../../models/document.model';
import { HouseholdMember } from '../../models/user.model';
import { categoryInfo, daysUntilExpiry, expiryLabel, formatDocumentDate, needsRenewal } from './document.utils';

/** One document in a list: type icon tinted with its category, title, who / when, alerts. */
@Component({
  selector: 'app-document-row',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <span class="doc-icon" [style.--category-color]="category.color">
      <ion-icon [name]="icon"></ion-icon>
    </span>
    <span class="doc-text">
      <span class="doc-title">{{ document.title }}</span>
      <span class="doc-meta">{{ meta }}</span>
    </span>
    @if (document.private) {
      <ion-icon class="doc-private" name="lock-closed" aria-label="Privé"></ion-icon>
    }
    @if (renewal) {
      <span class="doc-expiry" [class.expired]="expired">{{ expiry }}</span>
    }
  `,
  styles: [`
    :host {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .doc-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      border-radius: 12px;
      background: color-mix(in srgb, var(--category-color) 16%, #FFFFFF);
      color: var(--category-color);
      font-size: 20px;
    }

    .doc-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .doc-title {
      font-weight: 700;
      color: var(--ion-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .doc-meta {
      font-size: 12px;
      color: var(--ion-color-medium-shade);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .doc-private {
      flex-shrink: 0;
      font-size: 14px;
      color: var(--ion-color-medium);
    }

    .doc-expiry {
      flex-shrink: 0;
      padding: 3px 8px;
      border-radius: var(--radius-full);
      background: rgba(var(--ion-color-warning-rgb), 0.18);
      color: var(--ion-color-warning-shade);
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }

    .doc-expiry.expired {
      background: rgba(var(--ion-color-danger-rgb), 0.12);
      color: var(--ion-color-danger);
    }
  `]
})
export class DocumentRowComponent {
  @Input({ required: true }) document!: HouseholdDocument;
  @Input() members: HouseholdMember[] = [];
  /** In a category page the category is already known: no need to repeat it */
  @Input() showCategory = true;

  constructor() {
    addIcons({ documentTextOutline, imageOutline, readerOutline, lockClosed });
  }

  get category() {
    return categoryInfo(this.document.category);
  }

  get icon(): string {
    if (!this.document.file) return 'reader-outline';
    return this.document.file.mimeType === 'application/pdf' ? 'document-text-outline' : 'image-outline';
  }

  get meta(): string {
    const parts: string[] = [];
    if (this.showCategory) parts.push(this.category.label);
    const member = this.members.find(m => m.userId === this.document.memberId);
    if (member) parts.push(member.displayName);
    if (this.document.documentDate) parts.push(formatDocumentDate(this.document.documentDate));
    if (!this.document.file) parts.push('Note');
    return parts.join(' · ') || 'Tout le foyer';
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
}
