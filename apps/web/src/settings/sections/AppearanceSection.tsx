import { useId } from 'react';
import { Card, ChoiceGroup, HelpText, SegmentedControl } from '../../components/ui/index.js';
import { FONTS, useFont, type Font } from '../../lib/font.js';
import { THEMES, useTheme, type Theme } from '../../lib/theme.js';

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
 * The typeface for this browser (#40): the shared `ChoiceGroup` in its grid layout, because there
 * are more choices than a row holds, so its radios, keyboard, and chosen, focus, and forced-colours
 * states are the theme control's. Each option previews its face: it sets data-font on itself
 * (styles/fonts.css), and shows the name in that face's heading token and the description in its
 * text token.
 */
function FontControl({ describedBy }: { describedBy: string }) {
  const [font, setFont] = useFont();
  return (
    <ChoiceGroup
      legend="Font"
      name="font"
      layout="grid"
      describedBy={describedBy}
      choices={FONTS.map((value) => ({
        key: value,
        value,
        checked: font === value,
        onSelect: () => setFont(value),
        label: (
          <span className="font-display text-lg leading-snug font-semibold">
            {FACES[value].name}
          </span>
        ),
        description: <span className="font-sans text-xs">{FACES[value].description}</span>,
        data: { 'data-font': value },
      }))}
    />
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
