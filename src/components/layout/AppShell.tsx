import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ModelMissingBanner } from '../setup/FirstRun';

/**
 * Desktop-first application frame:
 * [ Sidebar | Topbar
 *             Main content (Outlet) ]
 * Optional right-hand ContextPanel is rendered by individual screens via
 * the <WorkArea> layout helper, keeping the shell itself simple.
 *
 * The platform context lives above this frame (App.tsx) so the first-run gate can
 * cover the whole window without nesting a second provider.
 */
export default function AppShell() {
  return (
    <div className="flex h-full min-h-0 bg-surface-base">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <ModelMissingBanner />
        <main className="min-h-0 flex-1 overflow-y-auto" role="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
