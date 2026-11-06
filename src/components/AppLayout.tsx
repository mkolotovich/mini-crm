import { Button, Layout, Menu, Space, Typography } from 'antd';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { signOut } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_LABELS } from '../lib/statusMeta';

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

export function AppLayout() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.loading) return null;
  if (!auth.user || !auth.profile) return <Navigate to="/login" replace />;

  const isManager = auth.profile.role === 'manager';
  const items = [
    { key: '/objects', label: <Link to="/objects">Объекты</Link> },
    ...(isManager ? [] : [{ key: '/my', label: <Link to="/my">Мои задачи</Link> }]),
  ];

  // активный пункт: /objects/123 должен подсвечивать «Объекты»
  const selected = items.map((i) => i.key).find((key) => location.pathname.startsWith(key)) ?? '/objects';

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <Space size="large">
          <Link to={isManager ? '/objects' : '/my'} className="app-title">
            Объекты и задачи
          </Link>
          <Menu
            mode="horizontal"
            theme="dark"
            selectedKeys={[selected]}
            items={items}
            style={{ borderBottom: 'none', minWidth: 260 }}
          />
        </Space>
        <Space>
          <Text style={{ color: 'rgba(255,255,255,.85)' }}>
            {auth.profile.full_name} · {ROLE_LABELS[auth.profile.role]}
          </Text>
          <Button onClick={() => void signOut()} type="text" style={{ color: '#fff' }}>
            Выйти
          </Button>
        </Space>
      </Header>
      <Content className="app-content">
        <Outlet />
      </Content>
      <Footer className="app-footer">
        <Text type="secondary">
          Права проверяет база: интерфейс показывает только доступные действия, но и без него запрещённый запрос не пройдёт.
        </Text>
      </Footer>
    </Layout>
  );
}
