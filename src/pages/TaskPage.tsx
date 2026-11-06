import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Modal, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HistoryTimeline } from '../components/HistoryTimeline';
import { StatusTag } from '../components/StatusTag';
import { TaskFormModal } from '../components/TaskFormModal';
import { changeTaskStatus, deleteTask, fetchTask, fetchTaskActions, fetchTaskHistory } from '../lib/api';
import { useAuth } from '../lib/auth';
import { STATUS_META, actionLabel, formatDate } from '../lib/statusMeta';
import type { HistoryEntry, Task, TaskAction } from '../types';

const { Title, Paragraph, Text } = Typography;

export function TaskPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const isManager = auth.profile?.role === 'manager';

  const [task, setTask] = useState<Task | null>(null);
  const [actions, setActions] = useState<TaskAction[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<TaskAction | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedTask, loadedActions, loadedHistory] = await Promise.all([
        fetchTask(id),
        fetchTaskActions(id),
        fetchTaskHistory(id),
      ]);
      setTask(loadedTask);
      setActions(loadedActions);
      setHistory(loadedHistory);
    } catch (error) {
      message.error((error as Error).message);
      setTask(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async (action: TaskAction, text?: string) => {
    setSaving(true);
    const error = await changeTaskStatus(id, action.to_status, text);
    setSaving(false);
    setPending(null);
    setComment('');
    if (error) {
      message.error(error);
      return;
    }
    message.success(`Статус: ${STATUS_META[action.to_status].label}`);
    void load();
  };

  const onAction = (action: TaskAction) => {
    if (action.comment_required) {
      setPending(action);
      return;
    }
    void apply(action);
  };

  if (loading) return <Card loading />;

  if (!task) {
    return (
      <Card>
        <Alert
          type="warning"
          showIcon
          message="Задача недоступна"
          description="Её могли удалить, либо она назначена другому исполнителю: чужие задачи не читаются, даже если знать идентификатор."
        />
        <div style={{ marginTop: 16 }}>
          <Link to="/objects">К списку объектов</Link>
        </div>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={
          <Space>
            <StatusTag status={task.status} />
            <Text>{task.title}</Text>
          </Space>
        }
        extra={
          isManager && (
            <Space>
              <Button onClick={() => setEditing(true)}>Править</Button>
              <Popconfirm
                title="Удалить задачу?"
                description="История изменений удалится вместе с ней."
                okText="Удалить"
                okButtonProps={{ danger: true }}
                cancelText="Отмена"
                onConfirm={async () => {
                  const error = await deleteTask(task.id);
                  if (error) message.error(error);
                  else navigate(`/objects/${task.object_id}`);
                }}
              >
                <Button danger>Удалить</Button>
              </Popconfirm>
            </Space>
          )
        }
      >
        <Descriptions
          column={2}
          size="small"
          items={[
            {
              key: 'object',
              label: 'Объект',
              children: task.object ? <Link to={`/objects/${task.object.id}`}>{task.object.name}</Link> : '—',
            },
            { key: 'address', label: 'Адрес', children: task.object?.address ?? '—' },
            { key: 'assignee', label: 'Исполнитель', children: task.assignee_name ?? '— не назначен —' },
            { key: 'author', label: 'Автор', children: task.author_name ?? '—' },
            { key: 'created', label: 'Создана', children: formatDate(task.created_at) },
            { key: 'updated', label: 'Обновлена', children: formatDate(task.updated_at) },
          ]}
        />
        {task.description ? (
          <Paragraph style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{task.description}</Paragraph>
        ) : (
          <Text type="secondary">Описание не заполнено.</Text>
        )}
      </Card>

      <Card title="Доступные действия">
        {actions.length === 0 ? (
          <Text type="secondary">
            Сейчас вам менять статус этой задачи нельзя. {task.status === 'new' && !isManager
              ? 'Задача ещё не назначена.'
              : task.status === 'review'
                ? 'Ожидает решения постановщика.'
                : task.status === 'accepted'
                  ? 'Задача принята — цикл замкнут.'
                  : ''}
          </Text>
        ) : (
          <Space wrap>
            {actions.map((action) => (
              <Button
                key={action.to_status}
                type={action.to_status === 'accepted' ? 'primary' : 'default'}
                danger={action.to_status === 'rework'}
                loading={saving && pending === null}
                onClick={() => onAction(action)}
              >
                {actionLabel(task.status, action.to_status)}
              </Button>
            ))}
          </Space>
        )}
      </Card>

      <Card
        title="История изменений"
        extra={<Tag>Записывает база, отредактировать нельзя</Tag>}
      >
        <HistoryTimeline entries={history} />
      </Card>

      <Modal
        open={pending !== null}
        title={pending ? actionLabel(task.status, pending.to_status) : ''}
        onCancel={() => {
          setPending(null);
          setComment('');
        }}
        onOk={() => pending && void apply(pending, comment)}
        okText="Отправить"
        cancelText="Отмена"
        okButtonProps={{ danger: true, disabled: comment.trim().length === 0 }}
        confirmLoading={saving}
      >
        <Title level={5} style={{ marginTop: 0 }}>
          Что не так и что исправить
        </Title>
        <Text type="secondary">Комментарий обязателен: он попадёт в историю, и исполнитель увидит его в карточке.</Text>
        <Input.TextArea
          rows={4}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Нет фотофиксации узлов, приложите акты"
          style={{ marginTop: 12 }}
          maxLength={2000}
        />
      </Modal>

      <TaskFormModal
        open={editing}
        task={task}
        objects={task.object ? [{ id: task.object.id, name: task.object.name }] : []}
        lockedObjectId={task.object?.id}
        userId={auth.profile?.id ?? ''}
        onClose={() => setEditing(false)}
        onSaved={() => void load()}
      />
    </Space>
  );
}
