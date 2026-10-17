import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { Task, TaskInput } from '../models/task.model';
import { HouseholdMember } from '../models/user.model';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { HouseholdService } from './household.service';
import { RealtimeService } from './realtime.service';
import { toIsoDate } from '../utils/date.utils';
import { memberColor } from '../utils/member.utils';

/** Tasks stored on the phone before they were shared (read once, uploaded, then removed) */
const LEGACY_STORAGE_KEY = 'wevy_tasks';

/** Household chores, shared by every member through the server. */
@Injectable({
  providedIn: 'root'
})
export class TaskService {
  private tasksSubject = new BehaviorSubject<Task[]>([]);
  private members: HouseholdMember[] = [];
  private householdId: string | null = null;

  /** Every task, with the assignee's name and color */
  readonly tasks$: Observable<Task[]> = combineLatest([this.tasksSubject, this.householdService.currentHousehold$]).pipe(
    map(([tasks, household]) => {
      this.members = household?.members || [];
      return tasks.map(task => this.decorate(task));
    })
  );

  /** To do now: open tasks without a date, or due today or earlier */
  readonly todayTasks$ = this.tasks$.pipe(map(tasks => tasks.filter(task => this.isDueNow(task))));
  /** Open tasks planned later (a recurring task waits here for its next date) */
  readonly upcomingTasks$ = this.tasks$.pipe(map(tasks => tasks.filter(task => !task.done && !this.isDueNow(task))));
  readonly completedTasks$ = this.tasks$.pipe(map(tasks => tasks.filter(task => task.done)));

  constructor(
    private api: ApiService,
    private authService: AuthService,
    private householdService: HouseholdService,
    realtime: RealtimeService
  ) {
    this.authService.currentUser$.subscribe(user => {
      const householdId = user?.householdId || null;
      if (householdId === this.householdId) return;
      this.householdId = householdId;
      this.tasksSubject.next([]);
      if (householdId) this.load(householdId, true);
    });
    realtime.changesOf('tasks').subscribe(() => {
      if (this.householdId) this.load(this.householdId, false);
    });
  }

  /** Snapshot of the tasks to do now */
  getTodayTasks(): Task[] {
    return this.tasksSubject.value.filter(task => this.isDueNow(task)).map(task => this.decorate(task));
  }

  async reload(): Promise<void> {
    if (this.householdId) await this.load(this.householdId, false);
  }

  async createTask(input: TaskInput): Promise<Task> {
    const { task } = await this.api.postAsync<{ task: Task }>(`tasks/${this.requireHousehold()}`, input);
    this.tasksSubject.next([...this.tasksSubject.value, task]);
    return this.decorate(task);
  }

  async updateTask(taskId: string, input: TaskInput): Promise<Task> {
    const { task } = await this.api.putAsync<{ task: Task }>(`tasks/${this.requireHousehold()}/${taskId}`, input);
    this.replace(task);
    return this.decorate(task);
  }

  /** Ticks or unticks a task; a recurring one moves on to its next date (and maybe member). */
  async toggleTask(taskId: string): Promise<Task> {
    const { task } = await this.api.postAsync<{ task: Task }>(`tasks/${this.requireHousehold()}/${taskId}/toggle`, {});
    this.replace(task);
    return this.decorate(task);
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.api.deleteAsync(`tasks/${this.requireHousehold()}/${taskId}`);
    this.tasksSubject.next(this.tasksSubject.value.filter(task => task.id !== taskId));
  }

  private async load(householdId: string, importLegacy: boolean) {
    try {
      if (importLegacy) await this.uploadLegacyTasks(householdId);
      const { tasks } = await this.api.getAsync<{ tasks: Task[] }>(`tasks/${householdId}`);
      if (householdId === this.householdId) this.tasksSubject.next(tasks || []);
    } catch (error) {
      console.error('Error loading tasks:', error);
    }
  }

  /**
   * Tasks used to live only on the phone. The ones the user created (ids "task-...") are
   * uploaded once to their household; the demo tasks of the first versions are dropped.
   */
  private async uploadLegacyTasks(householdId: string) {
    let legacy: { id?: string; title?: string; assignedTo?: string; isCompleted?: boolean; householdId?: string }[];
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]');
    } catch {
      legacy = [];
    }
    const mine = legacy.filter(task => task.id?.startsWith('task-') && task.householdId === householdId && task.title);
    if (mine.length > 0) {
      await this.api.postAsync(`tasks/${householdId}/import`, {
        tasks: mine.map(task => ({ title: task.title, assignedTo: task.assignedTo, done: task.isCompleted === true }))
      });
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  private replace(task: Task) {
    this.tasksSubject.next(this.tasksSubject.value.map(existing => (existing.id === task.id ? task : existing)));
  }

  private decorate(task: Task): Task {
    const name = this.members.find(member => member.userId === task.assignedTo)?.displayName;
    return { ...task, assignedToName: name, avatarColor: memberColor(name) };
  }

  private isDueNow(task: Task): boolean {
    return !task.done && (!task.dueDate || task.dueDate <= toIsoDate(new Date()));
  }

  private requireHousehold(): string {
    if (!this.householdId) throw new Error('Rejoins ou crée un foyer pour partager des tâches');
    return this.householdId;
  }
}
