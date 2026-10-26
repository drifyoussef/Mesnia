import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonButton, IonIcon, NavController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkDoneOutline, cartOutline, sparklesOutline, calendarOutline } from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.page.html',
  styleUrls: ['./welcome.page.scss'],
  standalone: true,
  imports: [IonContent, IonButton, IonIcon]
})
export class WelcomePage implements OnInit {
  constructor(
    private authService: AuthService,
    private router: Router,
    private navController: NavController
  ) {
    addIcons({ checkmarkDoneOutline, cartOutline, sparklesOutline, calendarOutline });
  }

  ngOnInit() {
    // Si déjà connecté, rediriger vers l'app
    if (this.authService.isAuthenticated()) {
      this.navController.navigateRoot('/tabs/home');
    }
  }

  goToLogin() {
    this.router.navigate(['/auth/login']);
  }

  goToRegister() {
    this.router.navigate(['/auth/register']);
  }
}
