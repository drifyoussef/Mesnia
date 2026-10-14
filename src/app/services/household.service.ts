import { Injectable } from '@angular/core';
import { Household, HouseholdMember } from '../models/user.model';
import { BehaviorSubject, Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

// Représentation d'un foyer telle que renvoyée par le backend
interface BackendHouseholdMember {
  userId: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  role: 'admin' | 'member';
  joinedAt: string | Date;
}

interface BackendHousehold {
  _id?: string;
  id?: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  /** The backend replaces the code every day */
  inviteCodeExpiresAt?: string | Date;
  members: BackendHouseholdMember[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

/**
 * - loading : on ne sait pas encore (démarrage de l'app, refresh) - `null` ne veut PAS dire "pas de foyer"
 * - ready   : état fiable - `null` veut dire que l'utilisateur n'a vraiment pas de foyer
 * - error   : le foyer n'a pas pu être chargé (réseau, serveur) - on ne sait pas
 */
export type HouseholdLoadState = 'loading' | 'ready' | 'error';

@Injectable({
  providedIn: 'root'
})
export class HouseholdService {
  private currentHouseholdSubject = new BehaviorSubject<Household | null>(null);
  public currentHousehold$ = this.currentHouseholdSubject.asObservable();

  private loadStateSubject = new BehaviorSubject<HouseholdLoadState>('loading');
  public loadState$ = this.loadStateSubject.asObservable();

  /** Dernier chargement lancé, attendu par getCurrentHousehold(). */
  private pendingLoad: Promise<void> = Promise.resolve();
  /** Numéro du dernier chargement : une réponse plus ancienne arrivant après est ignorée. */
  private loadSeq = 0;
  private authReady = false;

  constructor(private api: ApiService, private authService: AuthService) {
    // Le foyer courant suit l'utilisateur connecté (aucune donnée locale partagée)
    this.authService.currentUser$.subscribe(user => {
      if (user?.householdId) {
        this.pendingLoad = this.loadHouseholdById(user.householdId);
      } else {
        this.loadSeq++; // annule un chargement en cours
        this.currentHouseholdSubject.next(null);
        // Sans utilisateur avant la fin de l'init, on ne sait encore rien
        if (user || this.authReady) {
          this.loadStateSubject.next('ready');
        }
      }
    });

    this.authService.waitForInit().then(() => {
      this.authReady = true;
      // Pas connecté au démarrage : rien à charger
      if (!this.authService.getCurrentUser()) {
        this.loadStateSubject.next('ready');
      }
    });
  }

  get loadState(): HouseholdLoadState {
    return this.loadStateSubject.value;
  }

  /**
   * Charge un foyer depuis le backend et le définit comme foyer courant
   */
  private async loadHouseholdById(householdId: string): Promise<void> {
    const seq = ++this.loadSeq;

    // Simple rafraîchissement du foyer déjà affiché : pas besoin de repasser en "loading"
    if (this.currentHouseholdSubject.value?.id !== householdId) {
      this.loadStateSubject.next('loading');
    }

    try {
      const response = await this.api.getAsync<{ household: BackendHousehold }>(`households/${householdId}`);
      if (seq !== this.loadSeq) return;
      this.currentHouseholdSubject.next(this.normalize(response.household));
      this.loadStateSubject.next('ready');
    } catch (error) {
      if (seq !== this.loadSeq) return;
      console.error('Error loading household:', error);

      if ((error as { statusCode?: number }).statusCode === 404) {
        // Le backend répond 404 quand le foyer n'existe plus ou qu'on n'en est plus membre
        this.currentHouseholdSubject.next(null);
        this.loadStateSubject.next('ready');
      } else {
        // Erreur réseau / serveur : on garde ce qu'on avait, sans prétendre qu'il n'y a pas de foyer
        this.loadStateSubject.next('error');
      }
    }
  }

  /**
   * Relance le chargement du foyer de l'utilisateur (après une erreur réseau par exemple)
   */
  async reload(): Promise<void> {
    const householdId = this.authService.getHouseholdId();
    if (householdId) {
      this.pendingLoad = this.loadHouseholdById(householdId);
      await this.pendingLoad;
    }
  }

  /**
   * Le code ami change chaque jour : s'il a expiré depuis le dernier chargement (app restée
   * ouverte), on recharge le foyer, et le backend renvoie le nouveau code.
   */
  async refreshInviteCodeIfExpired(): Promise<void> {
    const expiry = this.currentHouseholdSubject.value?.inviteLinkExpiry;
    if (expiry && expiry.getTime() <= Date.now()) {
      await this.reload();
    }
  }

  /**
   * Créer un nouveau foyer
   */
  async createHousehold(name: string, _userId?: string, _displayName?: string): Promise<Household> {
    const response = await this.api.postAsync<{ household: BackendHousehold }>('households', { name });
    const household = this.normalize(response.household);
    this.authService.setHouseholdId(household.id);
    this.currentHouseholdSubject.next(household);
    return household;
  }

  /**
   * Rejoindre un foyer via code ami
   */
  async joinHouseholdByCode(inviteCode: string, _userId?: string, _displayName?: string): Promise<Household | null> {
    const response = await this.api.postAsync<{ household: BackendHousehold }>('households/join', {
      inviteCode: inviteCode.trim().toUpperCase()
    });
    const household = this.normalize(response.household);
    this.authService.setHouseholdId(household.id);
    this.currentHouseholdSubject.next(household);
    return household;
  }

  /**
   * Rejoindre un foyer via lien d'invitation (mesnia://join/CODE)
   */
  async joinHouseholdByLink(inviteLink: string, userId?: string, displayName?: string): Promise<Household | null> {
    const code = this.extractCodeFromLink(inviteLink);
    if (!code) {
      throw new Error('Lien d\'invitation invalide');
    }
    return this.joinHouseholdByCode(code, userId, displayName);
  }

  /**
   * Obtenir le foyer actuel.
   * Attend la fin de l'init de l'auth et du chargement en cours : juste après un refresh,
   * lire directement la valeur donnerait `null` alors que l'utilisateur a bien un foyer.
   */
  async getCurrentHousehold(): Promise<Household | null> {
    await this.authService.waitForInit();

    // Un nouveau chargement peut démarrer pendant qu'on attend le précédent
    let pending: Promise<void>;
    do {
      pending = this.pendingLoad;
      await pending;
    } while (pending !== this.pendingLoad);

    return this.currentHouseholdSubject.value;
  }

  /**
   * Obtenir le foyer actuel sous forme d'observable
   */
  getCurrentHousehold$(): Observable<Household | null> {
    return this.currentHousehold$;
  }

  /**
   * Obtenir tous les foyers de l'utilisateur
   */
  async getHouseholds(): Promise<Household[]> {
    const response = await this.api.getAsync<{ households: BackendHousehold[] }>('households');
    return (response.households || []).map(h => this.normalize(h));
  }

  /**
   * Régénérer le code / lien d'invitation
   */
  async regenerateInviteLink(householdId: string): Promise<{ link: string; code: string }> {
    const response = await this.api.postAsync<{ household: BackendHousehold }>(
      `households/${householdId}/regenerate-invite`,
      {}
    );
    const household = this.normalize(response.household);
    if (this.currentHouseholdSubject.value?.id === householdId) {
      this.currentHouseholdSubject.next(household);
    }
    return { link: household.inviteLink, code: household.inviteCode };
  }

  /**
   * Retirer un membre du foyer
   */
  async removeMember(householdId: string, userId: string): Promise<void> {
    const response = await this.api.deleteAsync<{ household: BackendHousehold }>(
      `households/${householdId}/members/${userId}`
    );
    if (this.currentHouseholdSubject.value?.id === householdId) {
      this.currentHouseholdSubject.next(this.normalize(response.household));
    }
  }

  /**
   * Mettre à jour le rôle d'un membre
   */
  async updateMemberRole(householdId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
    const response = await this.api.putAsync<{ household: BackendHousehold }>(
      `households/${householdId}/members/${userId}`,
      { role }
    );
    if (this.currentHouseholdSubject.value?.id === householdId) {
      this.currentHouseholdSubject.next(this.normalize(response.household));
    }
  }

  /**
   * Quitter un foyer
   */
  async leaveHousehold(householdId: string, _userId?: string): Promise<void> {
    await this.api.deleteAsync(`households/${householdId}/leave`);
    if (this.authService.getHouseholdId() === householdId) {
      this.authService.setHouseholdId(null);
    }
    this.currentHouseholdSubject.next(null);
  }

  /**
   * Définir le foyer actuel (et le household actif de l'utilisateur)
   */
  setCurrentHousehold(household: Household): void {
    this.authService.setHouseholdId(household.id);
    this.currentHouseholdSubject.next(household);
  }

  /**
   * Normalise un foyer backend vers le modèle frontend
   */
  private normalize(h: BackendHousehold): Household {
    const inviteCode = h.inviteCode || '';
    return {
      id: (h._id || h.id) as string,
      name: h.name,
      createdBy: h.createdBy,
      createdAt: new Date(h.createdAt),
      updatedAt: new Date(h.updatedAt),
      inviteCode,
      inviteLink: this.buildInviteLink(inviteCode),
      inviteLinkExpiry: h.inviteCodeExpiresAt ? new Date(h.inviteCodeExpiresAt) : undefined,
      members: (Array.isArray(h.members) ? h.members : []).map(m => this.normalizeMember(m))
    };
  }

  private normalizeMember(m: BackendHouseholdMember): HouseholdMember {
    return {
      userId: m.userId,
      displayName: m.displayName || m.email || 'Membre',
      avatarUrl: m.avatarUrl,
      role: m.role || 'member',
      joinedAt: new Date(m.joinedAt)
    };
  }

  private buildInviteLink(code: string): string {
    return code ? `mesnia://join/${code}` : '';
  }

  private extractCodeFromLink(link: string): string | null {
    if (!link) return null;
    const trimmed = link.trim();
    // Accepte "mesnia://join/CODE" (ou l'ancien "wevy://join/CODE"), ".../join/CODE" ou un code brut
    const match = trimmed.match(/join\/([A-Za-z0-9]+)/);
    if (match) return match[1].toUpperCase();
    if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed.toUpperCase();
    return null;
  }
}
