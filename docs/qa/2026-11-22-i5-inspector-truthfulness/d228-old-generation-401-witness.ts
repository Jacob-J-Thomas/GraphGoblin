import { useApiKeyStore, withApiKey } from 'G:/ggq/gg-i5-truthful-inspector/GraphGoblin/apps/web/src/api/api-key.ts';
import { writeFileSync } from 'node:fs';

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() {} } });
useApiKeyStore.setState({ key: 'gg_synthetic_review_only', rejected: false, generation: 0 });
let release!: (response: Response) => void;
const held = new Promise<Response>((resolve) => { release = resolve; });
const pending = withApiKey(() => held)(new Request('http://graphgoblin.test/runs/synthetic'));
const sentGeneration = useApiKeyStore.getState().generation;
useApiKeyStore.getState().markRejected();
useApiKeyStore.getState().save('gg_synthetic_review_only');
const recovered = useApiKeyStore.getState();
release(new Response(null, { status: 401 }));
await pending;
const after = useApiKeyStore.getState();
const result = { sourceHead: '0f500bd9355d22a7497f5e4e211a85376a53151f', syntheticCredentialsOnly: true, networkRequests: 0, sentGeneration, recoveredGeneration: recovered.generation, recoveredRejected: recovered.rejected, afterOld401Generation: after.generation, afterOld401Rejected: after.rejected, defectReproduced: !recovered.rejected && after.rejected && after.generation > recovered.generation, acceptancePassed: false };
writeFileSync('G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d228-root-materials-01/old-generation-401-witness.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify(result) + '\n');
