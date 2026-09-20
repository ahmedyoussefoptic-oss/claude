import { Navigate } from 'react-router-dom';
import useAuthStore from '../../stores/useAuthStore';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute({ children, allowedRoles, requirePerm, requireDepartment }) {
  const { user, role, userData, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles) {
    const roleAllowed = allowedRoles.includes(role);
    const permAllowed = !!requirePerm && userData?.perms?.[requirePerm] === true;
    const departmentAllowed = !!requireDepartment && userData?.department === requireDepartment;
    if (!roleAllowed && !permAllowed && !departmentAllowed) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}
