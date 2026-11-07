import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import Dashboard from './pages/Dashboard';
import Chat from './pages/Chat';
import Agents from './pages/Agents';
import Models from './pages/Models';
import Memory from './pages/Memory';
import Knowledge from './pages/Knowledge';
import Tools from './pages/Tools';
import LearningLab from './pages/LearningLab';
import Internet from './pages/Internet';
import Activity from './pages/Activity';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/chat/:conversationId" element={<Chat />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/models" element={<Models />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/learning" element={<LearningLab />} />
        <Route path="/internet" element={<Internet />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
