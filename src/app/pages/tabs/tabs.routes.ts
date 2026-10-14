import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const routes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'home',
        loadComponent: () => import('../home/home.page').then(m => m.HomePage)
      },
      {
        path: 'tasks',
        loadComponent: () => import('../home/tasks.page').then(m => m.TasksPage)
      },
      {
        path: 'shopping',
        loadComponent: () => import('../shopping/shopping.page').then(m => m.ShoppingPage)
      },
      {
        path: 'library',
        loadComponent: () => import('../library/library.page').then(m => m.LibraryPage)
      },
      {
        path: 'library/recipe/:id',
        loadComponent: () => import('../recipe-detail/recipe-detail.page').then(m => m.RecipeDetailPage)
      },
      {
        path: 'settings',
        loadComponent: () => import('../settings/settings.page').then(m => m.SettingsPage)
      },
      {
        // Lives under "settings" so both pages share one Ionic tab stack: back from
        // "Mon foyer" returns to Paramètres when that is where the user came from.
        path: 'settings/household',
        loadComponent: () => import('../profile/profile.page').then(m => m.ProfilePage)
      },
      {
        path: 'profile',
        redirectTo: 'settings/household',
        pathMatch: 'full'
      },
      {
        path: 'calendar',
        loadComponent: () => import('../calendar/calendar.page').then(m => m.CalendarPage)
      },
      {
        path: 'trips',
        loadComponent: () => import('../trips/trips.page').then(m => m.TripsPage)
      },
      {
        // Same tab stack as the list: back from a trip returns to it
        path: 'trips/:id',
        loadComponent: () => import('../trips/trip-detail.page').then(m => m.TripDetailPage)
      },
      {
        path: 'documents',
        loadComponent: () => import('../documents/documents.page').then(m => m.DocumentsPage)
      },
      {
        // Same tab stack as the list: back from a category returns to it
        path: 'documents/:category',
        loadComponent: () => import('../documents/document-category.page').then(m => m.DocumentCategoryPage)
      },
      {
        path: 'schedules',
        loadComponent: () => import('../schedules/schedules.page').then(m => m.SchedulesPage)
      },
      {
        path: 'add-recipe',
        loadComponent: () => import('../add-recipe/add-recipe.page').then(m => m.AddRecipePage)
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
      }
    ]
  }
];
