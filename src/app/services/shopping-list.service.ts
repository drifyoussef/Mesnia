import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { tap, distinctUntilChanged, map } from 'rxjs/operators';
import { ShoppingList, ShoppingListItem, ShoppingListGroup } from '../models/shopping-list.model';
import { Recipe } from '../models/recipe.model';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { RealtimeService } from './realtime.service';

// Interfaces pour les réponses du backend
interface BackendShoppingList {
  _id?: string;
  id?: string;
  householdId: string;
  items: BackendShoppingListItem[];
  recipeIds: string[];
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt?: string | Date;
  status: 'active' | 'completed';
}

interface BackendShoppingListItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category?: 'produce' | 'meat' | 'dairy' | 'pantry' | 'spices' | 'other';
  isChecked?: boolean;
  checked?: boolean;
  addedManually?: boolean;
  recipeId?: string;
  recipeName?: string;
  createdAt: string | Date;
}

interface ApiResponse<T> {
  shoppingList?: T;
  [key: string]: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class ShoppingListService {
  private currentListSubject = new BehaviorSubject<ShoppingList | null>(null);
  public currentList$ = this.currentListSubject.asObservable().pipe(
    distinctUntilChanged()
  );

  private apiUrl = `${environment.apiUrl}/shopping`;

  constructor(private http: HttpClient, private authService: AuthService, realtime: RealtimeService) {
    // Someone else changed the list (at the shop together...): show it right away
    realtime.changesOf('shopping').subscribe(() => this.loadCurrentList());

    // Recharge la liste dès que l'utilisateur (et donc son household) change
    this.authService.currentUser$.subscribe(user => {
      if (user?.householdId) {
        this.loadCurrentList();
      } else {
        // Déconnexion : on vide la liste en mémoire pour ne rien fuiter
        this.currentListSubject.next(null);
      }
    });
  }

  /**
   * Identifiant du household de l'utilisateur connecté
   */
  private get householdId(): string | null {
    return this.authService.getHouseholdId();
  }

  /**
   * Charge la liste de course actuelle depuis le backend
   */
  private loadCurrentList() {
    if (!this.householdId) return;
    this.getCurrentList().subscribe();
  }

  /**
   * Récupère la liste de course active
   */
  getCurrentList(householdId?: string): Observable<ShoppingList> {
    const hId = householdId || this.householdId;
    return this.http.get<ApiResponse<BackendShoppingList>>(`${this.apiUrl}/${hId}`).pipe(
      map(response => this.normalizeList(response.shoppingList!)),
      tap(list => this.currentListSubject.next(list))
    );
  }

  /**
   * Snapshot de la liste actuelle
   */
  getCurrentListSnapshot(): ShoppingList | null {
    return this.currentListSubject.value;
  }

  /**
   * Ajouter un article manuel à la liste
   */
  async addManualItem(
    name: string, 
    quantity: number, 
    unit: string,
    category?: 'produce' | 'meat' | 'dairy' | 'pantry' | 'spices' | 'other'
  ): Promise<ShoppingList> {
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<BackendShoppingList>>(
          `${this.apiUrl}/${this.householdId}/add-item`,
          { name, quantity, unit, category }
        )
      );

      if (response?.shoppingList) {
        const normalized = this.normalizeList(response.shoppingList);
        this.currentListSubject.next(normalized);
        return normalized;
      }
      throw new Error('Invalid response');
    } catch (error) {
      console.error('Error adding item:', error);
      throw error;
    }
  }

  /**
   * Cocher/décocher un article
   */
  async toggleItem(itemId: string): Promise<void> {
    const currentList = this.currentListSubject.value;
    if (!currentList) return;

    const item = currentList.items.find(i => i.id === itemId);
    if (!item) return;

    try {
      const response = await firstValueFrom(
        this.http.patch<ApiResponse<BackendShoppingList>>(
          `${this.apiUrl}/${this.householdId}/item/${itemId}`,
          { isChecked: !item.isChecked }
        )
      );

      if (response?.shoppingList) {
        const normalized = this.normalizeList(response.shoppingList);
        this.currentListSubject.next(normalized);
      }
    } catch (error) {
      console.error('Error toggling item:', error);
      throw error;
    }
  }

  /**
   * Supprimer un article
   */
  async removeItem(itemId: string): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<BackendShoppingList>>(
          `${this.apiUrl}/${this.householdId}/item/${itemId}`
        )
      );

      if (response?.shoppingList) {
        const normalized = this.normalizeList(response.shoppingList);
        this.currentListSubject.next(normalized);
      }
    } catch (error) {
      console.error('Error deleting item:', error);
      throw error;
    }
  }

  /**
   * Ajouter une recette à la liste de course
   */
  async addRecipeToList(recipe: Recipe): Promise<ShoppingList> {
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<BackendShoppingList>>(
          `${this.apiUrl}/${this.householdId}/add-recipe`,
          { recipeId: recipe.id }
        )
      );

      if (response?.shoppingList) {
        const normalized = this.normalizeList(response.shoppingList);
        this.currentListSubject.next(normalized);
        return normalized;
      }
      throw new Error('Invalid response');
    } catch (error) {
      console.error('Error adding recipe:', error);
      throw error;
    }
  }

  /**
   * Compléter la liste de course
   */
  async completeList(): Promise<ShoppingList> {
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<BackendShoppingList>>(
          `${this.apiUrl}/${this.householdId}/complete`,
          {}
        )
      );

      if (response?.shoppingList) {
        const normalized = this.normalizeList(response.shoppingList);
        this.currentListSubject.next(normalized);
        return normalized;
      }
      throw new Error('Invalid response');
    } catch (error) {
      console.error('Error completing list:', error);
      throw error;
    }
  }

  /**
   * Vider complètement la liste
   */
  async clearList(): Promise<ShoppingList> {
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<BackendShoppingList>>(
          `${this.apiUrl}/${this.householdId}/clear`
        )
      );

      if (response?.shoppingList) {
        const normalized = this.normalizeList(response.shoppingList);
        this.currentListSubject.next(normalized);
        return normalized;
      }
      throw new Error('Invalid response');
    } catch (error) {
      console.error('Error clearing list:', error);
      throw error;
    }
  }

  /**
   * Normalise la réponse du backend au format attendu
   */
  private normalizeList(backendList: BackendShoppingList): ShoppingList {
    return {
      id: (backendList._id || backendList.id) as string | undefined,
      _id: backendList._id as string | undefined,
      householdId: backendList.householdId as string,
      items: (Array.isArray(backendList.items) ? backendList.items : []).map(this.normalizeItem.bind(this)),
      recipeIds: (Array.isArray(backendList.recipeIds) ? backendList.recipeIds : []) as string[],
      createdAt: new Date(backendList.createdAt),
      updatedAt: new Date(backendList.updatedAt),
      completedAt: backendList.completedAt ? new Date(backendList.completedAt) : undefined,
      status: backendList.status as 'active' | 'completed'
    };
  }

  /**
   * Normalise un article au format attendu
   */
  private normalizeItem(item: BackendShoppingListItem): ShoppingListItem {
    return {
      id: item.id as string,
      name: item.name as string,
      quantity: item.quantity as number,
      unit: (item.unit || 'pcs') as string,
      category: item.category as 'produce' | 'meat' | 'dairy' | 'pantry' | 'spices' | 'other' | undefined,
      isChecked: (item.isChecked || item.checked || false) as boolean,
      addedManually: item.addedManually as boolean | undefined,
      recipeId: item.recipeId as string | undefined,
      recipeName: item.recipeName as string | undefined,
      createdAt: new Date(item.createdAt)
    };
  }

  /**
   * Les unités disponibles
   */
  getAvailableUnits(): string[] {
    return [
      'pcs',    // pieces
      'g',      // grammes
      'kg',     // kilogrammes
      'ml',     // millilitres
      'L',      // litres
      'cup',    // tasse
      'tbsp',   // cuillère à soupe
      'tsp',    // cuillère à café
      'oz',     // ounces
      'lb',     // livres
      'bunch',  // bottes
      'clove',  // gousses
    ];
  }

  /**
   * Groupe les articles par catégorie
   */
  groupItemsByCategory(items: ShoppingListItem[]): ShoppingListGroup[] {
    const groups: { [key: string]: ShoppingListItem[] } = {};

    items.forEach(item => {
      const category = item.category || 'other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(item);
    });

    return Object.entries(groups).map(([category, categoryItems]) => ({
      category,
      items: categoryItems
    }));
  }
}
