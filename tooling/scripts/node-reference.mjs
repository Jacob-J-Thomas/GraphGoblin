/**
 * Render `docs/reference/nodes.md` from the node config schemas in `@graphgoblin/contracts`.
 * The caller converts each config schema to JSON Schema (Zod 4 `z.toJSONSchema`, input side, so
 * defaults show and fields with defaults are optional) and passes the result here; this module is
 * pure so it can be tested without building the contracts package. Purposes, ports, and field
 * descriptions come from docs/04-node-catalog.md and live in NODE_DOCS below.
 */

/** Node kinds in catalog order, with the one-line purpose and ports from docs/04. */
export const NODE_DOCS = {
  trigger: {
    title: 'Trigger',
    purpose:
      'Starts a run. A loop may have several triggers; each produces the same trigger envelope.',
    ports: '`out`.',
    variantKey: 'subtype',
    fields: {
      subtype: 'Which kind of trigger this is.',
      inputSchema: 'JSON Schema the manual input must satisfy.',
      exposeTo: 'Surfaces that may start the run: the web app, the REST API, MCP.',
      expression: 'Cron expression, five or six fields.',
      timezone: 'IANA time zone the expression is evaluated in.',
      missedFirePolicy: 'What to do with fires missed while the server was down.',
      enabled: 'Whether the schedule or poller is armed.',
      signature:
        'HMAC signing: scheme, the header carrying the signature, and the secret holding the key.',
      replayWindowSeconds: 'How far the signed timestamp may be from the server clock.',
      dedupeKey: 'JSONata producing a key; a repeated key does not start another run.',
      filter: 'JSONata predicate; payloads that fail it are recorded and ignored.',
      eventType: 'Inbound event type that fires the trigger.',
      intervalSeconds: 'Seconds between probes.',
      probe: 'What to call on each poll: HTTP, a script, a signal count, or nothing.',
      fireWhen: 'JSONata over the probe result; a run starts when it is true.',
    },
  },
  decision: {
    title: 'Decision',
    purpose: 'Chooses one of several labelled routes with Jev, Codex, or a JSONata expression.',
    ports: 'One output per route label.',
    fields: {
      routes: 'At least two labelled routes, each with a description the decider reads.',
      question: 'Liquid template rendered against the thread; the question the decider answers.',
      context: 'How much of the thread the decider sees: messages, vars, the last output.',
      strategy: 'Ordered fallback chain of strategies.',
      jev: 'Jev options; a choice below `minConfidence` falls through to the next strategy.',
      codex: 'Model and effort for the Codex decider.',
      expression: 'JSONata that must evaluate to a route label.',
      recordAlternatives: 'Record the routes not taken, with confidences, on `decision.made`.',
    },
  },
  inference: {
    title: 'Inferencing',
    purpose: 'Hands a request to a harness session (Codex in 1.0).',
    ports: '`out`.',
    fields: {
      harness: 'Harness that runs the session.',
      model: 'Model; falls back to the loop default, then to the owner setting.',
      effort: 'Reasoning effort; falls back like the model.',
      session: 'Start fresh, resume the previous session, or resume a named session.',
      prompt: 'Liquid template rendered against the thread.',
      input: 'Mutations applied to the thread view the template sees.',
      contextFiles: 'Files written under the working directory before the session starts.',
      harnessOptions: 'Sandbox, approval, network, web search, and raw config overrides.',
      capabilities: 'MCP servers, plugins, and skills, resolved by the adapter.',
      output:
        'Transcript capture, how the answer lands in messages, transforms, and an optional output schema with repair.',
      timeoutSeconds: 'Optional watchdog; a timeout fails the run.',
    },
  },
  script: {
    title: 'Script',
    purpose: 'Runs a user-written program.',
    ports: '`out` plus any labels in `exitCodeRoutes`.',
    fields: {
      command: 'Program to run.',
      args: 'Arguments; each may be a Liquid template.',
      cwd: '`workspace` for the run working directory, or a path.',
      env: 'Extra environment; values may be `secret:<name>`.',
      stdin: 'What the program reads on standard input.',
      stdout: 'How standard output is used: a JSON Patch, the last output, or ignored.',
      exitCodeRoutes: 'Exit code to route label; an unmapped non-zero code fails the run.',
      timeoutSeconds: 'Optional watchdog; a timeout fails the run.',
    },
  },
  mutate: {
    title: 'Context mutation',
    purpose: 'Applies an ordered list of operations to the thread. No LLM calls.',
    ports: '`out`.',
    fields: {
      operations:
        'Operations applied in order: set, delete, append-message, inject, truncate, drop, replace, redact, coerce.',
    },
  },
  subloop: {
    title: 'Subloop',
    purpose: 'Executes another loop as a child run and waits for it.',
    ports: '`out`.',
    fields: {
      loopRef: 'The child loop and the version to pin (`latest` or a number).',
      input: 'How the child thread is built from the parent: inherit, project, or fresh.',
      output: 'How the child result flows back into the parent thread.',
      depthLimitOverride: 'Raise or lower the nesting limit for this node.',
    },
  },
  wait: {
    title: 'Wait',
    purpose: 'Parks the run until input, a time, or a signal arrives.',
    ports: '`out`.',
    variantKey: 'mode',
    fields: {
      mode: 'What resumes the run.',
      prompt: 'Liquid template shown to whoever provides the input.',
      inputSchema: 'JSON Schema the input must satisfy.',
      exposeTo: 'Surfaces that may provide the input.',
      seconds: 'How long to wait.',
      timestamp: 'When to resume; Liquid or JSONata producing an ISO timestamp.',
      name: 'Signal name to wait for.',
      filter: 'JSONata predicate over the signal payload.',
      timeoutSeconds: 'Give up after this long.',
      onTimeout: 'Continue with `lastOutput = { timedOut: true }`, or fail the run.',
    },
  },
  heartbeat: {
    title: 'Heartbeat',
    purpose: 'Repeats a probe on an interval until a condition, deadline, or beat limit.',
    ports: '`out`.',
    fields: {
      intervalSeconds: 'Seconds between beats; the run is parked in between.',
      probe: 'What to do on each beat: HTTP, a script, a signal count, or nothing.',
      until: 'JSONata over `{ probe, thread, beat }`; stops when true.',
      maxBeats: 'Stop after this many beats.',
      deadline: 'Stop at this time.',
      onExhausted: 'Continue with `lastOutput = { exhausted: true }`, or fail the run.',
      record: 'Record a summary or the full probe result on each `heartbeat.beat`.',
    },
  },
  exit: {
    title: 'Exit',
    purpose:
      'Decides whether the loop is done, what it returns, where that goes, and whether to go around again.',
    ports: '`loopBack`, only when configured.',
    fields: {
      criteria: 'Evaluated in order; the first that matches decides the outcome.',
      default: 'What happens when no criterion matches.',
      loopBack: 'The node a loop-back returns to.',
      return: 'JSONata mapping for the return payload and the channels it is delivered to.',
    },
  },
};

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

