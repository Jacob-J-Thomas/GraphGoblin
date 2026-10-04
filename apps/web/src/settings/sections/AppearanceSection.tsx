import { Card, HelpText } from '../../components/ui/index.js';
import { THEMES, useTheme, type Theme } from '../../lib/theme.js';
import { cn } from '../../lib/utils.js';

const LABELS: Record<Theme, string> = { dark: 'Dark', light: 'Light' };

/**
 * The colour theme for this browser: two native radios in a fieldset, drawn as a segmented
 * control. Arrow keys move between them and choose at once; the choice applies without a reload
 * and is remembered in this browser (lib/theme.ts). "System" is reserved for the installer.
 */
export function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  return (
    <Card title="Appearance">
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Theme</legend>
        <div className="inline-flex w-fit gap-0.5 rounded-md border border-strong bg-surface-sunken p-[3px]">
          {THEMES.map((option) => (
            <label key={option} className="relative inline-flex">
              <input
                type="radio"
                name="theme"
                value={option}
                checked={theme === option}
                onChange={() => setTheme(option)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'inline-flex h-7 cursor-pointer items-center rounded-[6px] px-3 text-sm font-medium',
                  'text-muted transition-colors hover:bg-surface-hover hover:text-default',
                  'peer-checked:bg-accent-subtle peer-checked:font-semibold peer-checked:text-accent-on-subtle',
                  'peer-checked:ring-1 peer-checked:ring-accent-strong peer-checked:ring-inset',
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1',
                  'peer-focus-visible:outline-focus forced-colors:peer-checked:outline',
                )}
              >
                {LABELS[option]}
              </span>
            </label>
          ))}
        </div>
        <HelpText>
          Dark is the default. The choice applies at once and is remembered in this browser.
        </HelpText>
      </fieldset>
    </Card>
  );
}
