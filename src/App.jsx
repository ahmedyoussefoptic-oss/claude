import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './stores/useAuthStore';
import Login from './components/auth/Login';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import ComplaintsList from './pages/ComplaintsList';
import LostFound from './pages/LostFound';
import TechSupport from './pages/TechSupport';
import FlowMap from './pages/FlowMap';
import Search from './pages/Search';
import Reports from './pages/Reports';
import ParentPortal from './pages/ParentPortal';
import Users from './pages/Users';
import Settings from './pages/Settings';
import { ROLES } from './config/roles';

function App() {
  const { initialize } = useAuthStore();

  useEffect(() => {
    const unsubscribe = initialize();
    return () => unsubscribe && unsubscribe();
  }, [initialize]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/track" element={<ParentPortal />} />
        <Route path="/login" element={<Login />} />
        
        {/* Protected Routes */}
        <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="complaints" element={<ComplaintsList />} />
          <Route path="lost-found" element={<LostFound />} />
          <Route path="tech-support" element={<TechSupport />} />
          <Route path="flow-map" element={<FlowMap />} />
          <Route path="search" element={<Search />} />
          <Route path="reports" element={<Reports />} />
          <Route path="users" element={
            <ProtectedRoute allowedRoles={[ROLES.ADMIN]} requirePerm="users">
              <Users />
            </ProtectedRoute>
          } />
          <Route path="settings" element={
            <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
              <Settings />
            </ProtectedRoute>
          } />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
