import { useId } from 'react';
import { Card, HelpText, Legend, SegmentedControl } from '../../components/ui/index.js';
import { FONTS, useFont, type Font } from '../../lib/font.js';
import { THEMES, useTheme, type Theme } from '../../lib/theme.js';
import { cn } from '../../lib/utils.js';

const LABELS: Record<Theme, string> = { dark: 'Dark', light: 'Light' };
const OPTIONS = THEMES.map((theme) => ({ value: theme, label: LABELS[theme] }));

/** Each face's name (its radio's accessible name) and what it is for. */
const FACES: Record<Font, { name: string; description: string }> = {
  geist: { name: 'Geist', description: 'The default: compact and clean.' },
  'space-grotesk': {
    name: 'Space Grotesk',
    description: 'Characterful: quirky, engineered letters throughout.',
  },
  'chakra-petch': {
    name: 'Chakra Petch',
    description: 'Robotic headings and wordmark; text stays in Geist.',
  },
  'atkinson-hyperlegible': {
    name: 'Atkinson Hyperlegible',
    description: 'Easier reading: letters shaped to be hard to confuse.',
  },
  opendyslexic: {
    name: 'OpenDyslexic',
    description: 'For some dyslexic readers: weighted, wider letters.',
  },
  inter: { name: 'Inter', description: 'Neutral: a plainer alternative to Geist.' },
};

/**
 * The typeface for this browser (#40): a radio group drawn like the segmented control, wrapped into
 * a grid because there are more choices than a row holds. Each option previews its face: the name
 * in the face's heading token and the description in its text token, because the option sets
 * data-font on itself (styles/fonts.css). Native radios keep the keyboard as in the theme control.
 */
function FontControl({ describedBy }: { describedBy: string }) {
  const [font, setFont] = useFont();
  const id = useId();
  return (
    <fieldset
      role="radiogroup"
      aria-labelledby={`${id}-legend`}
      aria-describedby={describedBy}
      className="grid min-w-0 gap-1.5"
    >
      <Legend variant="label">
        <span id={`${id}-legend`}>Font</span>
      </Legend>
      <div className="grid gap-0.5 rounded-md border border-strong bg-surface-sunken p-[3px] sm:grid-cols-2 lg:grid-cols-3">
        {FONTS.map((value) => {
          const face = FACES[value];
          const nameId = `${id}-${value}-name`;
          const descriptionId = `${id}-${value}-description`;
          return (
            <label
              key={value}
              data-font={value}
              className={cn(
                'group/font relative grid min-w-0 cursor-pointer content-start gap-0.5 rounded-[6px]',
                'px-3 py-2 transition-colors [&:not(:has(:checked)):hover]:bg-surface-hover',
                'has-checked:bg-accent-subtle has-checked:ring-1 has-checked:ring-accent-strong',
                'has-checked:ring-inset has-focus-visible:outline-2 has-focus-visible:outline-offset-1',
                'has-focus-visible:outline-focus forced-colors:has-checked:outline',
              )}
            >
              <input
                type="radio"
                name="font"
                value={value}
                checked={font === value}
                onChange={() => setFont(value)}
                aria-labelledby={nameId}
                aria-describedby={descriptionId}
                className="sr-only"
              />
              <span
                id={nameId}
                className="font-display text-lg leading-snug font-semibold text-default group-has-checked/font:text-accent-on-subtle"
              >
                {face.name}
              </span>
              <span id={descriptionId} className="font-sans text-xs text-muted">
                {face.description}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The look of the app in this browser: the colour theme on the shared segmented control (two native
 * radios; the arrow keys move between them and choose at once) and the font. Both apply without a
 * reload and are remembered in this browser (lib/theme.ts, lib/font.ts). "System" is reserved for
 * the installer.
 */
export function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  const themeHelpId = useId();
  const fontHelpId = useId();
  return (
    <Card title="Appearance">
      <div className="grid gap-5">
        <div className="grid gap-1.5">
          <SegmentedControl
            legend="Theme"
            name="theme"
            options={OPTIONS}
            value={theme}
            onChange={setTheme}
            describedBy={themeHelpId}
          />
          <HelpText id={themeHelpId}>
            Dark is the default. The choice applies at once and is remembered in this browser.
          </HelpText>
        </div>
        <div className="grid gap-1.5">
          <FontControl describedBy={fontHelpId} />
          <HelpText id={fontHelpId}>
            Geist is the default. The font applies at once and is remembered in this browser; code
            stays in Geist Mono.
          </HelpText>
        </div>
      </div>
    </Card>
  );
}
