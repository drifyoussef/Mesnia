export type TaskPeriod = 'day' | 'week' | 'month';

export interface TaskRecurrence {
  every: TaskPeriod;
  /** Hand the task to the next member each time it is done */
  rotate: boolean;
}

/** A household chore, shared by every member (stored on the server). */
export interface Task {
  id: string;
  householdId: string;
  title: string;
  assignedTo: string | null;
  /** YYYY-MM-DD */
  dueDate?: string | null;
  recurrence?: TaskRecurrence | null;
  done: boolean;
  doneAt?: string;
  doneBy?: string;
  lastDoneAt?: string;
  lastDoneBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;

  // Filled in by the app from the member list
  assignedToName?: string;
  avatarColor?: string;
}

export interface TaskInput {
  title: string;
  assignedTo: string | null;
  dueDate?: string | null;
  recurrence?: TaskRecurrence | null;
}
