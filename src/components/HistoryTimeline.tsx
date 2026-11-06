import { Timeline, Typography } from 'antd';
import { STATUS_META, formatDate } from '../lib/statusMeta';
import type { HistoryEntry } from '../types';

const { Text } = Typography;

export function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <Text type="secondary">Истории пока нет.</Text>;

  return (
    <Timeline
      items={entries.map((entry) => ({
        color: entry.to_status === 'accepted' ? 'green' : entry.to_status === 'rework' ? 'red' : 'blue',
        children: (
          <div>
            <div>
              <Text strong>
                {entry.from_status ? `${STATUS_META[entry.from_status].label} → ${STATUS_META[entry.to_status].label}` : `Создана: ${STATUS_META[entry.to_status].label}`}
              </Text>
            </div>
            <Text type="secondary">
              {entry.actor_name ?? 'Неизвестный'} · {formatDate(entry.created_at)}
            </Text>
            {entry.comment && (
              <blockquote className="history-comment">
                <Text>{entry.comment}</Text>
              </blockquote>
            )}
          </div>
        ),
      }))}
    />
  );
}
