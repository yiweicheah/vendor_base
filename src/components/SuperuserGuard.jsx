import { Navigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';

export default function SuperuserGuard({ children }) {
  const { user, loading } = useAuthStore();
  if (loading)              return null;
  if (!user)                return <Navigate to="/sign-in" replace />;
  if (!user.isSuperuser)    return <Navigate to="/"        replace />;
  return children;
}
