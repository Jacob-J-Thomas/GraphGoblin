// SYNTHETIC-SEAM resolve hook (QA-owned): only the engine's built handlers/inference-context.js
// import of '@graphgoblin/domain' is redirected to b17-shim.mjs. No product file is modified.
const SHIM = new URL('./b17-shim.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === '@graphgoblin/domain' && context.parentURL && /\/packages\/engine\/dist\/handlers\/inference-context\.js$/i.test(context.parentURL))
    return { url: SHIM, shortCircuit: true };
  return next(specifier, context);
}
