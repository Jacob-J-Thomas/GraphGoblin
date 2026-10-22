import { writeFile } from 'node:fs/promises';
const parent = new URL('../../../../apps/api/package.json', import.meta.url);
const { admissionContractCases, createFakeAdmissionFixture } = await import(
  import.meta.resolve('@graphgoblin/engine/testing', parent)
);
const results = [];
for (const scenario of admissionContractCases(createFakeAdmissionFixture)) {
  try {
    await scenario.run();
    results.push({ ts: new Date().toISOString(), name: scenario.name, pass: true });
  } catch (error) {
    results.push({
      ts: new Date().toISOString(),
      name: scenario.name,
      pass: false,
      message: error.message,
    });
    process.exitCode = 1;
  }
}
await writeFile(
  new URL('admission-fake.json', import.meta.url),
  JSON.stringify(results, null, 2) + '\n',
);
console.log(
  JSON.stringify({ scenarios: results.length, passed: results.filter((r) => r.pass).length }),
);
