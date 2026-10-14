import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons, IonBackButton, IonIcon, IonSpinner,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  add, search, closeCircle, cloudOfflineOutline, refreshOutline, homeOutline, chevronForward, folderOpenOutline,
  medkit, people, receipt, home, idCard, card, shieldCheckmark, briefcase, carSport, school, folderOpen
} from 'ionicons/icons';
import { DocumentService } from '../../services/document.service';
import { HouseholdService } from '../../services/household.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { DOCUMENT_CATEGORIES, DocumentCategoryInfo, HouseholdDocument } from '../../models/document.model';
import { HouseholdMember } from '../../models/user.model';
import { DocumentRowComponent } from './document-row.component';
import { openDocumentForm, openDocumentViewer } from './document-modals';
import { daysUntilExpiry, matchesSearch, needsRenewal } from './document.utils';

type PageState = 'loading' | 'ready' | 'error' | 'no-household';

const RECENT_COUNT = 5;

@Component({
  selector: 'app-documents',
  templateUrl: './documents.page.html',
  styleUrls: ['./documents.page.scss'],
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, DocumentRowComponent,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons, IonBackButton, IonIcon, IonSpinner
  ]
})
export class DocumentsPage {
  state: PageState = 'loading';
  documents: HouseholdDocument[] = [];
  members: HouseholdMember[] = [];
  query = '';

  readonly categories = DOCUMENT_CATEGORIES;

  constructor(
    private documentService: DocumentService,
    private householdService: HouseholdService,
    private authService: AuthService,
    private toastService: ToastService,
    private modalController: ModalController,
    private router: Router
  ) {
    addIcons({
      add, search, closeCircle, cloudOfflineOutline, refreshOutline, homeOutline, chevronForward, folderOpenOutline,
      medkit, people, receipt, home, idCard, card, shieldCheckmark, briefcase, carSport, school, folderOpen
    });
  }

  /** Reloaded on every visit: documents change from the category pages and from other members. */
  ionViewWillEnter() {
    this.load();
  }

  async load() {
    if (this.state !== 'ready') this.state = 'loading';
    try {
      const household = await this.householdService.getCurrentHousehold();
      if (!household) {
        this.state = this.householdService.loadState === 'error' ? 'error' : 'no-household';
        return;
      }
      this.members = household.members;
      this.documents = await this.documentService.getDocuments();
      this.state = 'ready';
    } catch (error) {
      console.error('Error loading documents:', error);
      this.state = 'error';
    }
  }

  get searchResults(): HouseholdDocument[] {
    return this.documents.filter(doc => matchesSearch(doc, this.query));
  }

  /** Expired first, then the soonest to expire */
  get toRenew(): HouseholdDocument[] {
    return this.documents
      .filter(needsRenewal)
      .sort((a, b) => (daysUntilExpiry(a) ?? 0) - (daysUntilExpiry(b) ?? 0));
  }

  get recent(): HouseholdDocument[] {
    return this.documents.slice(0, RECENT_COUNT); // the server sends the newest first
  }

  count(category: DocumentCategoryInfo): number {
    return this.documents.filter(doc => doc.category === category.value).length;
  }

  tint(category: DocumentCategoryInfo): string {
    return `color-mix(in srgb, ${category.color} 16%, #FFFFFF)`;
  }

  openCategory(category: DocumentCategoryInfo) {
    this.router.navigate(['/tabs/documents', category.value]);
  }

  async openDocument(doc: HouseholdDocument) {
    const changed = await openDocumentViewer(this.modalController, doc, this.modalContext());
    if (changed) this.load();
  }

  async addDocument() {
    const saved = await openDocumentForm(this.modalController, this.modalContext());
    if (!saved) return;
    this.toastService.success('Document ajouté');
    this.load();
  }

  private modalContext() {
    return { members: this.members, currentUserId: this.authService.getCurrentUser()?.id || null };
  }
}
