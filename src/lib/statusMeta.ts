import type { Role, TaskStatus } from '../types';

interface StatusMeta {
  label: string;
  color: string;
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  new: { label: 'Новая', color: 'default' },
  in_progress: { label: 'В работе', color: 'processing' },
  review: { label: 'На проверке', color: 'warning' },
  accepted: { label: 'Принята', color: 'success' },
  rework: { label: 'На доработке', color: 'error' },
};

// Подпись кнопки зависит от пары «откуда → куда»: переход new → in_progress
// и rework → in_progress выглядят одинаково для базы, но по-разному для человека.
const ACTION_LABELS: Record<string, string> = {
  'new→in_progress': 'Взять в работу',
  'rework→in_progress': 'Вернуть в работу',
  'in_progress→review': 'Отправить на проверку',
  'review→accepted': 'Принять',
  'review→rework': 'Вернуть на доработку',
};

export function actionLabel(from: TaskStatus, to: TaskStatus): string {
  return ACTION_LABELS[`${from}→${to}`] ?? STATUS_META[to].label;
}

export const ROLE_LABELS: Record<Role, string> = {
  manager: 'Постановщик',
  executor: 'Исполнитель',
};

export function formatDate(value: string): string {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
