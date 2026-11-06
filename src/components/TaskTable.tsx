import { Button, Popconfirm, Space, Table } from 'antd';
import { Link } from 'react-router-dom';
import { StatusTag } from './StatusTag';
import { STATUS_META } from '../lib/statusMeta';
import type { Task } from '../types';

export function TaskTable({
  tasks,
  loading,
  emptyText,
  showObject = false,
  isManager = false,
  onEdit,
  onDelete,
}: {
  tasks: Task[];
  loading?: boolean;
  emptyText: string;
  showObject?: boolean;
  isManager?: boolean;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
}) {
  const columns = [
    {
      title: 'Задача',
      dataIndex: 'title',
      render: (title: string, task: Task) => <Link to={`/tasks/${task.id}`}>{title}</Link>,
    },
    ...(showObject
      ? [
          {
            title: 'Объект',
            width: 200,
            render: (_: unknown, task: Task) =>
              task.object ? <Link to={`/objects/${task.object.id}`}>{task.object.name}</Link> : '—',
          },
        ]
      : []),
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 140,
      render: (status: Task['status']) => <StatusTag status={status} />,
      filters: Object.entries(STATUS_META).map(([value, meta]) => ({ text: meta.label, value })),
      onFilter: (value: unknown, task: Task) => task.status === value,
    },
    {
      title: 'Исполнитель',
      width: 170,
      render: (_: unknown, task: Task) => task.assignee_name ?? '— не назначен —',
    },
    {
      title: 'Обновлена',
      dataIndex: 'updated_at',
      width: 150,
      render: (value: string) => new Date(value).toLocaleDateString('ru-RU'),
    },
    ...(isManager && (onEdit || onDelete)
      ? [
          {
            title: '',
            key: 'actions',
            width: 150,
            render: (_: unknown, task: Task) => (
              <Space>
                {onEdit && (
                  <Button size="small" onClick={() => onEdit(task)}>
                    Править
                  </Button>
                )}
                {onDelete && (
                  <Popconfirm
                    title="Удалить задачу?"
                    description="История изменений удалится вместе с ней."
                    okText="Удалить"
                    okButtonProps={{ danger: true }}
                    cancelText="Отмена"
                    onConfirm={() => onDelete(task)}
                  >
                    <Button size="small" danger>
                      Удалить
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <Table
      rowKey="id"
      loading={loading}
      dataSource={tasks}
      pagination={false}
      locale={{ emptyText }}
      columns={columns}
    />
  );
}
