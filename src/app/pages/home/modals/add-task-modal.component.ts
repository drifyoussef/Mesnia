import { Component, OnInit, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButton,
  IonInput, IonButtons, ModalController
} from '@ionic/angular/standalone';
import { TaskService } from '../../../services/task.service';
import { AuthService } from '../../../services/auth.service';
import { HouseholdService } from '../../../services/household.service';
import { HouseholdMember } from '../../../models/user.model';

@Component({
  selector: 'app-add-task-modal',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButton,
    IonInput, IonButtons
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Ajouter une tâche</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" color="danger" (click)="dismiss()">Annuler</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <div class="sheet-body ion-content-scroll-host">
      <div class="form-field">
        <label class="field-label" for="task-title">Titre de la tâche</label>
        <ion-input
          #taskTitleInput
          id="task-title"
          [(ngModel)]="taskTitle"
          name="taskTitle"
          placeholder="Ex: Sortir les poubelles"
          type="text"
        ></ion-input>
      </div>

      <div class="form-field">
        <span class="field-label">Assigner à</span>
        <div class="member-picker">
          @for (member of householdMembers; track member.userId) {
            <button
              class="member-chip"
              [class.selected]="assignedTo === member.userId"
              (click)="assignedTo = member.userId"
            >
              <span class="member-avatar" [style.background]="getAvatarColor(member.displayName)">
                {{ member.displayName.charAt(0).toUpperCase() }}
              </span>
              <span class="member-name">{{ member.displayName }}</span>
            </button>
          }
        </div>
      </div>

      <ion-button
        expand="block"
        (click)="addTask()"
        [disabled]="!taskTitle.trim() || !assignedTo"
        class="mt-6"
      >
        Ajouter la tâche
      </ion-button>
    </div>
  `,
  styles: [`
    .member-picker {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
    }

    .member-chip {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      width: 64px;
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
    }

    .member-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      font-size: 16px;
      font-weight: 700;
      box-shadow: var(--shadow-sm);
      border: 3px solid transparent;
      transition: border-color 0.15s ease, transform 0.15s ease;
    }

    .member-chip.selected .member-avatar {
      border-color: var(--ion-color-primary);
      transform: scale(1.08);
    }

    .member-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--ion-color-medium);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }

    .member-chip.selected .member-name {
      color: var(--ion-color-primary);
    }

    .mt-6 {
      margin-top: 24px;
    }
  `]
})
export class AddTaskModalComponent implements OnInit {
  @Input() householdMembers: HouseholdMember[] = [];
  taskTitle: string = '';
  assignedTo: string = '';

  private readonly avatarColors = ['#74B39D', '#4F8A76', '#6FA8DC', '#9FB5AC', '#5C9EA6'];

  constructor(
    private modalController: ModalController,
    private taskService: TaskService,
    private authService: AuthService,
    private householdService: HouseholdService
  ) {}

  ngOnInit() {
    this.initializeComponent();
  }

  private async initializeComponent() {
    // Si pas de members reçus via @Input, les charger
    if (!this.householdMembers || this.householdMembers.length === 0) {
      await this.loadHouseholdMembers();
    }
  }

  async loadHouseholdMembers() {
    const household = await this.householdService.getCurrentHousehold();
    if (household) {
      this.householdMembers = household.members || [];
    }
  }

  getAvatarColor(name: string): string {
    const index = (name || 'U').charCodeAt(0) % this.avatarColors.length;
    return this.avatarColors[index];
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async addTask() {
    if (!this.taskTitle.trim() || !this.assignedTo) {
      console.error('Validation failed - title or assignedTo empty');
      return;
    }

    console.log('Adding task - title:', this.taskTitle, 'assignedTo:', this.assignedTo);
    
    const selectedMember = this.householdMembers.find(m => m.userId === this.assignedTo);
    const household = await this.householdService.getCurrentHousehold();

    const taskData = {
      added: true,
      task: {
        title: this.taskTitle.trim(),
        assignedTo: this.assignedTo,
        assignedToName: selectedMember?.displayName || 'Unknown',
        householdId: household?.id || 'household1'
      }
    };
    
    console.log('Modal dismissing with data:', taskData);
    await this.modalController.dismiss(taskData);
  }
}
