import { Page, PageHeader } from '../components/layout/index.js';
import { ApiKeysSection, BrowserKeySection } from './sections/ApiKeysSection.js';
import { DefaultsSection } from './sections/DefaultsSection.js';
import { ModelCatalogSection } from './sections/ModelCatalogSection.js';
import { InstallSection, PreflightSection } from './sections/PreflightSection.js';
import { SecretsSection } from './sections/SecretsSection.js';

/** Settings: model catalog, defaults, secrets, API keys, harness preflight, and install. */
export function SettingsPage() {
  return (
    <Page>
      <PageHeader title="Settings" />
      <ModelCatalogSection />
      <DefaultsSection />
      <SecretsSection />
      <ApiKeysSection />
      <BrowserKeySection />
      <PreflightSection />
      <InstallSection />
    </Page>
  );
}
