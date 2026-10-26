import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon,
  IonButtons, IonBackButton, IonModal, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  add, restaurantOutline, searchOutline, heart, timeOutline, flameOutline, sparkles,
  optionsOutline, close, leafOutline, nutritionOutline, barbellOutline, banOutline, heartOutline
} from 'ionicons/icons';
import { RecipeService } from '../../services/recipe.service';
import { Recipe } from '../../models/recipe.model';
import { SwipePage } from '../swipe/swipe.page';

type Difficulty = NonNullable<Recipe['difficulty']>;

interface DietType {
  id: string;
  label: string;
  icon: string;
  /** Recipes have no diet field: a type matches when one of these tags is on the recipe. */
  tags: string[];
}

interface TimeOption {
  id: string;
  label: string;
  matches: (minutes: number) => boolean;
}

const DIET_TYPES: DietType[] = [
  { id: 'vegan', label: 'Vegan', icon: 'leaf-outline', tags: ['vegan', 'végétalien'] },
  // A vegan recipe is vegetarian too
  { id: 'vege', label: 'Végé', icon: 'nutrition-outline', tags: ['végétarien', 'végé', 'veggie', 'vegan', 'végétalien'] },
  { id: 'proteine', label: 'Protéiné', icon: 'barbell-outline', tags: ['protéiné', 'protéines', 'riche en protéines', 'high protein'] },
  { id: 'sans-gluten', label: 'Sans gluten', icon: 'ban-outline', tags: ['sans gluten', 'gluten free'] },
  { id: 'healthy', label: 'Healthy', icon: 'heart-outline', tags: ['healthy', 'santé', 'léger'] },
];

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: 'easy', label: 'Facile' },
  { id: 'medium', label: 'Moyen' },
  { id: 'hard', label: 'Difficile' },
];

const TIME_OPTIONS: TimeOption[] = [
  { id: '15', label: '15 min ou moins', matches: minutes => minutes <= 15 },
  { id: '30', label: '30 min ou moins', matches: minutes => minutes <= 30 },
  { id: '60', label: '1 h ou moins', matches: minutes => minutes <= 60 },
  { id: 'long', label: "Plus d'1 h", matches: minutes => minutes > 60 },
];

const MAX_CARD_TAGS = 2;

interface ActiveFilter {
  key: string;
  label: string;
  clear: () => void;
}

@Component({
  selector: 'app-library',
  templateUrl: './library.page.html',
  styleUrls: ['./library.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon,
    IonButtons, IonBackButton, IonModal
  ]
})
export class LibraryPage implements OnInit {
  readonly dietTypes = DIET_TYPES;
  readonly difficulties = DIFFICULTIES;
  readonly timeOptions = TIME_OPTIONS;
  readonly maxCardTags = MAX_CARD_TAGS;

  recipes: Recipe[] = [];
  filteredRecipes: Recipe[] = [];
  searchTerm = '';
  private firstEnter = true;

  filtersOpen = false;
  selectedDiets = new Set<string>();
  selectedDifficulties = new Set<Difficulty>();
  selectedTime: string | null = null;

  constructor(
    private recipeService: RecipeService,
    private router: Router,
    private modalController: ModalController
  ) {
    addIcons({
      add, restaurantOutline, searchOutline, heart, timeOutline, flameOutline, sparkles,
      optionsOutline, close, leafOutline, nutritionOutline, barbellOutline, banOutline, heartOutline
    });
  }

  ngOnInit() {
    this.loadRecipes();
  }

  /** Ionic keeps this page alive: reload when coming back, e.g. right after importing a recipe. */
  ionViewWillEnter() {
    // The first entry is already covered by ngOnInit
    if (this.firstEnter) {
      this.firstEnter = false;
      return;
    }
    this.loadRecipes();
  }

  async loadRecipes() {
    try {
      this.recipes = await this.recipeService.getRecipes();
      this.applyFilter();
    } catch (error) {
      console.error('Error loading recipes:', error);
    }
  }

  get activeFilterCount(): number {
    return this.selectedDiets.size + this.selectedDifficulties.size + (this.selectedTime ? 1 : 0);
  }

