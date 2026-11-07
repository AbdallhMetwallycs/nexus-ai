import { FlaskConical } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Shown on every screen whose data is fictional. Requirement: "Use clearly
 * labeled mock data" and "Do not pretend mock functionality is connected to
 * a real AI system."
 */
export function DemoNotice({
  text = 'Prototype data — nothing on this screen is connected to a real model, agent, or service.',
  className,
}: {
  text?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-field border border-violet/25 bg-violet/10 px-3 py-1.5 text-2xs font-medium leading-4 text-violet',
        className,
      )}
    >
      <FlaskConical size={12} className="shrink-0" />
      {text}
    </div>
  );
}
