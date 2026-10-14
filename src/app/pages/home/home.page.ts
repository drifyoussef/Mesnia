import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonIcon, IonButtons, IonButton, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkDone, cart, restaurant, sparkles, home, addCircle, calendar, time, airplane, folderOpen, settings, add, close } from 'ionicons/icons';
import { TaskService } from '../../services/task.service';
import { ShoppingListService } from '../../services/shopping-list.service';
import { CalendarService } from '../../services/calendar.service';
import { Subscription, distinctUntilChanged } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { SwipePage } from '../swipe/swipe.page';
import { AddWidgetModalComponent } from './modals/add-widget-modal.component';
import { HomeWidgetCardComponent, HomeWidgetType, WIDGET_TITLES } from './components/home-widget-card.component';

interface AppTile {
  label: string;
  icon: string;
  route?: string;
  action?: 'swipe';
  badge?: number;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonIcon, IonButtons, IonButton,
    HomeWidgetCardComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePage implements OnInit, OnDestroy {
  private tasksSubscription?: Subscription;
  private shoppingSubscription?: Subscription;
  private calendarSubscription?: Subscription;
  displayName: string = '';
  todayLabel: string = '';

  appTiles: AppTile[] = [];
  homeWidgets: HomeWidgetType[] = [];
  readonly widgetTitles = WIDGET_TITLES;

  private static readonly WIDGETS_STORAGE_KEY = 'wevy_home_widgets';

  private static readonly TILE_DEFS: Omit<AppTile, 'badge'>[] = [
    { label: 'Tâches', icon: 'checkmark-done', route: '/tabs/tasks' },
    { label: 'Courses', icon: 'cart', route: '/tabs/shopping' },
    { label: 'Recettes', icon: 'restaurant', route: '/tabs/library' },
    { label: 'Découvrir une recette', icon: 'sparkles', action: 'swipe' },
    { label: 'Ajouter une recette', icon: 'add-circle', route: '/tabs/add-recipe' },
    { label: 'Calendrier', icon: 'calendar', route: '/tabs/calendar' },
    { label: 'Horaires', icon: 'time', route: '/tabs/schedules' },
    { label: 'Voyage', icon: 'airplane', route: '/tabs/trips' },
    { label: 'Documents', icon: 'folder-open', route: '/tabs/documents' },
    { label: 'Mon foyer', icon: 'home', route: '/tabs/settings/household' },
  ];

  constructor(
    private taskService: TaskService,
    private shoppingService: ShoppingListService,
    private calendarService: CalendarService,
    private router: Router,
    private authService: AuthService,
    private modalController: ModalController,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({ checkmarkDone, cart, restaurant, sparkles, home, addCircle, calendar, time, airplane, folderOpen, settings, add, close });
    this.appTiles = HomePage.TILE_DEFS.map(tile => ({ ...tile }));
    this.todayLabel = this.formatToday();
    this.homeWidgets = this.loadHomeWidgets();
  }

  private loadHomeWidgets(): HomeWidgetType[] {
    try {
      const raw = localStorage.getItem(HomePage.WIDGETS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private saveHomeWidgets() {
    localStorage.setItem(HomePage.WIDGETS_STORAGE_KEY, JSON.stringify(this.homeWidgets));
  }

  private formatToday(): string {
    const formatted = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  async ngOnInit() {
    this.shoppingSubscription = this.shoppingService.currentList$
      .pipe(
        distinctUntilChanged((prev, curr) =>
          JSON.stringify(prev?.items) === JSON.stringify(curr?.items)
        )
      )
      .subscribe(() => {
        this.updateShoppingBadge();
        this.cdr.markForCheck();
      });

    this.tasksSubscription = this.taskService.tasks$.subscribe(() => {
      this.updateTasksBadge();
      this.cdr.markForCheck();
    });

    this.calendarSubscription = this.calendarService.events$.subscribe(() => {
      this.updateCalendarBadge();
      this.cdr.markForCheck();
    });

    this.updateTasksBadge();
    this.updateShoppingBadge();
    this.updateCalendarBadge();
    this.displayName = await this.authService.getDisplayName();
  }

  ngOnDestroy() {
    this.tasksSubscription?.unsubscribe();
    this.shoppingSubscription?.unsubscribe();
    this.calendarSubscription?.unsubscribe();
  }

  private updateTasksBadge() {
    const uncompletedTasks = this.taskService.getTodayTasks();
    this.setTileBadge('Tâches', uncompletedTasks.length);
  }

  private updateShoppingBadge() {
    const shoppingList = this.shoppingService.getCurrentListSnapshot();
    const uncheckedItems = (shoppingList?.items || []).filter(item => !item.isChecked);
    this.setTileBadge('Courses', uncheckedItems.length);
  }

  private updateCalendarBadge() {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const count = this.calendarService.getEvents().filter(event => event.date.startsWith(monthPrefix)).length;
    this.setTileBadge('Calendrier', count);
  }

  private setTileBadge(label: string, count: number) {
    const tile = this.appTiles.find(t => t.label === label);
    if (tile) {
      tile.badge = count > 0 ? count : undefined;
      this.appTiles = [...this.appTiles];
    }
  }

  async goToTile(tile: AppTile) {
    if (tile.action === 'swipe') {
      await this.openSwipeMode();
    } else if (tile.route) {
      this.router.navigate([tile.route]);
    }
  }

  goTo(route: string) {
    this.router.navigate([route]);
  }

  goToSettings() {
    this.router.navigate(['/tabs/settings']);
  }

  async openAddWidgetModal() {
    const modal = await this.modalController.create({
      component: AddWidgetModalComponent,
      componentProps: { existingWidgets: this.homeWidgets },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      cssClass: 'auto-sheet'
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (data?.type && !this.homeWidgets.includes(data.type)) {
      this.homeWidgets = [...this.homeWidgets, data.type];
      this.saveHomeWidgets();
      this.cdr.markForCheck();
    }
  }

  removeWidget(type: HomeWidgetType, event: Event) {
    event.stopPropagation();
    this.homeWidgets = this.homeWidgets.filter(w => w !== type);
    this.saveHomeWidgets();
  }

  private async openSwipeMode() {
    const modal = await this.modalController.create({
      component: SwipePage,
      cssClass: 'fullscreen-modal',
      backdropDismiss: false
    });
    await modal.present();
  }

}
