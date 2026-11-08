import { Page, PageHeader } from '../components/layout/index.js';
import { ApiKeysSection, BrowserKeySection } from './sections/ApiKeysSection.js';
import { AppearanceSection } from './sections/AppearanceSection.js';
import { ClassifierModelsSection } from './sections/ClassifierModelsSection.js';
import { ExecutionDefaultsSection } from './sections/ExecutionDefaultsSection.js';
import { DefaultsSection } from './sections/DefaultsSection.js';
import { ModelCatalogSection } from './sections/ModelCatalogSection.js';
import { InstallSection, PreflightSection } from './sections/PreflightSection.js';
import { SecretsSection } from './sections/SecretsSection.js';
import { VoiceSection } from './sections/VoiceSection.js';

/**
 * Settings: appearance, model connections, voice, defaults, classifier models, secrets, API keys,
 * harness preflight, install.
 */
export function SettingsPage() {
  return (
    <Page>
      <PageHeader title="Settings" />
      <AppearanceSection />
      <ModelCatalogSection />
      <VoiceSection />
      <DefaultsSection />
      <ClassifierModelsSection />
      <ExecutionDefaultsSection />
      <SecretsSection />
      <ApiKeysSection />
      <BrowserKeySection />
      <PreflightSection />
      <InstallSection />
    </Page>
  );
}
