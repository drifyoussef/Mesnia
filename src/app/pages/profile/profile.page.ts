import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonIcon, IonButton,
  IonButtons, IonBackButton,
  ModalController, AlertController, IonSpinner
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { addIcons } from 'ionicons';
import {
  homeOutline, home, cloudOfflineOutline, addOutline, keyOutline, chevronForward, close, copyOutline,
  checkmark, linkOutline, shareSocialOutline, refreshOutline, personRemoveOutline, exitOutline, peopleOutline
} from 'ionicons/icons';
import { HouseholdService, HouseholdLoadState } from '../../services/household.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { Household, HouseholdMember } from '../../models/user.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonIcon,
    IonButtons, IonBackButton, IonSpinner
  ]
})
export class ProfilePage implements OnInit, OnDestroy {
  household: Household | null = null;
  members: HouseholdMember[] = [];
  currentUserId: string | null = null;
  inviteLink = '';
  inviteCode = '';
  copiedLink = false;
  copiedCode = false;
  loadState: HouseholdLoadState = 'loading';
  private subscriptions = new Subscription();

  constructor(
    private householdService: HouseholdService,
    private authService: AuthService,
    private modalController: ModalController,
    private alertController: AlertController,
    private toastService: ToastService
  ) {
    addIcons({
      homeOutline, home, cloudOfflineOutline, addOutline, keyOutline, chevronForward, close, copyOutline,
      checkmark, linkOutline, shareSocialOutline, refreshOutline, personRemoveOutline, exitOutline
    });
  }

  ngOnInit() {
    // Followed rather than read once: right after a refresh the user isn't loaded yet
    this.subscriptions.add(
      this.authService.currentUser$.subscribe(user => this.currentUserId = user?.id || null)
    );

    this.subscriptions.add(
      this.householdService.loadState$.subscribe(state => this.loadState = state)
    );

    this.subscriptions.add(
      this.householdService.getCurrentHousehold$().subscribe(household => {
        this.household = household;
        this.members = household?.members || [];
        if (household) {
          this.inviteLink = household.inviteLink;
          this.inviteCode = household.inviteCode;
        }
      })
    );
  }

  /** The invite code changes every day: never show an expired one */
  ionViewWillEnter() {
    this.householdService.refreshInviteCodeIfExpired();
  }

  /** "18 h", "moins d'une heure": until the backend replaces the code */
  get inviteExpiryLabel(): string {
    const expiry = this.household?.inviteLinkExpiry;
    if (!expiry) return '';
    const hours = Math.floor((expiry.getTime() - Date.now()) / 3600000);
    return hours >= 1 ? `${hours} h` : "moins d'une heure";
  }

  retryLoad() {
    this.householdService.reload();
  }

