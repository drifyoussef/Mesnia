import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/**
 * Push notifications (Firebase Cloud Messaging on Android, APNs through Firebase on iOS).
 * Once signed in, the phone's token is sent to the server, which decides what to send
 * according to the user's settings. Tapping a notification opens the page it is about.
 * Nothing happens in a browser: push needs the native app (see PUSH-SETUP.md).
 */
@Injectable({
  providedIn: 'root'
})
export class PushService {
  private started = false;
  private deviceToken: string | null = null;
  private registeredFor: string | null = null;

  constructor(
    private api: ApiService,
    private authService: AuthService,
    private router: Router,
    private zone: NgZone
  ) {}

  get supported(): boolean {
    return Capacitor.isNativePlatform();
  }

  /** The token of this phone, if push is set up (lets "log out other devices" keep it). */
  get token(): string | null {
    return this.deviceToken;
  }

  init() {
    if (this.started || !this.supported) return;
    this.started = true;

    PushNotifications.addListener('registration', ({ value }) => {
      this.deviceToken = value;
      this.sendToken();
    });
    PushNotifications.addListener('registrationError', error => {
      console.error('Push registration failed:', error);
    });
    PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const route = notification.data?.route;
      if (typeof route === 'string' && route.startsWith('/tabs/')) {
        this.zone.run(() => this.router.navigateByUrl(route));
      }
    });

    // The phone stops receiving this account's notifications at logout
    this.authService.onSignOut(async () => {
      if (this.deviceToken && this.registeredFor) {
        await this.api.postAsync('notifications/devices/remove', { token: this.deviceToken });
      }
      this.registeredFor = null;
    });

    this.authService.currentUser$.subscribe(user => {
      if (user) this.register(false);
    });
  }

  /** Asks for the permission once, the first time the home page is reached after signing in. */
  async askOnce(): Promise<void> {
    const key = 'mesnia_push_asked';
    if (!this.supported || localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    await this.register(true);
  }

  /** Current permission: 'granted', 'denied' or 'prompt' ('unsupported' in a browser). */
  async permission(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
    if (!this.supported) return 'unsupported';
    const status = await PushNotifications.checkPermissions();
    return status.receive === 'granted' ? 'granted' : status.receive === 'denied' ? 'denied' : 'prompt';
  }

  /**
   * Registers the phone for push. Asks for the permission only when `ask` is true (the user
   * switched notifications on): never out of the blue at startup.
   * @returns whether push is now allowed
   */
  async register(ask: boolean): Promise<boolean> {
    if (!this.supported) return false;
    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' && ask) {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') return false;

    await PushNotifications.register(); // the token arrives in the 'registration' listener
    if (this.deviceToken) await this.sendToken();
    return true;
  }

  private async sendToken() {
    const user = this.authService.getCurrentUser();
    if (!user || !this.deviceToken || this.registeredFor === `${user.id}:${this.deviceToken}`) return;
    try {
      await this.api.postAsync('notifications/devices', {
        token: this.deviceToken,
        platform: Capacitor.getPlatform()
      });
      this.registeredFor = `${user.id}:${this.deviceToken}`;
    } catch (error) {
      console.error('Could not register this phone for notifications:', error);
    }
  }
}
