import { Navigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';

export default function AuthGuard({ children }) {
  const { user, loading } = useAuthStore();
  const { org }           = useOrgStore();

  if (loading)            return null;
  if (!user)              return <Navigate to="/sign-in"  replace />;
  if (user.isSuperuser)   return <Navigate to="/admin"    replace />;
  if (!org)               return <Navigate to="/no-access" replace />;

  return children;
}
