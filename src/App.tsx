import { Spin } from 'antd';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { ObjectPage } from './pages/ObjectPage';
import { ObjectsPage } from './pages/ObjectsPage';
import { TaskPage } from './pages/TaskPage';
import { useAuth } from './lib/auth';

export default function App() {
  const auth = useAuth();

  if (auth.loading) {
    return (
      <div className="center-screen">
        <Spin size="large" />
      </div>
    );
  }

  const home = auth.profile?.role === 'executor' ? '/my' : '/objects';

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/objects" element={<ObjectsPage />} />
        <Route path="/objects/:id" element={<ObjectPage />} />
        <Route path="/tasks/:id" element={<TaskPage />} />
        <Route path="/my" element={<MyTasksPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
