import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject, filter, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { TokenStorageService } from '../core/token-storage.service';
import { AuthService } from './auth.service';

/** What changed in the household (see backend/src/services/realtime.js) */
export type RealtimeTopic = 'shopping' | 'tasks' | 'meal-plan' | 'calendar' | 'swipe' | 'household';

interface ChangeEvent {
  topic: RealtimeTopic;
  by: string | null;
}

const MAX_RETRY_DELAY_MS = 30000;

/**
 * Live updates of the household: one Server-Sent Events stream per household, opened while a
 * user is signed in. The stream only says which part changed; each service reloads its data.
 * fetch() rather than EventSource: EventSource cannot send the Authorization header.
 */
@Injectable({
  providedIn: 'root'
})
export class RealtimeService {
  private changes = new Subject<ChangeEvent>();
  private controller: AbortController | null = null;
  private householdId: string | null = null;
  private userId: string | null = null;
  private retryDelay = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private authService: AuthService, private tokenStorage: TokenStorageService, private zone: NgZone) {
    this.authService.currentUser$.subscribe(user => {
      const householdId = user?.householdId || null;
      this.userId = user?.id || null;
      if (householdId !== this.householdId) {
        this.householdId = householdId;
        this.restart();
      }
    });

    // Back from the background: the stream was probably cut, reconnect right away
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.householdId && !this.controller) {
        this.retryDelay = 1000;
        this.restart();
      }
    });
  }

  /**
   * Changes of a topic made by someone else (your own changes are already on screen).
   * Also emits after a reconnection, since changes may have been missed in between.
   */
  changesOf(topic: RealtimeTopic): Observable<void> {
    return this.changes.pipe(
      filter(event => event.topic === topic && (event.by === null || event.by !== this.userId)),
      map(() => undefined)
    );
  }

  private restart() {
    this.controller?.abort();
    this.controller = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.householdId) {
      // Outside Angular: a long-lived stream must not keep change detection busy
      this.zone.runOutsideAngular(() => this.connect(this.householdId!));
    }
  }

  private async connect(householdId: string) {
    const token = this.tokenStorage.token;
    if (!token) return;
    const controller = new AbortController();
    this.controller = controller;

    try {
      const response = await fetch(`${environment.apiUrl}/events/${householdId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: controller.signal
      });
      if (!response.ok || !response.body) throw new Error(`Stream refused (${response.status})`);

      this.retryDelay = 1000;
      // Anything may have changed while disconnected
      this.emitAll();

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let separator;
        while ((separator = buffer.indexOf('\n\n')) >= 0) {
          this.handleMessage(buffer.slice(0, separator));
          buffer = buffer.slice(separator + 2);
        }
      }
      throw new Error('Stream closed');
    } catch {
      if (controller.signal.aborted || this.controller !== controller) return;
      this.controller = null;
      // Reconnect, waiting longer after each failure (server asleep, no network...)
      this.retryTimer = setTimeout(() => this.restart(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
    }
  }

  private handleMessage(message: string) {
    const data = message.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim();
    if (!data) return;
    try {
      const event = JSON.parse(data) as ChangeEvent;
      this.zone.run(() => this.changes.next(event));
    } catch {
      // Not a change event (comment, heartbeat...)
    }
  }

  private emitAll() {
    const topics: RealtimeTopic[] = ['shopping', 'tasks', 'meal-plan', 'calendar', 'swipe', 'household'];
    this.zone.run(() => topics.forEach(topic => this.changes.next({ topic, by: null })));
  }
}
