import { supabase } from './supabase';
import type { CrmObject, Executor, HistoryEntry, Profile, Task, TaskAction, TaskStatus } from '../types';

const TASK_SELECT = '*, object:objects(id, name, address)';

/** Имена постановщиков и исполнителей: отдаются security definer функцией. */
async function fetchNameMap(): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('profile_names');
  if (error) return {};
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as { id: string; full_name: string }[]) map[row.id] = row.full_name;
  return map;
}

function decorate(tasks: Task[], names: Record<string, string>): Task[] {
  return tasks.map((task) => ({
    ...task,
    assignee_name: task.assignee_id ? (names[task.assignee_id] ?? null) : null,
    author_name: names[task.author_id] ?? null,
  }));
}

function errorMessage(error: unknown): string {
  const err = error as { message?: string; details?: string; hint?: string } | null;
  if (!err) return 'Неизвестная ошибка';
  if (err.message === 'invalid login credentials') return 'Неверный email или пароль';
  return err.details ? `${err.message} (${err.details})` : (err.message ?? 'Ошибка запроса');
}

// ------------------------------------------------------------------ auth --

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? errorMessage(error) : null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) return null;
  return (data as Profile) ?? null;
}

// ------------------------------------------------------------------- объекты --

export async function fetchObjects(): Promise<CrmObject[]> {
  const { data, error } = await supabase.from('objects').select('*').order('name');
  if (error) throw new Error(errorMessage(error));
  return (data as CrmObject[]) ?? [];
}

export async function fetchTaskCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('tasks').select('object_id');
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { object_id: string }[]) counts[row.object_id] = (counts[row.object_id] ?? 0) + 1;
  return counts;
}

export async function fetchObject(id: string): Promise<CrmObject | null> {
  const { data, error } = await supabase.from('objects').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return (data as CrmObject) ?? null;
}

export async function createObject(values: { name: string; address: string }, userId: string) {
  const { data, error } = await supabase
    .from('objects')
    .insert({ ...values, created_by: userId })
    .select('*')
    .single();
  return { object: (data as CrmObject) ?? null, error: error ? errorMessage(error) : null };
}

export async function updateObject(id: string, values: { name: string; address: string }) {
  const { error } = await supabase.from('objects').update(values).eq('id', id);
  return { error: error ? errorMessage(error) : null };
}

export async function deleteObject(id: string): Promise<string | null> {
  const { error } = await supabase.from('objects').delete().eq('id', id);
  return error ? errorMessage(error) : null;
}

// -------------------------------------------------------------------- задачи --

export async function fetchObjectTasks(objectId: string): Promise<Task[]> {
  const names = await fetchNameMap();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('object_id', objectId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(errorMessage(error));
  return decorate((data as Task[]) ?? [], names);
}

export async function fetchMyTasks(userId: string, by: 'assignee_id' | 'author_id' = 'assignee_id'): Promise<Task[]> {
  const names = await fetchNameMap();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq(by, userId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(errorMessage(error));
  return decorate((data as Task[]) ?? [], names);
}

export async function fetchTask(id: string): Promise<Task | null> {
  const names = await fetchNameMap();
  const { data, error } = await supabase.from('tasks').select(TASK_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return data ? decorate([data as Task], names)[0] : null;
}

export async function createTask(values: {
  title: string;
  description: string;
  object_id: string;
  assignee_id: string | null;
  author_id: string;
}) {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...values, status: 'new' })
    .select('id')
    .single();
  return { id: (data as { id: string } | null)?.id ?? null, error: error ? errorMessage(error) : null };
}

/** Правка содержимого задачи. Статуса здесь нет и быть не может — только RPC. */
export async function updateTask(id: string, values: { title?: string; description?: string; assignee_id?: string | null }) {
  const { error } = await supabase.from('tasks').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id);
  return { id, error: error ? errorMessage(error) : null };
}

export async function deleteTask(id: string): Promise<string | null> {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  return error ? errorMessage(error) : null;
}

// ------------------------------------------------- статусы, история, действия --

export async function fetchTaskActions(id: string): Promise<TaskAction[]> {
  const { data, error } = await supabase.rpc('task_actions', { t_id: id });
  if (error) return [];
  return (data as TaskAction[]) ?? [];
}

export async function fetchTaskHistory(id: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase.rpc('task_history', { t_id: id });
  if (error) return [];
  return (data as HistoryEntry[]) ?? [];
}

export async function fetchExecutors(): Promise<Executor[]> {
  const { data, error } = await supabase.rpc('list_executors');
  if (error) return [];
  return (data as Executor[]) ?? [];
}

/**
 * Смена статуса. База сама решает, разрешён переход: функция сверяет текущий
 * статус, роль вызывающего и обязательность комментария.
 */
export async function changeTaskStatus(id: string, to: TaskStatus, comment?: string): Promise<string | null> {
  const { error } = await supabase.rpc('set_task_status', { t_id: id, to_s: to, p_comment: comment ?? null });
  return error ? errorMessage(error) : null;
}
