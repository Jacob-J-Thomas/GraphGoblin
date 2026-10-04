/**
 * Field renderers for the schema-driven form. Each one binds to react-hook-form through
 * `useController` at a dotted path and draws one Zod construct (see introspect.ts). One file per
 * field family under fields/: shared (binding, label row, error), text (strings and numbers),
 * choice (booleans, enums, literals), json, and structure (the dispatcher with objects, arrays,
 * records, and unions, which render fields of their own).
 */
export { joinPath } from './fields/shared.js';
export { Field } from './fields/structure.js';
