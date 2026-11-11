import { useEffect, useState } from 'react';
import StudentPortal from './pages/StudentPortal';
import AdminBackend from './pages/AdminBackend';

export default function App() {
  const [route, setRoute] = useState<string>(() =>
    window.location.hash.startsWith('#/admin') ? 'admin' : 'student'
  );

  useEffect(() => {
    const onHash = () => {
      setRoute(window.location.hash.startsWith('#/admin') ? 'admin' : 'student');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (route === 'admin') {
    return <AdminBackend onGoStudent={() => { window.location.hash = '#/'; }} />;
  }

  return <StudentPortal onGoAdmin={() => { window.location.hash = '#/admin'; }} />;
}
