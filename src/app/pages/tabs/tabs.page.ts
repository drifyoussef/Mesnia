import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { IonTabs, ModalController, NavController, Platform } from '@ionic/angular/standalone';
import { App } from '@capacitor/app';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  standalone: true,
  imports: [IonTabs]
})
export class TabsPage implements OnInit, OnDestroy {
  @ViewChild(IonTabs) private tabs?: IonTabs;
  private backButtonSub?: Subscription;

  constructor(
    private platform: Platform,
    private router: Router,
    private navController: NavController,
    private modalController: ModalController
  ) {}

  ngOnInit() {
    /* Each section (recipes, shopping...) is its own Ionic stack, so on a section's first page
       Ionic has nothing to pop and the Android back gesture did nothing. Above Ionic's own
       handler (priority 0) but below menus and overlays (99, 100), which still close first. */
    this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, async processNextHandler => {
      if (await this.modalController.getTop()) {
        // A modal that opted out of back-to-close (backdropDismiss: false) stays open, app included
        return;
      }
      if (this.tabs?.outlet?.canGoBack()) {
        // Inside a section (e.g. recipe detail): Ionic pops back to the list
        processNextHandler();
      } else if (!this.router.url.startsWith('/tabs/home')) {
        this.navController.navigateBack('/tabs/home');
      } else {
        // Home screen: leave the app like any Android app, keeping its state
        App.minimizeApp();
      }
    });
  }

  ngOnDestroy() {
    this.backButtonSub?.unsubscribe();
  }
}