  /** The chips shown under the search bar, each removable on its own. */
  get activeFilters(): ActiveFilter[] {
    return [
      ...DIET_TYPES.filter(diet => this.selectedDiets.has(diet.id)).map(diet => ({
        key: `diet-${diet.id}`,
        label: diet.label,
        clear: () => this.toggleDiet(diet.id)
      })),
      ...DIFFICULTIES.filter(level => this.selectedDifficulties.has(level.id)).map(level => ({
        key: `difficulty-${level.id}`,
        label: level.label,
        clear: () => this.toggleDifficulty(level.id)
      })),
      ...TIME_OPTIONS.filter(option => option.id === this.selectedTime).map(option => ({
        key: `time-${option.id}`,
        label: option.label,
        clear: () => this.selectTime(option.id)
      })),
    ];
  }

  toggleDiet(id: string) {
    this.toggle(this.selectedDiets, id);
    this.applyFilter();
  }

  toggleDifficulty(id: Difficulty) {
    this.toggle(this.selectedDifficulties, id);
    this.applyFilter();
  }

  /** Single choice: tapping the selected option again clears it. */
  selectTime(id: string) {
    this.selectedTime = this.selectedTime === id ? null : id;
    this.applyFilter();
  }

  resetFilters() {
    this.selectedDiets.clear();
    this.selectedDifficulties.clear();
    this.selectedTime = null;
    this.applyFilter();
  }

  /**
   * Search on title + tags (case and accent insensitive, "pates" finds "Pâtes"),
   * then the filters: any selected option within a group, every group that has a selection.
   */
  applyFilter() {
    const term = this.normalize(this.searchTerm.trim());
    const time = TIME_OPTIONS.find(option => option.id === this.selectedTime);

    this.filteredRecipes = this.recipes.filter(recipe => {
      if (term && ![recipe.title, ...(recipe.tags || [])].some(text => this.normalize(text).includes(term))) {
        return false;
      }

      if (this.selectedDiets.size > 0 && !DIET_TYPES.some(diet => this.selectedDiets.has(diet.id) && this.matchesDiet(recipe, diet))) {
        return false;
      }

      if (this.selectedDifficulties.size > 0 && (!recipe.difficulty || !this.selectedDifficulties.has(recipe.difficulty))) {
        return false;
      }

      if (time) {
        const minutes = this.recipeTime(recipe);
        if (minutes === null || !time.matches(minutes)) {
          return false;
        }
      }

      return true;
    });
  }

  /** How many recipes an option would match on its own, shown next to it in the filter sheet. */
  dietCount(diet: DietType): number {
    return this.recipes.filter(recipe => this.matchesDiet(recipe, diet)).length;
  }

  difficultyCount(id: Difficulty): number {
    return this.recipes.filter(recipe => recipe.difficulty === id).length;
  }

  timeCount(option: TimeOption): number {
    return this.recipes.filter(recipe => {
      const minutes = this.recipeTime(recipe);
      return minutes !== null && option.matches(minutes);
    }).length;
  }

  difficultyLabel(difficulty: Difficulty): string {
    return DIFFICULTIES.find(level => level.id === difficulty)?.label ?? '';
  }

  openRecipeDetails(recipe: Recipe) {
    this.router.navigate(['/tabs/library/recipe', recipe.id]);
  }

  async openSwipeMode() {
    const modal = await this.modalController.create({
      component: SwipePage,
      // Fullscreen, so no backdrop to tap: backdropDismiss only lets the Android back gesture close it
      cssClass: 'fullscreen-modal'
    });
    await modal.present();
  }

  private matchesDiet(recipe: Recipe, diet: DietType): boolean {
    const recipeTags = (recipe.tags || []).map(tag => this.normalize(tag));
    return diet.tags.some(tag => recipeTags.includes(this.normalize(tag)));
  }

  private recipeTime(recipe: Recipe): number | null {
    if (recipe.totalTime) {
      return recipe.totalTime;
    }
    const minutes = (recipe.prepTime || 0) + (recipe.cookTime || 0);
    return minutes > 0 ? minutes : null;
  }

  private toggle<T>(set: Set<T>, value: T) {
    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
  }

  private normalize(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
}
