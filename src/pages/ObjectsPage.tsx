import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Popconfirm, Space, Table, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import { ObjectFormModal } from '../components/ObjectFormModal';
import { deleteObject, fetchObjects, fetchTaskCounts } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CrmObject } from '../types';

const { Title, Text } = Typography;

export function ObjectsPage() {
  const auth = useAuth();
  const isManager = auth.profile?.role === 'manager';

  const [objects, setObjects] = useState<CrmObject[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CrmObject | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loaded, taskCounts] = await Promise.all([fetchObjects(), fetchTaskCounts()]);
      setObjects(loaded);
      setCounts(taskCounts);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (object: CrmObject) => {
    const error = await deleteObject(object.id);
    if (error) message.error(error);
    else void load();
  };

  return (
    <Card>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Объекты
          </Title>
          <Text type="secondary">
            {isManager
              ? 'Стройки компании. Задачи исполнитель видит только в тех объектах, где он назначен.'
              : 'Показаны только объекты, в которых у вас есть задачи.'}
          </Text>
        </div>
        {isManager && (
          <Button type="primary" onClick={() => setCreating(true)}>
            Новый объект
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={objects}
        locale={{ emptyText: 'Объектов пока нет' }}
        columns={[
          { title: 'Название', dataIndex: 'name', render: (name: string, row) => <Link to={`/objects/${row.id}`}>{name}</Link> },
          { title: 'Адрес', dataIndex: 'address' },
          { title: 'Задач', key: 'count', width: 100, render: (_: unknown, row) => counts[row.id] ?? 0 },
          ...(isManager
            ? [
                {
                  title: '',
                  key: 'actions',
                  width: 170,
                  render: (_: unknown, row: CrmObject) => (
                    <Space>
                      <Button size="small" onClick={() => setEditing(row)}>
                        Править
                      </Button>
                      <Popconfirm
                        title="Удалить объект вместе с задачами?"
                        description="Задачи и их история удалятся безвозвратно."
                        okText="Удалить"
                        okButtonProps={{ danger: true }}
                        cancelText="Отмена"
                        onConfirm={() => void remove(row)}
                      >
                        <Button size="small" danger>
                          Удалить
                        </Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      <ObjectFormModal
        open={creating || editing !== null}
        object={editing}
        userId={auth.profile?.id ?? ''}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => void load()}
      />
    </Card>
  );
}
