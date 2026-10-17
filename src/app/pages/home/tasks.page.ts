import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon,
  IonButtons, IonBackButton, IonRefresher, IonRefresherContent, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { add, checkmark, checkmarkDoneOutline, close, hourglassOutline, repeatOutline, calendarOutline } from 'ionicons/icons';
import { TaskService } from '../../services/task.service';
import { HouseholdService } from '../../services/household.service';
import { ToastService } from '../../services/toast.service';
import { Task } from '../../models/task.model';
import { HouseholdMember } from '../../models/user.model';
import { Subscription } from 'rxjs';
import { AddTaskModalComponent } from './modals/add-task-modal.component';
import { toIsoDate } from '../../utils/date.utils';

const PERIOD_LABELS = { day: 'Tous les jours', week: 'Chaque semaine', month: 'Chaque mois' };

@Component({
  selector: 'app-tasks',
  templateUrl: './tasks.page.html',
  styleUrls: ['./tasks.page.scss'],
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon,
    IonButtons, IonBackButton, IonRefresher, IonRefresherContent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TasksPage implements OnInit, OnDestroy {
  todayTasks: Task[] = [];
  upcomingTasks: Task[] = [];
  completedTasks: Task[] = [];
  householdMembers: HouseholdMember[] = [];
  removingIds = new Set<string>();
  togglingIds = new Set<string>();
  private subscriptions: Subscription[] = [];

  constructor(
    private taskService: TaskService,
    private householdService: HouseholdService,
    private toastService: ToastService,
    private modalController: ModalController,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({ add, checkmark, checkmarkDoneOutline, close, hourglassOutline, repeatOutline, calendarOutline });
  }

  ngOnInit() {
    this.subscriptions.push(
      this.taskService.todayTasks$.subscribe(tasks => this.update(() => (this.todayTasks = tasks))),
      this.taskService.upcomingTasks$.subscribe(tasks => this.update(() => (this.upcomingTasks = tasks))),
      this.taskService.completedTasks$.subscribe(tasks => this.update(() => (this.completedTasks = tasks))),
      this.householdService.currentHousehold$.subscribe(household => this.update(() => (this.householdMembers = household?.members || [])))
    );
  }

  ngOnDestroy() {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  async refresh(event: CustomEvent) {
    await this.taskService.reload();
    (event.target as HTMLIonRefresherElement).complete();
  }

  /** "Chaque semaine · à tour de rôle", "Mardi 21 octobre", "En retard"... */
  subtitle(task: Task): string {
    const parts: string[] = [];
    if (task.assignedToName) parts.push(task.assignedToName);
    if (task.recurrence) {
      parts.push(PERIOD_LABELS[task.recurrence.every] + (task.recurrence.rotate ? ' · à tour de rôle' : ''));
    }
    if (task.dueDate && !task.done) {
      const today = toIsoDate(new Date());
      if (task.dueDate < today) parts.push('En retard');
      else if (task.dueDate > today) parts.push(this.formatDay(task.dueDate));
    }
    return parts.join(' · ');
  }

  isLate(task: Task): boolean {
    return !task.done && !!task.dueDate && task.dueDate < toIsoDate(new Date());
  }

  async openTaskModal(task?: Task) {
    const modal = await this.modalController.create({
      component: AddTaskModalComponent,
      componentProps: { householdMembers: this.householdMembers, task },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      cssClass: 'auto-sheet'
    });
    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (!data?.input) return;
    try {
      if (task) {
        await this.taskService.updateTask(task.id, data.input);
        this.toastService.success('Tâche modifiée');
      } else {
        await this.taskService.createTask(data.input);
        this.toastService.success('Tâche ajoutée !');
      }
    } catch (error) {
      this.toastService.error(error instanceof Error ? error.message : "Impossible d'enregistrer la tâche");
    }
  }

  toggleTask(task: Task) {
    if (this.togglingIds.has(task.id)) return;

    // Hold the card briefly so its press animation can play before it changes section
    this.togglingIds.add(task.id);
    this.cdr.markForCheck();

    setTimeout(async () => {
      try {
        const updated = await this.taskService.toggleTask(task.id);
        if (task.recurrence) {
          this.toastService.success(updated.assignedToName && updated.assignedTo !== task.assignedTo
            ? `Bravo ! La prochaine fois, c'est au tour de ${updated.assignedToName}`
            : `Bravo ! Prochaine fois : ${this.formatDay(updated.dueDate!)}`);
        }
      } catch (error) {
        this.toastService.error(error instanceof Error ? error.message : 'Impossible de mettre à jour la tâche');
      } finally {
        this.togglingIds.delete(task.id);
        this.cdr.markForCheck();
      }
    }, 180);
  }

  deleteTask(task: Task, event: Event) {
    // Keep the card click (toggle) from firing when the delete badge is tapped
    event.stopPropagation();

    // Slide the card out to the right (Tinder-style) before actually removing it
    this.removingIds.add(task.id);
    this.cdr.markForCheck();

    setTimeout(async () => {
      try {
        await this.taskService.deleteTask(task.id);
      } catch (error) {
        this.toastService.error(error instanceof Error ? error.message : 'Impossible de supprimer la tâche');
      } finally {
        this.removingIds.delete(task.id);
        this.cdr.markForCheck();
      }
    }, 280);
  }

  editTask(task: Task, event: Event) {
    event.stopPropagation();
    this.openTaskModal(task);
  }

  private formatDay(iso: string): string {
    const formatted = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      .format(new Date(`${iso}T12:00:00`));
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  private update(apply: () => void) {
    apply();
    this.cdr.markForCheck();
  }
}
