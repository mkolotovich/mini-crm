import { Tag } from 'antd';
import { STATUS_META } from '../lib/statusMeta';
import type { TaskStatus } from '../types';

export function StatusTag({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}
