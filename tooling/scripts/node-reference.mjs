/**
 * Render `docs/reference/nodes.md` from the node config schemas in `@graphgoblin/contracts`.
 * The caller converts each config schema to JSON Schema (Zod 4 `z.toJSONSchema`, input side, so
 * defaults show and fields with defaults are optional) and reads each field's metadata with the
 * contracts' `fieldMeta` (`nodeFieldDocs`), and passes both here; this module is pure so it can be
 * tested without building the contracts package. Purposes and ports come from
 * docs/04-node-catalog.md and live in NODE_DOCS below; each field's description, and whether the
 * forms keep it under Advanced, are the schemas' own metadata.
 */

/** Node kinds in catalog order, with the one-line purpose and ports from docs/04. */
export const NODE_DOCS = {
  trigger: {
    title: 'Trigger',
    purpose:
      'Starts a run. A loop may have several triggers; each produces the same trigger envelope.',
    ports: '`out`.',
    variantKey: 'subtype',
  },
  decision: {
    title: 'Decision',
    purpose: 'Chooses one of several labelled routes with Jev, Codex, or a JSONata expression.',
    ports: 'One output per route label.',
  },
  inference: {
    title: 'Inferencing',
    purpose: 'Hands a request to a harness session (Codex in 1.0).',
    ports: '`out`.',
  },
  script: {
    title: 'Script',
    purpose: 'Runs a user-written program.',
    ports: '`out` plus any labels in `exitCodeRoutes`.',
  },
  mutate: {
    title: 'Context mutation',
    purpose: 'Applies an ordered list of operations to the thread. No LLM calls.',
    ports: '`out`.',
  },
  subloop: {
    title: 'Subloop',
    purpose: 'Executes another loop as a child run and waits for it.',
    ports: '`out`.',
  },
  wait: {
    title: 'Wait',
    purpose: 'Parks the run until input, a time, or a signal arrives.',
    ports: '`out`.',
    variantKey: 'mode',
  },
  heartbeat: {
    title: 'Heartbeat',
    purpose: 'Repeats a probe on an interval until a condition, deadline, or beat limit.',
    ports: '`out`.',
  },
  exit: {
    title: 'Exit',
    purpose:
      'Decides whether the loop is done, what it returns, where that goes, and whether to go around again.',
    ports: '`loopBack`, only when configured.',
  },
};

/** Wrappers that leave a field's meaning alone (Zod 4 `_zod.def.type`). */
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
]);

/** A Zod schema under its optional, default, and similar wrappers. */
function unwrapZod(schema) {
  let current = schema;
  while (WRAPPERS.has(current._zod.def.type) && current._zod.def.innerType) {
    current = current._zod.def.innerType;
  }
  return current;
}

/**
 * Whether the forms keep a field under their Advanced disclosure: `'yes'`, `''`, or, for an object
 * split between the two (some of its fields advanced, as `harnessOptions`), which of its fields
 * stay with the basic ones: "all but `sandbox`". `readMeta` is the contracts' `fieldMeta`.
 */
export function advancedMarker(schema, readMeta) {
  if (readMeta(schema).advanced) return 'yes';
  const base = unwrapZod(schema);
  if (base._zod.def.type !== 'object') return '';
  const fields = Object.entries(base._zod.def.shape ?? {});
  if (!fields.some(([, child]) => readMeta(child).advanced)) return '';
  const basic = fields.filter(([, child]) => !readMeta(child).advanced).map(([name]) => name);
  return basic.length === 0 ? 'yes' : `all but ${basic.map((name) => `\`${name}\``).join(', ')}`;
}

/**
 * Each node kind's field docs, read from its Zod config schema with `readMeta` (the contracts'
 * `fieldMeta`): one map per variant of a union, in the union's order (as `oneOf` in its JSON
 * Schema), else one map, from field name to its description and Advanced marker.
 */
export function nodeFieldDocs(configSchemas, readMeta) {
  return Object.fromEntries(
    Object.entries(configSchemas).map(([kind, schema]) => {
      const def = schema._zod.def;
      const objects = def.type === 'union' ? def.options : [schema];
      return [
        kind,
        objects.map((object) =>
          Object.fromEntries(
            Object.entries(unwrapZod(object)._zod.def.shape ?? {}).map(([name, child]) => [
              name,
              {
                description: readMeta(child).description,
                advanced: advancedMarker(child, readMeta),
              },
            ]),
          ),
        ),
      ];
    }),
  );
}

/** Escape text for a Markdown table cell. */
function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function literal(value) {
  return `\`${JSON.stringify(value)}\``;
}

/** A short, human-readable type for a JSON Schema fragment. */
export function typeOf(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) return 'any';
  if (schema.$ref) return schema.$ref.endsWith('__schema0') ? 'JSON value' : 'object';
  if ('const' in schema) return literal(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map(literal).join(' | ');
  const variants = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(variants)) {
    const tag = discriminator(variants);
    if (tag) return `one of ${tag.values.map(literal).join(' | ')} by \`${tag.key}\``;
    return [...new Set(variants.map((v) => typeOf(v, depth + 1)))].join(' | ');
  }
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  switch (schema.type) {
    case 'array': {
      const item = typeOf(schema.items, depth + 1);
      return /\s/.test(item) ? `array of (${item})` : `${item}[]`;
    }
    case 'object': {
      const props = Object.keys(schema.properties ?? {});
      if (props.length === 0) {
        const value = schema.additionalProperties;
        const inner = value && typeof value === 'object' ? typeOf(value, depth + 1) : 'any';
        return inner === 'any' ? 'object' : `map of ${inner}`;
      }
      if (depth > 0 || props.length > 4) return 'object';
      const required = new Set(schema.required ?? []);
      return `{ ${props.map((p) => (required.has(p) ? p : `${p}?`)).join(', ')} }`;
    }
    default:
      return schema.type ?? 'any';
  }
}

