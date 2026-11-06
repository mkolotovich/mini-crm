export type Role = 'manager' | 'executor';

export type TaskStatus = 'new' | 'in_progress' | 'review' | 'accepted' | 'rework';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
}

export interface CrmObject {
  id: string;
  name: string;
  address: string;
  created_by: string;
  created_at: string;
  task_count?: number;
}

export interface Executor {
  id: string;
  full_name: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  object_id: string;
  assignee_id: string | null;
  status: TaskStatus;
  author_id: string;
  created_at: string;
  updated_at: string;
  object?: { id: string; name: string; address: string } | null;
  assignee_name?: string | null;
  author_name?: string | null;
}

export interface HistoryEntry {
  id: number;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  actor_name: string | null;
  actor_role: Role;
  comment: string | null;
  created_at: string;
}

export interface TaskAction {
  to_status: TaskStatus;
  comment_required: boolean;
}
