import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { BottomNav } from './BottomNav';
import { useModeStore } from '../../store/modeStore';

export function AppShell() {
  const mode = useModeStore(s => s.mode);
  const isParent = mode === 'parent';

  return (
    <div className="min-h-screen flex flex-col bg-star-50">
      <TopBar />
      <div className="flex flex-1 w-full">
        <main className="flex-1 px-4 sm:px-6 lg:px-6 py-6 pb-24">
          <Outlet />
        </main>
      </div>
      {!isParent && <BottomNav />}
    </div>
  );
}
