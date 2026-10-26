import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonInput, IonButton, IonText, IonSpinner, IonIcon,
  IonButtons, IonCard, IonCardContent, NavController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eye, eyeOff, lockClosedOutline, arrowBackSharp, chevronBack } from 'ionicons/icons';
import { AuthService, MIN_PASSWORD_LENGTH } from '../../../services/auth.service';

/**
 * The backend's own message ({ error: '...' }), which ApiService errors carry in `error.error`.
 * Undefined when the request failed without one (network error, timeout...).
 */
function serverMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('error' in error)) return undefined;
  const body = error.error;
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  return typeof body.error === 'string' ? body.error : undefined;
}

interface ForgotPasswordForm {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonInput, IonButton, IonText, IonSpinner, IonIcon,
    IonButtons, IonCard, IonCardContent
  ]
})
export class LoginPage {
  showPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;
  loading = false;
  error = '';

  // Forgot password
  showForgotPassword = false;
  /** Same icon as Ionic's own back buttons: chevron on iOS, arrow on Android/web */
  readonly backIcon = document.documentElement.getAttribute('mode') === 'ios' ? 'chevron-back' : 'arrow-back-sharp';
  forgotPasswordStep = 1;
  forgotPasswordLoading = false;
  forgotPasswordError = '';
  forgotPasswordSuccess = '';
  forgotPasswordForm: ForgotPasswordForm = {
    email: '',
    code: '',
    newPassword: '',
    confirmPassword: ''
  };

  constructor(
    private authService: AuthService,
    private navController: NavController,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({ 'eye': eye, 'eye-off': eyeOff, 'lock-closed-outline': lockClosedOutline, 'arrow-back-sharp': arrowBackSharp, 'chevron-back': chevronBack });
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  goBackToLogin() {
    this.showForgotPassword = false;
    this.forgotPasswordStep = 1;
    this.forgotPasswordForm = {
      email: '',
      code: '',
      newPassword: '',
      confirmPassword: ''
    };
    this.forgotPasswordError = '';
    this.forgotPasswordSuccess = '';
  }

  async login(emailInput: IonInput, passwordInput: IonInput) {
    // The keyboard's Enter key also lands here, even while a sign-in is running
    if (this.loading) return;
    const email = String(emailInput.value);
    const password = String(passwordInput.value);

    if (!email || !password) {
      this.error = 'Veuillez remplir tous les champs';
      return;
    }

    try {
      this.loading = true;
      this.error = '';
      await this.authService.signIn(email, password);
      // Root navigation: the back gesture must not lead back to the login screen
      this.navController.navigateRoot('/tabs/home');
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : 'Erreur de connexion';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  async requestResetCode() {
    // Validation
    if (!this.forgotPasswordForm.email.trim()) {
      this.forgotPasswordError = 'Veuillez entrer votre email';
      return;
    }

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.forgotPasswordForm.email)) {
      this.forgotPasswordError = 'Veuillez entrer un email valide';
      return;
    }

    try {
      this.forgotPasswordLoading = true;
      this.forgotPasswordError = '';
      await this.authService.requestPasswordReset(this.forgotPasswordForm.email);
      this.forgotPasswordStep = 2;
    } catch (error: unknown) {
      this.forgotPasswordError = serverMessage(error) ?? 'Erreur lors de l\'envoi du code';
    } finally {
      this.forgotPasswordLoading = false;
      this.cdr.detectChanges();
    }
  }

  async resetPassword() {
    // Reset messages
    this.forgotPasswordError = '';
    this.forgotPasswordSuccess = '';

    // Validation
    if (!this.forgotPasswordForm.code.trim()) {
      this.forgotPasswordError = 'Veuillez entrer le code';
      return;
    }

    if (!this.forgotPasswordForm.newPassword.trim()) {
      this.forgotPasswordError = 'Veuillez entrer le nouveau mot de passe';
      return;
    }

    if (this.forgotPasswordForm.newPassword.length < MIN_PASSWORD_LENGTH) {
      this.forgotPasswordError = `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`;
      return;
    }

    if (this.forgotPasswordForm.newPassword !== this.forgotPasswordForm.confirmPassword) {
      this.forgotPasswordError = 'Les mots de passe ne correspondent pas';
      return;
    }

    try {
      this.forgotPasswordLoading = true;
      this.forgotPasswordError = '';

      await this.authService.resetPassword(
        this.forgotPasswordForm.email,
        this.forgotPasswordForm.code,
        this.forgotPasswordForm.newPassword
      );

      this.forgotPasswordSuccess = 'Mot de passe réinitialisé : tu peux te connecter.';

      // Redirect to login after 2 seconds
      setTimeout(() => {
        this.goBackToLogin();
        this.cdr.detectChanges();
      }, 2000);
    } catch (error: unknown) {
      this.forgotPasswordError = serverMessage(error)
        ?? (error instanceof Error ? error.message : 'Erreur lors de la réinitialisation');
    } finally {
      this.forgotPasswordLoading = false;
      this.cdr.detectChanges();
    }
  }
}