/** Table rows for one object schema: name, type, required, default, description. */
export function fieldRows(objectSchema, descriptions, skip = new Set()) {
  const required = new Set(objectSchema.required ?? []);
  return Object.entries(objectSchema.properties ?? {})
    .filter(([name]) => !skip.has(name))
    .map(([name, schema]) => ({
      name,
      type: typeOf(schema),
      required: required.has(name),
      default: 'default' in schema ? literal(schema.default) : '',
      description: descriptions[name] ?? '',
    }));
}

function table(rows) {
  return [
    '| Field | Type | Required | Default | Description |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| \`${r.name}\` | ${cell(r.type)} | ${r.required ? 'yes' : 'no'} | ${cell(r.default)} | ${cell(r.description)} |`,
    ),
  ].join('\n');
}

/**
 * Fields that have no description in NODE_DOCS. The generator fails on any, so a new config field
 * cannot reach the reference undocumented.
 */
export function undocumentedFields(jsonSchemas) {
  const missing = [];
  for (const [kind, schema] of Object.entries(jsonSchemas)) {
    const docs = NODE_DOCS[kind];
    if (!docs) {
      missing.push(kind);
      continue;
    }
    const objects = schema.oneOf ?? schema.anyOf ?? [schema];
    for (const object of objects) {
      for (const name of Object.keys(object.properties ?? {})) {
        if (!docs.fields[name]) missing.push(`${kind}.${name}`);
      }
    }
  }
  return [...new Set(missing)];
}

/** Render the whole reference. `jsonSchemas` maps node kind to its config JSON Schema. */
export function renderNodeReference(jsonSchemas) {
  const missing = undocumentedFields(jsonSchemas);
  if (missing.length > 0) {
    throw new Error(
      `node reference: add descriptions to NODE_DOCS for ${missing.join(', ')} (tooling/scripts/node-reference.mjs)`,
    );
  }
  const out = [
    '# Node reference',
    '',
    '<!-- Generated by `pnpm docs:generate` from the config schemas in `packages/contracts/src/nodes.ts`. Do not edit by hand; `pnpm check:docs` fails when this file is stale. -->',
    '',
    'Every node has an `id`, a `kind`, a `label`, a canvas position, and a `config` whose fields are listed here. Behaviour, examples, and the reasoning behind each node are in [04 - Node catalog](../04-node-catalog.md). Types are the input side of the schema: a field with a default may be omitted.',
    '',
  ];
  for (const [kind, docs] of Object.entries(NODE_DOCS)) {
    const schema = jsonSchemas[kind];
    if (!schema) continue;
    out.push(`## ${docs.title} (\`${kind}\`)`, '', docs.purpose, '', `Ports: ${docs.ports}`, '');
    const variants = docs.variantKey ? (schema.oneOf ?? schema.anyOf) : undefined;
    if (variants) {
      for (const variant of variants) {
        const value = variant.properties?.[docs.variantKey]?.const;
        out.push(
          `### \`${docs.variantKey}: ${JSON.stringify(value)}\``,
          '',
          table(fieldRows(variant, docs.fields, new Set([docs.variantKey]))),
          '',
        );
      }
    } else {
      out.push(table(fieldRows(schema, docs.fields)), '');
    }
  }
  return out.join('\n');
}