/** The shared `const` property of a union of objects, if any: a discriminated union. */
export function discriminator(variants) {
  if (variants.length === 0) return undefined;
  const first = variants[0]?.properties ?? {};
  for (const key of Object.keys(first)) {
    const values = variants.map((v) => v?.properties?.[key]?.const);
    if (values.every((v) => v !== undefined)) return { key, values };
  }
  return undefined;
}

/**
 * Table rows for one object schema: name, type, required, default, Advanced, and description.
 * `docs` maps a field name to its description and Advanced marker.
 */
export function fieldRows(objectSchema, docs, skip = new Set()) {
  const required = new Set(objectSchema.required ?? []);
  return Object.entries(objectSchema.properties ?? {})
    .filter(([name]) => !skip.has(name))
    .map(([name, schema]) => ({
      name,
      type: typeOf(schema),
      required: required.has(name),
      default: 'default' in schema ? literal(schema.default) : '',
      advanced: docs[name]?.advanced ?? '',
      description: docs[name]?.description ?? '',
    }));
}

/** A Markdown table of rows, with an Advanced column only when a row has a marker. */
function table(rows) {
  const advanced = rows.some((r) => r.advanced);
  const columns = ['Field', 'Type', 'Required', 'Default'];
  if (advanced) columns.push('Advanced');
  columns.push('Description');
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [
    line(columns),
    line(columns.map(() => '---')),
    ...rows.map((r) =>
      line([
        `\`${r.name}\``,
        cell(r.type),
        r.required ? 'yes' : 'no',
        cell(r.default),
        ...(advanced ? [cell(r.advanced)] : []),
        cell(r.description),
      ]),
    ),
  ].join('\n');
}

/**
 * Fields with no description in the schemas' metadata (`fieldDocs`, see `nodeFieldDocs`), and
 * kinds missing from NODE_DOCS. The generator fails on any, so a new config field cannot reach the
 * reference undocumented. A union's tag (`subtype`, `mode`) names its variant's table, not a row.
 */
export function undocumentedFields(jsonSchemas, fieldDocs) {
  const missing = [];
  for (const [kind, schema] of Object.entries(jsonSchemas)) {
    const docs = NODE_DOCS[kind];
    if (!docs) {
      missing.push(kind);
      continue;
    }
    const objects = schema.oneOf ?? schema.anyOf ?? [schema];
    objects.forEach((object, index) => {
      for (const name of Object.keys(object.properties ?? {})) {
        if (name === docs.variantKey) continue;
        if (!fieldDocs[kind]?.[index]?.[name]?.description) missing.push(`${kind}.${name}`);
      }
    });
  }
  return [...new Set(missing)];
}

/**
 * Render the whole reference. `jsonSchemas` maps node kind to its config JSON Schema; `fieldDocs`
 * holds each field's description and Advanced marker (see `nodeFieldDocs`).
 */
export function renderNodeReference(jsonSchemas, fieldDocs) {
  const missing = undocumentedFields(jsonSchemas, fieldDocs);
  if (missing.length > 0) {
    throw new Error(
      `node reference: describe ${missing.join(', ')} with .meta(field(...)) in packages/contracts/src/nodes.ts`,
    );
  }
  const out = [
    '# Node reference',
    '',
    '<!-- Generated by `pnpm docs:generate` from the config schemas in `packages/contracts/src/nodes.ts`. Do not edit by hand; `pnpm check:docs` fails when this file is stale. -->',
    '',
    'Every node has an `id`, a `kind`, a `label`, a canvas position, and a `config` whose fields are listed here. Behaviour, examples, and the reasoning behind each node are in [04 - Node catalog](../04-node-catalog.md). Types are the input side of the schema: a field with a default may be omitted.',
    '',
    'Descriptions are the schemas\' field metadata, which the node editor shows as each field\'s help. **Advanced** marks the fields the editor keeps under its collapsed Advanced options; "all but" names the fields of an object that stay with the basic ones.',
    '',
  ];
  for (const [kind, docs] of Object.entries(NODE_DOCS)) {
    const schema = jsonSchemas[kind];
    if (!schema) continue;
    out.push(`## ${docs.title} (\`${kind}\`)`, '', docs.purpose, '', `Ports: ${docs.ports}`, '');
    const variants = docs.variantKey ? (schema.oneOf ?? schema.anyOf) : undefined;
    if (variants) {
      variants.forEach((variant, index) => {
        const value = variant.properties?.[docs.variantKey]?.const;
        out.push(
          `### \`${docs.variantKey}: ${JSON.stringify(value)}\``,
          '',
          table(fieldRows(variant, fieldDocs[kind][index], new Set([docs.variantKey]))),
          '',
        );
      });
    } else {
      out.push(table(fieldRows(schema, fieldDocs[kind][0])), '');
    }
  }
  return out.join('\n');
}
