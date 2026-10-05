import { useId } from 'react';
import { Card, HelpText, SegmentedControl } from '../../components/ui/index.js';
import { THEMES, useTheme, type Theme } from '../../lib/theme.js';

const LABELS: Record<Theme, string> = { dark: 'Dark', light: 'Light' };
const OPTIONS = THEMES.map((theme) => ({ value: theme, label: LABELS[theme] }));

/**
 * The colour theme for this browser: the shared segmented control (a fieldset of two native
 * radios). Arrow keys move between them and choose at once; the choice applies without a reload
 * and is remembered in this browser (lib/theme.ts). "System" is reserved for the installer.
 */
export function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  const helpId = useId();
  return (
    <Card title="Appearance">
      <div className="grid gap-1.5">
        <SegmentedControl
          legend="Theme"
          name="theme"
          options={OPTIONS}
          value={theme}
          onChange={setTheme}
          describedBy={helpId}
        />
        <HelpText id={helpId}>
          Dark is the default. The choice applies at once and is remembered in this browser.
        </HelpText>
      </div>
    </Card>
  );
}
