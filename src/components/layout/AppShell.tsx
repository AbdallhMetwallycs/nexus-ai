import { Outlet } from 'react-router-dom';
import { PlatformProvider } from '../../state/PlatformContext';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Desktop-first application frame:
 * [ Sidebar | Topbar
 *             Main content (Outlet) ]
 * Optional right-hand ContextPanel is rendered by individual screens via
 * the <WorkArea> layout helper, keeping the shell itself simple.
 */
export default function AppShell() {
  return (
    <PlatformProvider>
      <div className="flex h-full min-h-0 bg-surface-base">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="min-h-0 flex-1 overflow-y-auto" role="main">
            <Outlet />
          </main>
        </div>
      </div>
    </PlatformProvider>
  );
}
