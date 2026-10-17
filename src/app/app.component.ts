import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { ShareIntakeService } from './services/share-intake.service';
import { PushService } from './services/push.service';
import { RealtimeService } from './services/realtime.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  constructor(shareIntake: ShareIntakeService, push: PushService, _realtime: RealtimeService) {
    // Links shared to the app / mesnia://import deep links open the recipe import
    shareIntake.init();
    // Push notifications (native app only); RealtimeService starts with its injection
    push.init();
  }
}
