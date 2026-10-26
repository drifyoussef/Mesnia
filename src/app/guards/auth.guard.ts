import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { NavController } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const navController = inject(NavController);

  // Wait for auth service to initialize
  await authService.waitForInit();

  if (authService.isAuthenticated()) {
    return true;
  }

  navController.navigateRoot('/auth/login');
  return false;
};
