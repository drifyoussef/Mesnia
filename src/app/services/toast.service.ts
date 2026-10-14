import { Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircleOutline, alertCircleOutline } from 'ionicons/icons';

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  constructor(private toastController: ToastController) {
    addIcons({ checkmarkCircleOutline, alertCircleOutline });
  }

  async success(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2200,
      position: 'bottom',
      color: 'success',
      icon: 'checkmark-circle-outline',
      cssClass: 'mesnia-toast'
    });
    await toast.present();
  }

  async error(message: string) {
    const toast = await this.toastController.create({
      message,
      // Long explanations (e.g. "the codes change every day...") need time to be read
      duration: Math.min(8000, Math.max(2800, message.length * 55)),
      position: 'bottom',
      color: 'danger',
      icon: 'alert-circle-outline',
      cssClass: 'mesnia-toast'
    });
    await toast.present();
  }
}
