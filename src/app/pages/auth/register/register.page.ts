import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonInput, IonButton, IonText, IonBackButton, IonButtons, IonSpinner, IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eye, eyeOff } from 'ionicons/icons';
import { AuthService, MIN_PASSWORD_LENGTH } from '../../../services/auth.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonInput, IonButton, IonText, IonBackButton, IonButtons, IonIcon, IonSpinner
  ]
})
export class RegisterPage {
  showPassword = false;
  showConfirmPassword = false;
  loading = false;
  error = '';
  readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  readonly termsUrl = `${environment.legalUrl}/cgu`;
  readonly privacyUrl = `${environment.legalUrl}/confidentialite`;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {
    addIcons({ 'eye': eye, 'eye-off': eyeOff });
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  async register(nameInput: IonInput, emailInput: IonInput, passwordInput: IonInput, confirmPasswordInput: IonInput) {
    const displayName = String(nameInput.value);
    const email = String(emailInput.value);
    const password = String(passwordInput.value);
    const confirmPassword = String(confirmPasswordInput.value);

    if (!displayName || !email || !password || !confirmPassword) {
      this.error = 'Veuillez remplir tous les champs';
      return;
    }

    if (password !== confirmPassword) {
      this.error = 'Les mots de passe ne correspondent pas';
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      this.error = `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`;
      return;
    }

    try {
      this.loading = true;
      this.error = '';
      await this.authService.signUp(email, password, displayName);
      this.router.navigate(['/tabs/home']);
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : 'Erreur lors de l\'inscription';
    } finally {
      this.loading = false;
    }
  }
}
