const shim=new URL('./b17-shim.mjs',import.meta.url).href;
export async function resolve(specifier,context,next){if(specifier==='@graphgoblin/domain'&&context.parentURL?.endsWith('/packages/engine/dist/handlers/inference-context.js'))return {url:shim,shortCircuit:true};return next(specifier,context);}
