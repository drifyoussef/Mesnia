import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from './api.service';
import { TokenStorageService } from '../core/token-storage.service';
import { User } from '../models/user.model';

interface AuthResponse {
  user: User;
  token: string;
}

/** Same rule as the server */
export const MIN_PASSWORD_LENGTH = 8;

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private initPromise: Promise<void>;
  /** Run before the session ends, while the token still works (e.g. forget this phone's push token) */
  private signOutHooks: (() => Promise<void>)[] = [];

  constructor(private apiService: ApiService, private tokenStorage: TokenStorageService) {
    this.initPromise = this.loadStoredAuth();
  }

  async waitForInit(): Promise<void> {
    return this.initPromise;
  }

  async getDisplayName(): Promise<string> {
    await this.waitForInit();
    const user = this.currentUserSubject.value;
    return user ? user.displayName : '';
  }

  onSignOut(hook: () => Promise<void>): void {
    this.signOutHooks.push(hook);
  }

  private async loadStoredAuth(): Promise<void> {
    if (await this.tokenStorage.load()) {
      await this.loadUserProfile();
    }
  }

  private async loadUserProfile() {
    try {
      const response = await this.apiService.getAsync<{ user: User }>('auth/me');
      this.currentUserSubject.next(response.user);
    } catch (error) {
      // Token refusé ou compte supprimé : la session est vraiment finie.
      // Une erreur réseau / serveur (backend qui redémarre...) ne doit pas effacer le token :
      // le prochain refresh reconnectera l'utilisateur tout seul.
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 401 || status === 403 || status === 404) {
        await this.endSession();
      }
    }
  }

  private async startSession(response: AuthResponse): Promise<User> {
    await this.tokenStorage.save(response.token);
    this.currentUserSubject.next(response.user);
    return response.user;
  }

  /** Forgets the session locally (the server side is already over or not needed). */
  private async endSession(): Promise<void> {
    await this.tokenStorage.clear();
    this.currentUserSubject.next(null);
  }

  async signUp(email: string, password: string, displayName: string): Promise<User> {
    return this.startSession(await this.apiService.postAsync<AuthResponse>('auth/register', { email, password, displayName }));
  }

  async signIn(email: string, password: string): Promise<User> {
    return this.startSession(await this.apiService.postAsync<AuthResponse>('auth/login', { email, password }));
  }

  async signOut(): Promise<void> {
    for (const hook of this.signOutHooks) {
      try {
        await hook();
      } catch (error) {
        console.error('Sign-out hook failed:', error);
      }
    }
    await this.endSession();
  }

  async updateProfile(displayName?: string, avatar?: string): Promise<User> {
    const response = await this.apiService.putAsync<{ user: User }>('auth/profile', { displayName, avatar });
    this.currentUserSubject.next(response.user);
    return response.user;
  }

  /** The other devices are logged out; this one receives a fresh token. */
  async changePassword(currentPassword: string, newPassword: string): Promise<User> {
    return this.startSession(await this.apiService.postAsync<AuthResponse>('auth/change-password', { currentPassword, newPassword }));
  }

  async logoutOtherDevices(keepDeviceToken?: string): Promise<void> {
    const response = await this.apiService.postAsync<{ token: string }>('auth/logout-all', { keepDeviceToken });
    await this.tokenStorage.save(response.token);
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.apiService.postAsync<{ message: string }>('auth/forgot-password', { email });
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<User> {
    const response = await this.apiService.postAsync<{ user: User }>('auth/reset-password', { email, code, newPassword });
    return response.user;
  }

  async sendVerificationCode(): Promise<void> {
    await this.apiService.postAsync('auth/verify-email/send', {});
  }

  async verifyEmail(code: string): Promise<User> {
    const response = await this.apiService.postAsync<{ user: User }>('auth/verify-email', { code });
    this.currentUserSubject.next(response.user);
    return response.user;
  }

  /** Deletes the account for good (the password confirms it). */
  async deleteAccount(password: string): Promise<void> {
    await this.apiService.postAsync('auth/account/delete', { password });
    await this.endSession();
  }

  /** Reloads the account (after a change made elsewhere, e.g. joining a household). */
  async refreshUser(): Promise<void> {
    await this.loadUserProfile();
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  getHouseholdId(): string | null {
    const user = this.currentUserSubject.value;
    return user?.householdId || null;
  }

  /**
   * Met à jour le household actif de l'utilisateur en mémoire.
   * Utilisé après création/adhésion/départ d'un foyer pour garder
   * le reste de l'app (liste de courses, etc.) synchronisé.
   */
  setHouseholdId(householdId: string | null): void {
    const user = this.currentUserSubject.value;
    if (!user) return;
    this.currentUserSubject.next({ ...user, householdId: householdId ?? undefined });
  }

  isAuthenticated(): boolean {
    return this.currentUserSubject.value !== null;
  }
}