  async createHousehold() {
    const modal = await this.modalController.create({
      component: CreateHouseholdModalComponent,
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      cssClass: 'auto-sheet'
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data) {
      const currentUser = this.authService.getCurrentUser();
      if (currentUser) {
        try {
          const household = await this.householdService.createHousehold(
            data.householdName,
            currentUser.id,
            currentUser.displayName
          );
          this.householdService.setCurrentHousehold(household);
          this.toastService.success('Foyer créé !');
        } catch (error) {
          console.error('Error creating household:', error);
          this.toastService.error('Impossible de créer le foyer');
        }
      }
    }
  }

  async joinHouseholdByCode() {
    const modal = await this.modalController.create({
      component: JoinHouseholdModalComponent,
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      cssClass: 'auto-sheet'
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data && this.currentUserId && this.authService.getCurrentUser()) {
      try {
        const currentUser = this.authService.getCurrentUser();
        const household = await this.householdService.joinHouseholdByCode(
          data.inviteCode,
          this.currentUserId,
          currentUser!.displayName
        );
        if (household) {
          this.householdService.setCurrentHousehold(household);
          this.toastService.success('Tu as rejoint le foyer !');
        }
      } catch (error) {
        console.error('Error joining household:', error);
        this.toastService.error(this.joinErrorMessage(error));
      }
    }
  }

  async joinHouseholdByLink(link: string) {
    if (!this.currentUserId || !this.authService.getCurrentUser()) return;

    try {
      const currentUser = this.authService.getCurrentUser();
      const household = await this.householdService.joinHouseholdByLink(
        link,
        this.currentUserId,
        currentUser!.displayName
      );
      if (household) {
        this.householdService.setCurrentHousehold(household);
        this.toastService.success('Tu as rejoint le foyer !');
      }
    } catch (error) {
      console.error('Error joining household via link:', error);
      this.toastService.error(this.joinErrorMessage(error));
    }
  }

  async regenerateInvite() {
    if (!this.household) return;

    const confirmed = await this.confirm(
      'Nouveau code ?',
      "L'ancien code et l'ancien lien ne fonctionneront plus.",
      'Générer'
    );
    if (!confirmed) return;

    try {
      const result = await this.householdService.regenerateInviteLink(this.household.id);
      this.inviteLink = result.link;
      this.inviteCode = result.code;
      this.toastService.success('Nouveau code généré');
    } catch (error) {
      console.error('Error regenerating invite:', error);
      this.toastService.error('Impossible de générer un nouveau code');
    }
  }

  /** The backend explains why (code changed, too many attempts...); otherwise a generic message */
  private joinErrorMessage(error: unknown): string {
    const status = (error as { statusCode?: number }).statusCode || 0;
    return status >= 400 && status < 500 ? (error as Error).message : 'Impossible de rejoindre le foyer, réessaie';
  }

  async copyToClipboard(type: 'link' | 'code') {
    // Copied right after a refresh if the code expired while the page was open
    await this.householdService.refreshInviteCodeIfExpired();
    const text = type === 'link' ? this.inviteLink : this.inviteCode;
    navigator.clipboard.writeText(text).then(() => {
      if (type === 'link') {
        this.copiedLink = true;
        setTimeout(() => this.copiedLink = false, 2000);
      } else {
        this.copiedCode = true;
        setTimeout(() => this.copiedCode = false, 2000);
      }
    }).catch(() => this.toastService.error('Impossible de copier'));
  }

  async shareLink() {
    await this.householdService.refreshInviteCodeIfExpired();

    // No share sheet (desktop browsers): copying is the next best thing
    if (!navigator.share) {
      await this.copyToClipboard('link');
      this.toastService.success('Lien copié');
      return;
    }

    navigator.share({
      title: 'Rejoins mon foyer sur Mesnia',
      text: `Rejoins mon foyer avec ce lien : ${this.inviteLink}`,
      url: this.inviteLink
    }).catch(err => console.log('Error sharing:', err));
  }

  async removeMember(member: HouseholdMember) {
    if (!this.household) return;

    const confirmed = await this.confirm(
      `Retirer ${member.displayName} ?`,
      "Cette personne n'aura plus accès au foyer.",
      'Retirer'
    );
    if (!confirmed) return;

    try {
      await this.householdService.removeMember(this.household.id, member.userId);
      this.toastService.success(`${member.displayName} a été retiré du foyer`);
    } catch (error) {
      console.error('Error removing member:', error);
      this.toastService.error('Impossible de retirer ce membre');
    }
  }

  async updateMemberRole(memberId: string, newRole: 'admin' | 'member') {
    if (!this.household) return;

    try {
      await this.householdService.updateMemberRole(this.household.id, memberId, newRole);
    } catch (error) {
      console.error('Error updating member role:', error);
    }
  }

  async leaveHousehold() {
    if (!this.household || !this.currentUserId) return;

    // The backend deletes the whole household when its creator (or last member) leaves
    const deletesHousehold = this.household.createdBy === this.currentUserId || this.members.length === 1;
    const others = this.members.length - 1;
    const message = !deletesHousehold
      ? "Tu n'auras plus accès aux tâches, courses, calendrier et documents du foyer. Tes documents privés seront supprimés."
      : others > 0
        ? `Tu as créé ce foyer : le quitter le supprimera définitivement, avec tous ses documents, pour les ${others} autre${others > 1 ? 's' : ''} membre${others > 1 ? 's' : ''}.`
        : 'Tu es le seul membre : le foyer et tous ses documents seront supprimés définitivement.';

    const confirmed = await this.confirm(
      deletesHousehold ? 'Supprimer le foyer ?' : 'Quitter le foyer ?',
      message,
      deletesHousehold ? 'Supprimer' : 'Quitter'
    );
    if (!confirmed) return;

    try {
      await this.householdService.leaveHousehold(this.household.id, this.currentUserId);
      this.toastService.success(deletesHousehold ? 'Foyer supprimé' : 'Tu as quitté le foyer');
    } catch (error) {
      console.error('Error leaving household:', error);
      this.toastService.error('Impossible de quitter le foyer');
    }
  }

  /** Native-looking confirmation dialog with a red action button. */
  private async confirm(header: string, message: string, confirmText: string): Promise<boolean> {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        { text: confirmText, role: 'destructive' }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'destructive';
  }

  isAdmin(member: HouseholdMember): boolean {
    return member.role === 'admin';
  }

  isCurrentUser(userId: string): boolean {
    return userId === this.currentUserId;
  }

  canManageMembers(): boolean {
    if (!this.household || !this.currentUserId) return false;
    const currentMember = this.household.members.find(m => m.userId === this.currentUserId);
    return currentMember?.role === 'admin';
  }

  getAvatarColor(name: string): string {
    const colors = ['#74B39D', '#4F8A76', '#6FA8DC', '#9FB5AC', '#5C9EA6'];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }
}

/** Shared look of the two household sheets (same style as the app's other forms). */
const HOUSEHOLD_SHEET_STYLES = `
  .sheet-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin: 4px 0 24px;
    text-align: center;
  }

  .sheet-hero-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: 18px;
    background: linear-gradient(145deg, var(--tile-icon-light), var(--tile-icon));
    box-shadow: 0 10px 24px rgba(116, 179, 157, 0.4);
    color: #FFFFFF;
  }

  .sheet-hero-icon ion-icon {
    font-size: 28px;
  }

  .sheet-hero p {
    margin: 0;
    max-width: 300px;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--ion-color-dark-tint);
  }

  .form-group-title {
    margin: 0 0 10px 2px;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ion-color-dark-tint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .form-input--code {
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .form-hint {
    margin: 8px 0 0 2px;
    font-size: 12px;
    color: var(--ion-color-medium-shade);
  }

  .primary-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 54px;
    margin-top: 36px;
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

  .primary-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

/**
 * Modal pour créer un foyer
 */
@Component({
  selector: 'app-create-household-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButton, IonButtons, IonIcon
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Créer un foyer</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" (click)="dismiss()" aria-label="Fermer">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <div class="sheet-body ion-content-scroll-host">
      <div class="sheet-hero">
        <div class="sheet-hero-icon"><ion-icon name="home"></ion-icon></div>
        <p>Tu pourras ensuite inviter tes proches avec un code ou un lien.</p>
      </div>

      <h3 class="form-group-title">Nom du foyer</h3>
      <input
        class="form-input"
        type="text"
        [(ngModel)]="householdName"
        (keyup.enter)="create()"
        placeholder="Ex : Notre maison"
        maxlength="50"
        aria-label="Nom du foyer"
      />

      <button class="primary-btn" (click)="create()" [disabled]="!householdName.trim()">
        Créer le foyer
      </button>
    </div>
  `,
  styles: [HOUSEHOLD_SHEET_STYLES]
})
export class CreateHouseholdModalComponent {
  householdName = '';

