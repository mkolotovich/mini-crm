import { useCallback, useEffect, useState } from 'react';
import { App, Button, Card, Descriptions, Space, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { ObjectFormModal } from '../components/ObjectFormModal';
import { TaskFormModal } from '../components/TaskFormModal';
import { TaskTable } from '../components/TaskTable';
import { deleteTask, fetchObject, fetchObjectTasks } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CrmObject, Task } from '../types';

const { Title, Text } = Typography;

export function ObjectPage() {
  const { message } = App.useApp();
  const { id = '' } = useParams();
  const auth = useAuth();
  const isManager = auth.profile?.role === 'manager';

  const [object, setObject] = useState<CrmObject | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingObject, setEditingObject] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loaded, loadedTasks] = await Promise.all([fetchObject(id), fetchObjectTasks(id)]);
      setObject(loaded);
      setTasks(loadedTasks);
    } catch (error) {
      setObject(null);
      setTasks([]);
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeTask = async (task: Task) => {
    const error = await deleteTask(task.id);
    if (error) message.error(error);
    else void load();
  };

  if (loading) return <Card loading />;

  if (!object) {
    return (
      <Card>
        <Title level={4}>Объект не найден</Title>
        <Text type="secondary">
          Либо его удалили, либо доступа нет: исполнитель видит только те объекты, где назначены его задачи.
        </Text>
        <div style={{ marginTop: 16 }}>
          <Link to="/objects">К списку объектов</Link>
        </div>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={object.name}
        extra={
          isManager && (
            <Space>
              <Button type="primary" onClick={() => setCreatingTask(true)}>
                Новая задача
              </Button>
              <Button onClick={() => setEditingObject(true)}>Править объект</Button>
            </Space>
          )
        }
      >
        <Descriptions
          column={1}
          size="small"
          items={[
            { key: 'address', label: 'Адрес', children: object.address },
            { key: 'created', label: 'Создан', children: new Date(object.created_at).toLocaleDateString('ru-RU') },
          ]}
        />
      </Card>

      <Card title="Задачи объекта">
        <TaskTable
          tasks={tasks}
          emptyText="Задач пока нет"
          isManager={isManager}
          onEdit={setEditingTask}
          onDelete={(task) => void removeTask(task)}
        />
      </Card>

      <ObjectFormModal
        open={editingObject}
        object={object}
        userId={auth.profile?.id ?? ''}
        onClose={() => setEditingObject(false)}
        onSaved={() => void load()}
      />

      <TaskFormModal
        open={creatingTask || editingTask !== null}
        task={editingTask}
        objects={[{ id: object.id, name: object.name }]}
        lockedObjectId={object.id}
        userId={auth.profile?.id ?? ''}
        onClose={() => {
          setCreatingTask(false);
          setEditingTask(null);
        }}
        onSaved={() => void load()}
      />
    </Space>
  );
}
