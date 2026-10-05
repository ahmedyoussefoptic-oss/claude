import { Navigate, useLocation } from 'react-router-dom';
import useAuthStore from '../../stores/useAuthStore';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute({ children, allowedRoles, requirePerm, requireDepartment, allowPrincipal }) {
  const { user, role, userData, loading } = useAuthStore();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Preserves where the user was headed (e.g. a shared complaint/ticket
    // link with ?openId=...) so Login.jsx can send them back there instead
    // of always landing on the dashboard.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles) {
    const roleAllowed = allowedRoles.includes(role);
    const permAllowed = !!requirePerm && userData?.perms?.[requirePerm] === true;
    const departmentAllowed = !!requireDepartment && userData?.department === requireDepartment;
    // allowPrincipal also covers quality officers — both are auto-assigned
    // across a branch's records (see findAutoAssignees in functions).
    const principalAllowed = !!allowPrincipal && (userData?.isPrincipal === true || userData?.isQuality === true);
    if (!roleAllowed && !permAllowed && !departmentAllowed && !principalAllowed) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}
