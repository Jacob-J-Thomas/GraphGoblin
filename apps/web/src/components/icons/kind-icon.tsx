import type { NodeKind } from '@graphgoblin/contracts';
import { Icon, type IconProps } from './icon.js';

/** The glyph of a node kind (the editor's kind chips; see editor/KindChip.tsx). */
export function KindIcon({ kind, ...props }: Omit<IconProps, 'name'> & { kind: NodeKind }) {
  return <Icon name={kind} {...props} />;
}
