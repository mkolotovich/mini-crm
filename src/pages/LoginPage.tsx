import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { Navigate, useNavigate } from 'react-router-dom';
import { signIn } from '../lib/api';
import { useAuth } from '../lib/auth';

const { Title, Text } = Typography;

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (auth.loading) return null;
  if (auth.user) return <Navigate to="/" replace />;

  return (
    <div className="login-page">
      <Card className="login-card">
        <Title level={3} style={{ marginTop: 0 }}>
          Объекты и задачи
        </Title>
        <Text type="secondary">Вход по email и паролю</Text>

        {error && <Alert type="error" message={error} style={{ marginTop: 16 }} />}

        <Form
          layout="vertical"
          style={{ marginTop: 16 }}
          onFinish={async ({ email, password }) => {
            setLoading(true);
            setError(null);
            const err = await signIn(email, password);
            setLoading(false);
            if (err) setError(err);
            else navigate('/', { replace: true });
          }}
        >
          <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email', message: 'Нужен корректный email' }]}>
            <Input autoComplete="username" placeholder="manager@crm.test" />
          </Form.Item>
          <Form.Item label="Пароль" name="password" rules={[{ required: true, message: 'Нужен пароль' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            Войти
          </Button>
        </Form>
      </Card>
    </div>
  );
}
