import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons, IonBackButton, IonIcon, IonSpinner,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  add, cloudOfflineOutline, refreshOutline, chevronForward, home,
  medkit, people, receipt, idCard, card, shieldCheckmark, briefcase, carSport, school, folderOpen
} from 'ionicons/icons';
import { DocumentService } from '../../services/document.service';
import { HouseholdService } from '../../services/household.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { DocumentCategoryInfo, HouseholdDocument } from '../../models/document.model';
import { HouseholdMember } from '../../models/user.model';
import { memberColor, memberInitial } from '../../utils/member.utils';
import { DocumentRowComponent } from './document-row.component';
import { openDocumentForm, openDocumentViewer } from './document-modals';
import { categoryInfo } from './document.utils';

type PageState = 'loading' | 'ready' | 'error';
/** '' = everyone, 'household' = documents about the whole household, else a userId */
type MemberFilter = string;

@Component({
  selector: 'app-document-category',
  templateUrl: './document-category.page.html',
  styleUrls: ['./documents.page.scss', './document-category.page.scss'],
  standalone: true,
  imports: [
    CommonModule, DocumentRowComponent,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons, IonBackButton, IonIcon, IonSpinner
  ]
})
export class DocumentCategoryPage {
  state: PageState = 'loading';
  category: DocumentCategoryInfo;
  documents: HouseholdDocument[] = [];
  members: HouseholdMember[] = [];
  filter: MemberFilter = '';

  constructor(
    route: ActivatedRoute,
    private documentService: DocumentService,
    private householdService: HouseholdService,
    private authService: AuthService,
    private toastService: ToastService,
    private modalController: ModalController
  ) {
    addIcons({
      add, cloudOfflineOutline, refreshOutline, chevronForward, home,
      medkit, people, receipt, idCard, card, shieldCheckmark, briefcase, carSport, school, folderOpen
    });
    this.category = categoryInfo(route.snapshot.paramMap.get('category') || '');
  }

  ionViewWillEnter() {
    this.load();
  }

  async load() {
    if (this.state !== 'ready') this.state = 'loading';
    try {
      const household = await this.householdService.getCurrentHousehold();
      this.members = household?.members || [];
      const documents = await this.documentService.getDocuments();
      // Most recent document date first; undated ones by when they were added
      this.documents = documents
        .filter(doc => doc.category === this.category.value)
        .sort((a, b) => (b.documentDate || b.createdAt).localeCompare(a.documentDate || a.createdAt));
      this.state = 'ready';
    } catch (error) {
      console.error('Error loading documents:', error);
      this.state = 'error';
    }
  }

  /** Members this category has documents about: only they get a filter chip */
  get concernedMembers(): HouseholdMember[] {
    return this.members.filter(m => this.documents.some(doc => doc.memberId === m.userId));
  }

  get hasHouseholdDocuments(): boolean {
    return this.documents.some(doc => !doc.memberId);
  }

  get filtered(): HouseholdDocument[] {
    if (!this.filter) return this.documents;
    if (this.filter === 'household') return this.documents.filter(doc => !doc.memberId);
    return this.documents.filter(doc => doc.memberId === this.filter);
  }

  get tint(): string {
    return `color-mix(in srgb, ${this.category.color} 16%, #FFFFFF)`;
  }

  color(name: string): string {
    return memberColor(name);
  }

  initial(name: string): string {
    return memberInitial(name);
  }

  async openDocument(doc: HouseholdDocument) {
    const changed = await openDocumentViewer(this.modalController, doc, this.modalContext());
    if (changed) this.load();
  }

  async addDocument() {
    const saved = await openDocumentForm(this.modalController, { ...this.modalContext(), initialCategory: this.category.value });
    if (!saved) return;
    this.toastService.success('Document ajouté');
    this.load();
  }

  private modalContext() {
    return { members: this.members, currentUserId: this.authService.getCurrentUser()?.id || null };
  }
}
