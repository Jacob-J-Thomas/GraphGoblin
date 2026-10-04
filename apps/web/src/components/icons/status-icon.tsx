import type { RunStatus } from '@graphgoblin/contracts';
import { Icon, type IconName, type IconProps } from './icon.js';

const STATUS_ICON: Record<RunStatus, IconName> = {
  queued: 'queued',
  running: 'running',
  waiting: 'wait',
  paused: 'paused',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  exhausted: 'exhausted',
};

/** The glyph of a run status, shown beside the status word so a tone is never colour alone. */
export function StatusIcon({ status, ...props }: Omit<IconProps, 'name'> & { status: RunStatus }) {
  return <Icon name={STATUS_ICON[status]} {...props} />;
}
