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
import StudentRecords from './pages/StudentRecords';
import ParentPortal from './pages/ParentPortal';
import PublicReportForm from './pages/PublicReportForm';
import BranchVisit from './pages/BranchVisit';
import ContactBranch from './pages/ContactBranch';
import BranchQrCodes from './pages/BranchQrCodes';
import BranchVisits from './pages/BranchVisits';
import Users from './pages/Users';
import Trips from './pages/Trips';
import TripConsent from './pages/TripConsent';
import Settings from './pages/Settings';
import DeletedComplaints from './pages/DeletedComplaints';
import { ROLES } from './config/roles';
import { isOwner, canSeePlatform } from './config/adminPermissions';
import Calls from './pages/Calls';
import PlatformHome from './pages/platform/PlatformHome';
import Leaves from './pages/platform/Leaves';
import Leads from './pages/platform/Leads';
import CurrentStudents from './pages/platform/CurrentStudents';
import PlatformSettings from './pages/platform/PlatformSettings';
import LeaveRequest from './pages/LeaveRequest';
import JoinInquiry from './pages/JoinInquiry';
import SchoolVisitRequest from './pages/SchoolVisitRequest';

// منصة المكتشف pages: the owner and the users the owner shared them with;
// its settings, the owner only (firestore.rules enforce both).
function OwnerOnly({ children }) {
  const { userData } = useAuthStore();
  if (!userData) return null;
  return isOwner(userData) ? children : <Navigate to="/dashboard" replace />;
}
function PlatformOnly({ children }) {
  const { userData } = useAuthStore();
  if (!userData) return null;
  return canSeePlatform(userData) ? children : <Navigate to="/dashboard" replace />;
}

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
        <Route path="/report" element={<PublicReportForm />} />
        <Route path="/visit" element={<BranchVisit />} />
        <Route path="/contact/:id" element={<ContactBranch />} />
        <Route path="/trip/:code" element={<TripConsent />} />
        <Route path="/leave" element={<LeaveRequest />} />
        <Route path="/join" element={<JoinInquiry />} />
        <Route path="/school-visit" element={<SchoolVisitRequest />} />
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
          <Route path="students" element={<StudentRecords />} />
          <Route path="users" element={
            <ProtectedRoute allowedRoles={[ROLES.ADMIN]} requirePerm="users">
              <Users />
            </ProtectedRoute>
          } />
          <Route path="visits" element={<BranchVisits />} />
          <Route path="trips" element={<Trips />} />
          <Route path="calls" element={<Calls />} />
          <Route path="platform" element={<Navigate to="/platform/home" replace />} />
          <Route path="platform/home" element={<PlatformOnly><PlatformHome /></PlatformOnly>} />
          <Route path="platform/leaves" element={<PlatformOnly><Leaves /></PlatformOnly>} />
          <Route path="platform/leads" element={<PlatformOnly><Leads /></PlatformOnly>} />
          <Route path="platform/students" element={<PlatformOnly><CurrentStudents /></PlatformOnly>} />
          <Route path="platform/settings" element={<OwnerOnly><PlatformSettings /></OwnerOnly>} />
          <Route path="branch-qr" element={
            <ProtectedRoute allowedRoles={[ROLES.ADMIN]} allowPrincipal>
              <BranchQrCodes />
            </ProtectedRoute>
          } />
          <Route path="settings" element={
            <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
              <Settings />
            </ProtectedRoute>
          } />
          <Route path="deleted-complaints" element={
            <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
              <DeletedComplaints />
            </ProtectedRoute>
          } />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