  constructor(private modalController: ModalController) {
    addIcons({ close, home });
  }

  create() {
    const householdName = this.householdName.trim();
    if (householdName) {
      this.modalController.dismiss({ householdName });
    }
  }

  dismiss() {
    this.modalController.dismiss(null);
  }
}

/**
 * Modal pour rejoindre un foyer
 */
@Component({
  selector: 'app-join-household-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButton, IonButtons, IonIcon
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Rejoindre un foyer</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" (click)="dismiss()" aria-label="Fermer">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <div class="sheet-body ion-content-scroll-host">
      <div class="sheet-hero">
        <div class="sheet-hero-icon"><ion-icon name="people-outline"></ion-icon></div>
        <p>Demande le code ami ou le lien d'invitation à un membre du foyer (dans « Mon foyer »).</p>
      </div>

      <h3 class="form-group-title">Code ami ou lien</h3>
      <input
        class="form-input"
        [class.form-input--code]="!value.includes('/')"
        type="text"
        [(ngModel)]="value"
        (keyup.enter)="join()"
        placeholder="Ex : MZ7W7XQ4"
        autocapitalize="characters"
        aria-label="Code ami ou lien d'invitation"
      />
      <p class="form-hint">Tu peux coller le lien d'invitation en entier.</p>

      <button class="primary-btn" (click)="join()" [disabled]="!inviteCode">
        Rejoindre
      </button>
    </div>
  `,
  styles: [HOUSEHOLD_SHEET_STYLES]
})
export class JoinHouseholdModalComponent {
  value = '';

  constructor(private modalController: ModalController) {
    addIcons({ close, peopleOutline });
  }

  /** The code itself, whether a bare code or a whole invite link (mesnia://join/CODE, .../join/CODE) was typed. */
  get inviteCode(): string {
    const text = this.value.trim();
    const fromLink = text.match(/join\/([A-Za-z0-9]+)/)?.[1];
    const code = fromLink || (/^[A-Za-z0-9]+$/.test(text) ? text : '');
    return code.toUpperCase();
  }

  join() {
    // The profile page only reads `inviteCode`: links are turned into their code here
    if (this.inviteCode) {
      this.modalController.dismiss({ inviteCode: this.inviteCode });
    }
  }

  dismiss() {
    this.modalController.dismiss(null);
  }
}
