import { Component, OnInit, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon,
  IonToggle, IonBackButton, IonButtons, IonSelect, IonSelectOption,
  IonInput, IonSpinner, AlertController, NavController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronForward, homeOutline, phonePortraitOutline, mailOutline, checkmarkDoneOutline,
  restaurantOutline, heartOutline, peopleOutline, timeOutline, notificationsOffOutline,
  lockClosedOutline, logOutOutline
} from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { User } from '../../models/user.model';

interface NotificationPreferences {
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  swipeReminders: boolean;
  mealReminders: boolean;
  taskReminders: boolean;
  familyUpdates: boolean;
  notificationFrequency: 'realtime' | 'daily' | 'weekly';
}

type NotificationTypeKey = 'taskReminders' | 'mealReminders' | 'swipeReminders' | 'familyUpdates';

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const PREFERENCES_STORAGE_KEY = 'wevy_notification_preferences';

const DEFAULT_PREFERENCES: NotificationPreferences = {
  emailNotifications: true,
  pushNotifications: true,
  smsNotifications: false,
  swipeReminders: true,
  mealReminders: true,
  taskReminders: true,
  familyUpdates: true,
  notificationFrequency: 'realtime'
};

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon,
    IonToggle, IonBackButton, IonButtons, IonSelect, IonSelectOption,
    IonInput, IonSpinner
  ]
})
export class SettingsPage implements OnInit {
  currentUser: User | null = null;
  preferences: NotificationPreferences = { ...DEFAULT_PREFERENCES };

  readonly notificationTypes: { key: NotificationTypeKey; label: string; icon: string }[] = [
    { key: 'taskReminders', label: 'Tâches à faire', icon: 'checkmark-done-outline' },
    { key: 'mealReminders', label: 'Repas', icon: 'restaurant-outline' },
    { key: 'swipeReminders', label: 'Swipe de recettes', icon: 'heart-outline' },
    { key: 'familyUpdates', label: 'Nouvelles du foyer', icon: 'people-outline' },
  ];

  readonly frequencyOptions = [
    { label: 'En temps réel', value: 'realtime' },
    { label: 'Quotidien', value: 'daily' },
    { label: 'Hebdomadaire', value: 'weekly' }
  ];

  showPasswordForm = false;
  passwordForm: PasswordForm = this.emptyPasswordForm();
  passwordError = '';
  isChangingPassword = false;

  constructor(
    private authService: AuthService,
    private toastService: ToastService,
    private alertController: AlertController,
    private navController: NavController
  ) {
    addIcons({
      chevronForward, homeOutline, phonePortraitOutline, mailOutline, checkmarkDoneOutline,
      restaurantOutline, heartOutline, peopleOutline, timeOutline, notificationsOffOutline,
      lockClosedOutline, logOutOutline
    });
  }

  /** The per-type toggles only mean something if at least one channel is on. */
  get notificationsEnabled(): boolean {
    return this.preferences.pushNotifications || this.preferences.emailNotifications;
  }

  ngOnInit() {
    this.loadPreferences();
    this.currentUser = this.authService.getCurrentUser();
  }

  getInitial(): string {
    return (this.currentUser?.displayName || 'U').charAt(0).toUpperCase();
  }

  async logout() {
    const alert = await this.alertController.create({
      header: 'Se déconnecter ?',
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        {
          text: 'Se déconnecter',
          role: 'destructive',
          handler: async () => {
            await this.authService.signOut();
            this.navController.navigateRoot('/auth/login');
          }
        }
      ]
    });

    await alert.present();
  }

  loadPreferences() {
    try {
      const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (stored) {
        // Merge over the defaults so a key added later never comes back undefined
        this.preferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
    }
  }

  /** Saved on every change - no "save" button to forget. */
  savePreferences() {
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(this.preferences));
    } catch (error) {
      console.error('Error saving preferences:', error);
      this.toastService.error("Impossible d'enregistrer tes préférences");
    }
  }

  togglePasswordForm() {
    this.showPasswordForm = !this.showPasswordForm;
    if (!this.showPasswordForm) {
      this.passwordForm = this.emptyPasswordForm();
      this.passwordError = '';
    }
  }

  async changePassword() {
    this.passwordError = '';

    if (!this.passwordForm.currentPassword.trim()) {
      this.passwordError = 'Veuillez entrer votre mot de passe actuel';
      return;
    }

    if (!this.passwordForm.newPassword.trim()) {
      this.passwordError = 'Veuillez entrer le nouveau mot de passe';
      return;
    }

    if (this.passwordForm.newPassword.length < 6) {
      this.passwordError = 'Le nouveau mot de passe doit contenir au moins 6 caractères';
      return;
    }

    if (this.passwordForm.newPassword !== this.passwordForm.confirmPassword) {
      this.passwordError = 'Les mots de passe ne correspondent pas';
      return;
    }

    if (this.passwordForm.currentPassword === this.passwordForm.newPassword) {
      this.passwordError = 'Le nouveau mot de passe doit être différent de l\'ancien';
      return;
    }

    try {
      this.isChangingPassword = true;
      await this.authService.changePassword(
        this.passwordForm.currentPassword,
        this.passwordForm.newPassword
      );

      this.toastService.success('Mot de passe changé !');
      this.showPasswordForm = false;
      this.passwordForm = this.emptyPasswordForm();
    } catch (error: unknown) {
      console.error('Change password error:', error);
      this.passwordError = this.extractErrorMessage(error);
    } finally {
      this.isChangingPassword = false;
    }
  }

  private extractErrorMessage(error: unknown): string {
    const fallback = 'Erreur lors du changement de mot de passe';

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null && 'error' in error) {
      const httpError = error as Record<string, unknown>;
      if (typeof httpError.error === 'object' && httpError.error !== null && 'error' in httpError.error) {
        const apiError = httpError.error as Record<string, unknown>;
        return String(apiError.error || fallback);
      }
      return String(httpError.error || fallback);
    }

    return fallback;
  }

  private emptyPasswordForm(): PasswordForm {
    return { currentPassword: '', newPassword: '', confirmPassword: '' };
  }
}
