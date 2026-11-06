import { useCallback, useEffect, useState } from 'react';
import { Card, Col, Row, Space, Statistic, Typography } from 'antd';
import { TaskTable } from '../components/TaskTable';
import { fetchMyTasks } from '../lib/api';
import { useAuth } from '../lib/auth';
import { STATUS_META } from '../lib/statusMeta';
import type { Task, TaskStatus } from '../types';

const { Title, Text } = Typography;

export function MyTasksPage() {
  const auth = useAuth();
  const isManager = auth.profile?.role === 'manager';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!auth.profile) return;
    setLoading(true);
    try {
      // постановщику показываются задачи, которые он поставил, исполнителю — назначенные ему
      setTasks(await fetchMyTasks(auth.profile.id, isManager ? 'author_id' : 'assignee_id'));
    } finally {
      setLoading(false);
    }
  }, [auth.profile, isManager]);

  useEffect(() => {
    void load();
  }, [load]);

  const byStatus = (status: TaskStatus) => tasks.filter((task) => task.status === status).length;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        {(Object.keys(STATUS_META) as TaskStatus[]).map((status) => (
          <Col key={status} xs={12} sm={8} md={4}>
            <Card size="small">
              <Statistic title={STATUS_META[status].label} value={byStatus(status)} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title={
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {isManager ? 'Поставленные мной задачи' : 'Мои задачи'}
            </Title>
            <Text type="secondary">
              {isManager
                ? 'Задачи, автором которых вы являетесь.'
                : 'Назначенные вам задачи. Чужие задачи в этом списке не появляются и не читаются запросом к базе.'}
            </Text>
          </div>
        }
      >
        <TaskTable tasks={tasks} loading={loading} showObject emptyText="Задач нет" />
      </Card>
    </Space>
  );
}
