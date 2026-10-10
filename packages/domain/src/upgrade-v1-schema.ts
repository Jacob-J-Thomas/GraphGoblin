// Frozen from 2f98219fb43620b56d6ae4473db85a35f34d1d16, with the earlier
// statusless command projection and decisions without skip evidence. Offline upgrade only.
import type { JsonSchema } from '@graphgoblin/contracts';
export const LEGACY_V1_SCHEMA: Record<'definition' | 'event', JsonSchema> = {
  definition: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      schemaVersion: { type: 'number', const: 1 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', maxLength: 4000 },
      settings: {
        default: {},
        type: 'object',
        properties: {
          workingDirectory: {
            default: { kind: 'temp' },
            oneOf: [
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'fixed' },
                  path: { type: 'string', minLength: 1, maxLength: 4096 },
                },
                required: ['kind', 'path'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'template' },
                  template: { type: 'string', maxLength: 100000, 'x-upgrade-source': 'template' },
                },
                required: ['kind', 'template'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'temp' } },
                required: ['kind'],
                additionalProperties: false,
              },
            ],
          },
          defaults: {
            default: {},
            type: 'object',
            properties: {
              model: { type: 'string', minLength: 1, maxLength: 256 },
              effort: {
                type: 'string',
                enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
              },
            },
            additionalProperties: false,
          },
          maxIterations: { default: 10, type: 'integer', exclusiveMinimum: 0, maximum: 10000 },
          subloopDepthLimit: { default: 8, type: 'integer', exclusiveMinimum: 0, maximum: 64 },
        },
        additionalProperties: false,
      },
      variables: {
        default: {},
        type: 'object',
        propertyNames: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
        additionalProperties: {
          type: 'object',
          propertyNames: { type: 'string' },
          additionalProperties: {},
        },
      },
      nodes: {
        minItems: 1,
        maxItems: 500,
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ui: {
                  default: { x: 0, y: 0 },
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                kind: { type: 'string', const: 'trigger' },
                config: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        subtype: { type: 'string', const: 'manual' },
                        inputSchema: {
                          type: 'object',
                          propertyNames: { type: 'string' },
                          additionalProperties: {},
                        },
                        exposeTo: {
                          default: ['ui', 'api', 'mcp'],
                          minItems: 1,
                          type: 'array',
                          items: { type: 'string', enum: ['ui', 'api', 'mcp'] },
                        },
                      },
                      required: ['subtype'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        subtype: { type: 'string', const: 'cron' },
                        expression: { type: 'string', minLength: 1, maxLength: 256 },
                        timezone: { default: 'UTC', type: 'string', minLength: 1, maxLength: 64 },
                        missedFirePolicy: {
                          default: 'skip',
                          type: 'string',
                          enum: ['skip', 'run-once', 'run-each'],
                        },
                        enabled: { default: true, type: 'boolean' },
                      },
                      required: ['subtype', 'expression'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        subtype: { type: 'string', const: 'webhook' },
                        signature: {
                          type: 'object',
                          properties: {
                            scheme: { type: 'string', const: 'hmac-sha256' },
                            header: {
                              default: 'x-graphgoblin-signature',
                              type: 'string',
                              minLength: 1,
                              maxLength: 128,
                            },
                            secretRef: { type: 'string', minLength: 1, maxLength: 128 },
                          },
                          required: ['scheme', 'secretRef'],
                          additionalProperties: false,
                        },
                        replayWindowSeconds: {
                          default: 300,
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 86400,
                        },
                        dedupeKey: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                          'x-upgrade-source': 'expression',
                        },
                        filter: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                          'x-upgrade-source': 'expression',
                        },
                      },
                      required: ['subtype', 'signature'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        subtype: { type: 'string', const: 'event' },
                        eventType: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                        filter: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                          'x-upgrade-source': 'expression',
                        },
                        dedupeKey: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                          'x-upgrade-source': 'expression',
                        },
                      },
                      required: ['subtype', 'eventType'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        subtype: { type: 'string', const: 'poll' },
                        intervalSeconds: { type: 'integer', minimum: 5, maximum: 86400 },
                        probe: {
                          oneOf: [
                            {
                              type: 'object',
                              properties: {
                                kind: { type: 'string', const: 'http' },
                                method: {
                                  default: 'GET',
                                  type: 'string',
                                  enum: ['GET', 'POST', 'HEAD'],
                                },
                                url: {
                                  type: 'string',
                                  maxLength: 100000,
                                  'x-upgrade-source': 'template',
                                },
                                headers: {
                                  type: 'object',
                                  propertyNames: { type: 'string' },
                                  additionalProperties: {
                                    type: 'string',
                                    maxLength: 100000,
                                    'x-upgrade-source': 'template',
                                  },
                                },
                                body: {
                                  type: 'string',
                                  maxLength: 100000,
                                  'x-upgrade-source': 'template',
                                },
                                timeoutSeconds: {
                                  default: 30,
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 300,
                                },
                              },
                              required: ['kind', 'url'],
                              additionalProperties: false,
                            },
                            {
                              type: 'object',
                              properties: {
                                kind: { type: 'string', const: 'script' },
                                command: { type: 'string', minLength: 1 },
                                args: {
                                  default: [],
                                  type: 'array',
                                  items: {
                                    type: 'string',
                                    maxLength: 100000,
                                    'x-upgrade-source': 'template',
                                  },
                                },
                                timeoutSeconds: {
                                  default: 60,
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 3600,
                                },
                              },
                              required: ['kind', 'command'],
                              additionalProperties: false,
                            },
                            {
                              type: 'object',
                              properties: {
                                kind: { type: 'string', const: 'signal-count' },
                                name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                              },
                              required: ['kind', 'name'],
                              additionalProperties: false,
                            },
                            {
                              type: 'object',
                              properties: { kind: { type: 'string', const: 'none' } },
                              required: ['kind'],
                              additionalProperties: false,
                            },
                          ],
                        },
                        fireWhen: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                          'x-upgrade-source': 'expression',
                        },
                        dedupeKey: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                          'x-upgrade-source': 'expression',
                        },
                        enabled: { default: true, type: 'boolean' },
                      },
                      required: ['subtype', 'intervalSeconds', 'probe', 'fireWhen'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              required: ['id', 'label', 'kind', 'config'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ui: {
                  default: { x: 0, y: 0 },
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                kind: { type: 'string', const: 'decision' },
                config: {
                  type: 'object',
                  properties: {
                    routes: {
                      minItems: 2,
                      maxItems: 64,
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          label: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                          description: { type: 'string', maxLength: 2000 },
                        },
                        required: ['label', 'description'],
                        additionalProperties: false,
                      },
                    },
                    question: { type: 'string', maxLength: 100000, 'x-upgrade-source': 'template' },
                    context: {
                      default: {},
                      type: 'object',
                      properties: {
                        messages: {
                          default: 'last',
                          anyOf: [
                            { type: 'string', const: 'none' },
                            { type: 'string', const: 'last' },
                            { type: 'string', const: 'all' },
                            { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
                            {
                              type: 'object',
                              properties: {
                                where: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 100000,
                                  'x-upgrade-source': 'expression',
                                },
                              },
                              required: ['where'],
                              additionalProperties: false,
                            },
                          ],
                        },
                        vars: {
                          type: 'array',
                          items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                        },
                        includeLastOutput: { default: true, type: 'boolean' },
                      },
                      additionalProperties: false,
                    },
                    strategy: {
                      minItems: 1,
                      maxItems: 3,
                      type: 'array',
                      items: { type: 'string', enum: ['jev', 'codex', 'expression'] },
                    },
                    jev: {
                      type: 'object',
                      properties: {
                        primitive: { default: 'choice', type: 'string', const: 'choice' },
                        model: { type: 'string', pattern: '^[a-z][a-z0-9_.-]{0,63}$' },
                        minConfidence: { type: 'number', minimum: 0, maximum: 1 },
                      },
                      additionalProperties: false,
                    },
                    codex: {
                      type: 'object',
                      properties: {
                        model: { type: 'string', minLength: 1, maxLength: 256 },
                        effort: {
                          type: 'string',
                          enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
                        },
                      },
                      additionalProperties: false,
                    },
                    expression: {
                      type: 'object',
                      properties: {
                        jsonata: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                          'x-upgrade-source': 'expression',
                        },
                      },
                      required: ['jsonata'],
                      additionalProperties: false,
                    },
                    recordAlternatives: { default: true, type: 'boolean' },
                  },
                  required: ['routes', 'question', 'strategy'],
                  additionalProperties: false,
                },
              },
              required: ['id', 'label', 'kind', 'config'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ui: {
                  default: { x: 0, y: 0 },
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                kind: { type: 'string', const: 'inference' },
                config: {
                  type: 'object',
                  properties: {
                    harness: { default: 'codex', type: 'string', enum: ['codex'] },
                    model: { type: 'string', minLength: 1, maxLength: 256 },
                    effort: {
                      type: 'string',
                      enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
                    },
                    session: {
                      default: { policy: 'fresh' },
                      oneOf: [
                        {
                          type: 'object',
                          properties: { policy: { type: 'string', const: 'fresh' } },
                          required: ['policy'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: { policy: { type: 'string', const: 'resume-previous' } },
                          required: ['policy'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            policy: { type: 'string', const: 'resume-named' },
                            key: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                          },
                          required: ['policy', 'key'],
                          additionalProperties: false,
                        },
                      ],
                    },
                    prompt: {
                      type: 'object',
                      properties: {
                        template: {
                          type: 'string',
                          maxLength: 100000,
                          'x-upgrade-source': 'template',
                        },
                      },
                      required: ['template'],
                      additionalProperties: false,
                    },
                    input: {
                      default: [],
                      maxItems: 128,
                      type: 'array',
                      items: {
                        oneOf: [
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'set' },
                              path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                              value: {
                                oneOf: [
                                  {
                                    type: 'object',
                                    properties: {
                                      kind: { type: 'string', const: 'literal' },
                                      value: { $ref: '#/definitions/__schema0' },
                                    },
                                    required: ['kind', 'value'],
                                    additionalProperties: false,
                                  },
                                  {
                                    type: 'object',
                                    properties: {
                                      kind: { type: 'string', const: 'template' },
                                      template: {
                                        type: 'string',
                                        maxLength: 100000,
                                        'x-upgrade-source': 'template',
                                      },
                                    },
                                    required: ['kind', 'template'],
                                    additionalProperties: false,
                                  },
                                  {
                                    type: 'object',
                                    properties: {
                                      kind: { type: 'string', const: 'expression' },
                                      jsonata: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 100000,
                                        'x-upgrade-source': 'expression',
                                      },
                                    },
                                    required: ['kind', 'jsonata'],
                                    additionalProperties: false,
                                  },
                                ],
                              },
                            },
                            required: ['op', 'path', 'value'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'delete' },
                              path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                            },
                            required: ['op', 'path'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'append-message' },
                              role: {
                                default: 'note',
                                type: 'string',
                                enum: ['system', 'user', 'assistant', 'tool', 'note'],
                              },
                              content: {
                                type: 'string',
                                maxLength: 100000,
                                'x-upgrade-source': 'template',
                              },
                              tags: {
                                maxItems: 32,
                                type: 'array',
                                items: { type: 'string', maxLength: 64 },
                              },
                            },
                            required: ['op', 'content'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'inject' },
                              position: {
                                anyOf: [
                                  { type: 'string', const: 'start' },
                                  { type: 'string', const: 'end' },
                                  { type: 'integer', minimum: 0, maximum: 9007199254740991 },
                                ],
                              },
                              messages: {
                                minItems: 1,
                                maxItems: 64,
                                type: 'array',
                                items: {
                                  type: 'object',
                                  properties: {
                                    role: {
                                      default: 'note',
                                      type: 'string',
                                      enum: ['system', 'user', 'assistant', 'tool', 'note'],
                                    },
                                    content: {
                                      type: 'string',
                                      maxLength: 100000,
                                      'x-upgrade-source': 'template',
                                    },
                                    tags: {
                                      maxItems: 32,
                                      type: 'array',
                                      items: { type: 'string', maxLength: 64 },
                                    },
                                  },
                                  required: ['content'],
                                  additionalProperties: false,
                                },
                              },
                            },
                            required: ['op', 'position', 'messages'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'truncate' },
                              keep: {
                                type: 'object',
                                properties: {
                                  first: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
                                  last: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
                                  maxEstimatedTokens: {
                                    type: 'integer',
                                    exclusiveMinimum: 0,
                                    maximum: 9007199254740991,
                                  },
                                },
                                additionalProperties: false,
                              },
                              where: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100000,
                                'x-upgrade-source': 'expression',
                              },
                            },
                            required: ['op', 'keep'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'drop' },
                              target: { type: 'string', enum: ['messages', 'artifacts'] },
                              where: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100000,
                                'x-upgrade-source': 'expression',
                              },
                            },
                            required: ['op', 'target', 'where'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'replace' },
                              target: { type: 'string', enum: ['messages', 'vars'] },
                              where: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100000,
                                'x-upgrade-source': 'expression',
                              },
                              pattern: { type: 'string', minLength: 1, maxLength: 4096 },
                              flags: { default: 'g', type: 'string', pattern: '^[gimsuy]*$' },
                              replacement: { type: 'string', maxLength: 4096 },
                            },
                            required: ['op', 'target', 'pattern', 'replacement'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'redact' },
                              target: {
                                default: 'all',
                                type: 'string',
                                enum: ['messages', 'vars', 'all'],
                              },
                              patterns: {
                                minItems: 1,
                                maxItems: 64,
                                type: 'array',
                                items: { type: 'string', minLength: 1, maxLength: 4096 },
                              },
                              replacement: {
                                default: '[REDACTED]',
                                type: 'string',
                                maxLength: 256,
                              },
                            },
                            required: ['op', 'patterns'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'coerce' },
                              source: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                              jsonSchema: {
                                type: 'object',
                                propertyNames: { type: 'string' },
                                additionalProperties: {},
                              },
                              repair: {
                                default: {},
                                type: 'object',
                                properties: {
                                  enabled: { default: true, type: 'boolean' },
                                  maxAttempts: {
                                    default: 1,
                                    type: 'integer',
                                    minimum: 0,
                                    maximum: 10,
                                  },
                                  prompt: {
                                    type: 'string',
                                    maxLength: 100000,
                                    'x-upgrade-source': 'template',
                                  },
                                  onFailure: {
                                    default: 'fail-run',
                                    type: 'string',
                                    enum: ['fail-run', 'continue-raw'],
                                  },
                                },
                                additionalProperties: false,
                              },
                              target: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                            },
                            required: ['op', 'source', 'jsonSchema', 'target'],
                            additionalProperties: false,
                          },
                        ],
                      },
                    },
                    contextFiles: {
                      maxItems: 32,
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          path: { type: 'string', minLength: 1, maxLength: 1024 },
                          template: {
                            type: 'string',
                            maxLength: 100000,
                            'x-upgrade-source': 'template',
                          },
                        },
                        required: ['path', 'template'],
                        additionalProperties: false,
                      },
                    },
                    harnessOptions: {
                      default: {},
                      type: 'object',
                      properties: {
                        sandbox: {
                          default: 'workspace-write',
                          type: 'string',
                          enum: ['read-only', 'workspace-write', 'danger-full-access'],
                        },
                        approval: {
                          default: 'never',
                          type: 'string',
                          enum: ['never', 'on-request'],
                        },
                        networkAccess: { type: 'boolean' },
                        webSearch: { type: 'boolean' },
                        configOverrides: {
                          type: 'object',
                          propertyNames: { type: 'string' },
                          additionalProperties: {},
                        },
                      },
                      additionalProperties: false,
                    },
                    capabilities: {
                      type: 'object',
                      properties: {
                        mcpServers: {
                          type: 'array',
                          items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                        },
                        plugins: {
                          type: 'array',
                          items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                        },
                        skills: {
                          type: 'array',
                          items: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                        },
                      },
                      additionalProperties: false,
                    },
                    output: {
                      default: {},
                      type: 'object',
                      properties: {
                        captureTranscript: {
                          default: 'artifact',
                          type: 'string',
                          enum: ['artifact', 'none'],
                        },
                        toMessages: {
                          default: 'final',
                          type: 'string',
                          enum: ['final', 'final-and-notes', 'none'],
                        },
                        transforms: {
                          default: [],
                          maxItems: 128,
                          type: 'array',
                          items: {
                            oneOf: [
                              {
                                type: 'object',
                                properties: {
                                  op: { type: 'string', const: 'set' },
                                  path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                                  value: {
                                    oneOf: [
                                      {
                                        type: 'object',
                                        properties: {
                                          kind: { type: 'string', const: 'literal' },
                                          value: { $ref: '#/definitions/__schema0' },
                                        },
                                        required: ['kind', 'value'],
                                        additionalProperties: false,
                                      },
                                      {
                                        type: 'object',
                                        properties: {
                                          kind: { type: 'string', const: 'template' },
                                          template: {
                                            type: 'string',
                                            maxLength: 100000,
                                            'x-upgrade-source': 'template',
                                          },
                                        },
                                        required: ['kind', 'template'],
                                        additionalProperties: false,
                                      },
                                      {
                                        type: 'object',
                                        properties: {
                                          kind: { type: 'string', const: 'expression' },
                                          jsonata: {
                                            type: 'string',
                                            minLength: 1,
                                            maxLength: 100000,
                                            'x-upgrade-source': 'expression',
                                          },
                                        },
                                        required: ['kind', 'jsonata'],
                                        additionalProperties: false,
                                      },
                                    ],
                                  },
                                },
                                required: ['op', 'path', 'value'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  op: { type: 'string', const: 'delete' },
                                  path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                                },
                                required: ['op', 'path'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  op: { type: 'string', const: 'append-message' },
                                  role: {
                                    default: 'note',
                                    type: 'string',
                                    enum: ['system', 'user', 'assistant', 'tool', 'note'],
                                  },
                                  content: {
                                    type: 'string',
                                    maxLength: 100000,
                                    'x-upgrade-source': 'template',
                                  },
                                  tags: {
                                    maxItems: 32,
                                    type: 'array',
                                    items: { type: 'string', maxLength: 64 },
                                  },
                                },
                                required: ['op', 'content'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  op: { type: 'string', const: 'inject' },
                                  position: {
                                    anyOf: [
                                      { type: 'string', const: 'start' },
                                      { type: 'string', const: 'end' },
                                      { type: 'integer', minimum: 0, maximum: 9007199254740991 },
                                    ],
                                  },
                                  messages: {
                                    minItems: 1,
                                    maxItems: 64,
                                    type: 'array',
                                    items: {
                                      type: 'object',
                                      properties: {
                                        role: {
                                          default: 'note',
                                          type: 'string',
                                          enum: ['system', 'user', 'assistant', 'tool', 'note'],
                                        },
                                        content: {
                                          type: 'string',
                                          maxLength: 100000,
                                          'x-upgrade-source': 'template',
                                        },
                                        tags: {
                                          maxItems: 32,
                                          type: 'array',
                                          items: { type: 'string', maxLength: 64 },
                                        },
                                      },
                                      required: ['content'],
                                      additionalProperties: false,
                                    },
                                  },
                                },
                                required: ['op', 'position', 'messages'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  op: { type: 'string', const: 'truncate' },
                                  keep: {
                                    type: 'object',
                                    properties: {
                                      first: {
                                        type: 'integer',
                                        minimum: 0,
                                        maximum: 9007199254740991,
                                      },
                                      last: {
                                        type: 'integer',
                                        minimum: 0,
                                        maximum: 9007199254740991,
                                      },
                                      maxEstimatedTokens: {
                                        type: 'integer',
                                        exclusiveMinimum: 0,
                                        maximum: 9007199254740991,
                                      },
                                    },
                                    additionalProperties: false,
                                  },
                                  where: {
                                    type: 'string',
                                    minLength: 1,
                                    maxLength: 100000,
                                    'x-upgrade-source': 'expression',
                                  },
                                },
                                required: ['op', 'keep'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  op: { type: 'string', const: 'drop' },
                                  target: { type: 'string', enum: ['messages', 'artifacts'] },
                                  where: {
                                    type: 'string',
                                    minLength: 1,
                                    maxLength: 100000,
                                    'x-upgrade-source': 'expression',
                                  },
                                },
                                required: ['op', 'target', 'where'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  op: { type: 'string', const: 'replace' },
                                  target: { type: 'string', enum: ['messages', 'vars'] },
                                  where: {
                                    type: 'string',
                                    minLength: 1,
                                    maxLength: 100000,
                                    'x-upgrade-source': 'expression',
                                  },
                                  pattern: { type: 'string', minLength: 1, maxLength: 4096 },
                                  flags: { default: 'g', type: 'string', pattern: '^[gimsuy]*$' },
                                  replacement: { type: 'string', maxLength: 4096 },
                                },
                                required: ['op', 'target', 'pattern', 'replacement'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  op: { type: 'string', const: 'redact' },
                                  target: {
                                    default: 'all',
                                    type: 'string',
                                    enum: ['messages', 'vars', 'all'],
                                  },
                                  patterns: {
                                    minItems: 1,
                                    maxItems: 64,
                                    type: 'array',
                                    items: { type: 'string', minLength: 1, maxLength: 4096 },
                                  },
                                  replacement: {
                                    default: '[REDACTED]',
                                    type: 'string',
                                    maxLength: 256,
                                  },
                                },
                                required: ['op', 'patterns'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  op: { type: 'string', const: 'coerce' },
                                  source: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                                  jsonSchema: {
                                    type: 'object',
                                    propertyNames: { type: 'string' },
                                    additionalProperties: {},
                                  },
                                  repair: {
                                    default: {},
                                    type: 'object',
                                    properties: {
                                      enabled: { default: true, type: 'boolean' },
                                      maxAttempts: {
                                        default: 1,
                                        type: 'integer',
                                        minimum: 0,
                                        maximum: 10,
                                      },
                                      prompt: {
                                        type: 'string',
                                        maxLength: 100000,
                                        'x-upgrade-source': 'template',
                                      },
                                      onFailure: {
                                        default: 'fail-run',
                                        type: 'string',
                                        enum: ['fail-run', 'continue-raw'],
                                      },
                                    },
                                    additionalProperties: false,
                                  },
                                  target: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                                },
                                required: ['op', 'source', 'jsonSchema', 'target'],
                                additionalProperties: false,
                              },
                            ],
                          },
                        },
                        schema: {
                          type: 'object',
                          properties: {
                            jsonSchema: {
                              type: 'object',
                              propertyNames: { type: 'string' },
                              additionalProperties: {},
                            },
                            native: { default: true, type: 'boolean' },
                            repair: {
                              default: {},
                              type: 'object',
                              properties: {
                                enabled: { default: true, type: 'boolean' },
                                maxAttempts: {
                                  default: 1,
                                  type: 'integer',
                                  minimum: 0,
                                  maximum: 10,
                                },
                                prompt: {
                                  type: 'string',
                                  maxLength: 100000,
                                  'x-upgrade-source': 'template',
                                },
                                onFailure: {
                                  default: 'fail-run',
                                  type: 'string',
                                  enum: ['fail-run', 'continue-raw'],
                                },
                              },
                              additionalProperties: false,
                            },
                          },
                          required: ['jsonSchema'],
                          additionalProperties: false,
                        },
                      },
                      additionalProperties: false,
                    },
                    timeoutSeconds: { type: 'integer', exclusiveMinimum: 0, maximum: 86400 },
                  },
                  required: ['prompt'],
                  additionalProperties: false,
                },
              },
              required: ['id', 'label', 'kind', 'config'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ui: {
                  default: { x: 0, y: 0 },
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                kind: { type: 'string', const: 'script' },
                config: {
                  type: 'object',
                  properties: {
                    command: { type: 'string', minLength: 1, maxLength: 4096 },
                    args: {
                      default: [],
                      maxItems: 256,
                      type: 'array',
                      items: { type: 'string', maxLength: 100000, 'x-upgrade-source': 'template' },
                    },
                    cwd: { default: 'workspace', type: 'string', minLength: 1, maxLength: 4096 },
                    env: {
                      type: 'object',
                      propertyNames: { type: 'string' },
                      additionalProperties: { type: 'string', maxLength: 8192 },
                    },
                    stdin: {
                      default: 'thread',
                      type: 'string',
                      enum: ['thread', 'last-output', 'none'],
                    },
                    stdout: {
                      default: 'last-output',
                      type: 'string',
                      enum: ['patch', 'last-output', 'ignore'],
                    },
                    exitCodeRoutes: {
                      type: 'object',
                      propertyNames: { type: 'string', pattern: '^\\d{1,3}$' },
                      additionalProperties: {
                        type: 'string',
                        pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$',
                      },
                    },
                    timeoutSeconds: { type: 'integer', exclusiveMinimum: 0, maximum: 86400 },
                  },
                  required: ['command'],
                  additionalProperties: false,
                },
              },
              required: ['id', 'label', 'kind', 'config'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ui: {
                  default: { x: 0, y: 0 },
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                kind: { type: 'string', const: 'mutate' },
                config: {
                  type: 'object',
                  properties: {
                    operations: {
                      minItems: 1,
                      maxItems: 128,
                      type: 'array',
                      items: {
                        oneOf: [
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'set' },
                              path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                              value: {
                                oneOf: [
                                  {
                                    type: 'object',
                                    properties: {
                                      kind: { type: 'string', const: 'literal' },
                                      value: { $ref: '#/definitions/__schema0' },
                                    },
                                    required: ['kind', 'value'],
                                    additionalProperties: false,
                                  },
                                  {
                                    type: 'object',
                                    properties: {
                                      kind: { type: 'string', const: 'template' },
                                      template: {
                                        type: 'string',
                                        maxLength: 100000,
                                        'x-upgrade-source': 'template',
                                      },
                                    },
                                    required: ['kind', 'template'],
                                    additionalProperties: false,
                                  },
                                  {
                                    type: 'object',
                                    properties: {
                                      kind: { type: 'string', const: 'expression' },
                                      jsonata: {
                                        type: 'string',
                                        minLength: 1,
                                        maxLength: 100000,
                                        'x-upgrade-source': 'expression',
                                      },
                                    },
                                    required: ['kind', 'jsonata'],
                                    additionalProperties: false,
                                  },
                                ],
                              },
                            },
                            required: ['op', 'path', 'value'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'delete' },
                              path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                            },
                            required: ['op', 'path'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'append-message' },
                              role: {
                                default: 'note',
                                type: 'string',
                                enum: ['system', 'user', 'assistant', 'tool', 'note'],
                              },
                              content: {
                                type: 'string',
                                maxLength: 100000,
                                'x-upgrade-source': 'template',
                              },
                              tags: {
                                maxItems: 32,
                                type: 'array',
                                items: { type: 'string', maxLength: 64 },
                              },
                            },
                            required: ['op', 'content'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'inject' },
                              position: {
                                anyOf: [
                                  { type: 'string', const: 'start' },
                                  { type: 'string', const: 'end' },
                                  { type: 'integer', minimum: 0, maximum: 9007199254740991 },
                                ],
                              },
                              messages: {
                                minItems: 1,
                                maxItems: 64,
                                type: 'array',
                                items: {
                                  type: 'object',
                                  properties: {
                                    role: {
                                      default: 'note',
                                      type: 'string',
                                      enum: ['system', 'user', 'assistant', 'tool', 'note'],
                                    },
                                    content: {
                                      type: 'string',
                                      maxLength: 100000,
                                      'x-upgrade-source': 'template',
                                    },
                                    tags: {
                                      maxItems: 32,
                                      type: 'array',
                                      items: { type: 'string', maxLength: 64 },
                                    },
                                  },
                                  required: ['content'],
                                  additionalProperties: false,
                                },
                              },
                            },
                            required: ['op', 'position', 'messages'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'truncate' },
                              keep: {
                                type: 'object',
                                properties: {
                                  first: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
                                  last: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
                                  maxEstimatedTokens: {
                                    type: 'integer',
                                    exclusiveMinimum: 0,
                                    maximum: 9007199254740991,
                                  },
                                },
                                additionalProperties: false,
                              },
                              where: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100000,
                                'x-upgrade-source': 'expression',
                              },
                            },
                            required: ['op', 'keep'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'drop' },
                              target: { type: 'string', enum: ['messages', 'artifacts'] },
                              where: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100000,
                                'x-upgrade-source': 'expression',
                              },
                            },
                            required: ['op', 'target', 'where'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'replace' },
                              target: { type: 'string', enum: ['messages', 'vars'] },
                              where: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100000,
                                'x-upgrade-source': 'expression',
                              },
                              pattern: { type: 'string', minLength: 1, maxLength: 4096 },
                              flags: { default: 'g', type: 'string', pattern: '^[gimsuy]*$' },
                              replacement: { type: 'string', maxLength: 4096 },
                            },
                            required: ['op', 'target', 'pattern', 'replacement'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'redact' },
                              target: {
                                default: 'all',
                                type: 'string',
                                enum: ['messages', 'vars', 'all'],
                              },
                              patterns: {
                                minItems: 1,
                                maxItems: 64,
                                type: 'array',
                                items: { type: 'string', minLength: 1, maxLength: 4096 },
                              },
                              replacement: {
                                default: '[REDACTED]',
                                type: 'string',
                                maxLength: 256,
                              },
                            },
                            required: ['op', 'patterns'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              op: { type: 'string', const: 'coerce' },
                              source: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                              jsonSchema: {
                                type: 'object',
                                propertyNames: { type: 'string' },
                                additionalProperties: {},
                              },
                              repair: {
                                default: {},
                                type: 'object',
                                properties: {
                                  enabled: { default: true, type: 'boolean' },
                                  maxAttempts: {
                                    default: 1,
                                    type: 'integer',
                                    minimum: 0,
                                    maximum: 10,
                                  },
                                  prompt: {
                                    type: 'string',
                                    maxLength: 100000,
                                    'x-upgrade-source': 'template',
                                  },
                                  onFailure: {
                                    default: 'fail-run',
                                    type: 'string',
                                    enum: ['fail-run', 'continue-raw'],
                                  },
                                },
                                additionalProperties: false,
                              },
                              target: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                            },
                            required: ['op', 'source', 'jsonSchema', 'target'],
                            additionalProperties: false,
                          },
                        ],
                      },
                    },
                  },
                  required: ['operations'],
                  additionalProperties: false,
                },
              },
              required: ['id', 'label', 'kind', 'config'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ui: {
                  default: { x: 0, y: 0 },
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                kind: { type: 'string', const: 'subloop' },
                config: {
                  type: 'object',
                  properties: {
                    loopRef: {
                      type: 'object',
                      properties: {
                        loopId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
                        version: {
                          default: 'latest',
                          anyOf: [
                            { type: 'string', const: 'latest' },
                            { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
                          ],
                        },
                      },
                      required: ['loopId'],
                      additionalProperties: false,
                    },
                    input: {
                      default: {},
                      type: 'object',
                      properties: {
                        mode: {
                          default: 'inherit',
                          type: 'string',
                          enum: ['inherit', 'project', 'fresh'],
                        },
                        exclude: {
                          type: 'array',
                          items: {
                            type: 'string',
                            enum: ['messages', 'artifacts', 'vars', 'lastOutput', 'outputs'],
                          },
                        },
                        vars: {
                          type: 'object',
                          propertyNames: {
                            type: 'string',
                            pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$',
                          },
                          additionalProperties: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 100000,
                            'x-upgrade-source': 'expression',
                          },
                        },
                        messages: {
                          anyOf: [
                            { type: 'string', const: 'none' },
                            { type: 'string', const: 'last' },
                            { type: 'string', const: 'all' },
                            { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
                            {
                              type: 'object',
                              properties: {
                                where: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 100000,
                                  'x-upgrade-source': 'expression',
                                },
                              },
                              required: ['where'],
                              additionalProperties: false,
                            },
                          ],
                        },
                        artifacts: {
                          anyOf: [
                            { type: 'string', const: 'none' },
                            { type: 'string', const: 'all' },
                            {
                              type: 'object',
                              properties: {
                                where: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 100000,
                                  'x-upgrade-source': 'expression',
                                },
                              },
                              required: ['where'],
                              additionalProperties: false,
                            },
                          ],
                        },
                        inject: {
                          maxItems: 64,
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              role: {
                                default: 'note',
                                type: 'string',
                                enum: ['system', 'user', 'assistant', 'tool', 'note'],
                              },
                              content: {
                                type: 'string',
                                maxLength: 100000,
                                'x-upgrade-source': 'template',
                              },
                              tags: {
                                maxItems: 32,
                                type: 'array',
                                items: { type: 'string', maxLength: 64 },
                              },
                            },
                            required: ['content'],
                            additionalProperties: false,
                          },
                        },
                        trigger: {
                          type: 'object',
                          properties: {
                            payload: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 100000,
                              'x-upgrade-source': 'expression',
                            },
                          },
                          required: ['payload'],
                          additionalProperties: false,
                        },
                      },
                      additionalProperties: false,
                    },
                    output: {
                      default: {},
                      type: 'object',
                      properties: {
                        mode: {
                          default: 'result-only',
                          type: 'string',
                          enum: ['result-only', 'merge', 'custom'],
                        },
                        resultTo: {
                          default: {},
                          type: 'object',
                          properties: {
                            lastOutput: { default: true, type: 'boolean' },
                            var: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                          },
                          additionalProperties: false,
                        },
                        vars: {
                          type: 'object',
                          properties: {
                            strategy: {
                              default: 'child-wins',
                              type: 'string',
                              enum: ['child-wins', 'parent-wins', 'explicit'],
                            },
                            map: {
                              type: 'object',
                              propertyNames: {
                                type: 'string',
                                pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$',
                              },
                              additionalProperties: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100000,
                                'x-upgrade-source': 'expression',
                              },
                            },
                          },
                          additionalProperties: false,
                        },
                        messages: {
                          anyOf: [
                            { type: 'string', const: 'none' },
                            { type: 'string', const: 'last' },
                            { type: 'string', const: 'all' },
                            { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
                            {
                              type: 'object',
                              properties: {
                                where: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 100000,
                                  'x-upgrade-source': 'expression',
                                },
                              },
                              required: ['where'],
                              additionalProperties: false,
                            },
                          ],
                        },
                        artifacts: {
                          anyOf: [
                            { type: 'string', const: 'none' },
                            { type: 'string', const: 'all' },
                            {
                              type: 'object',
                              properties: {
                                where: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 100000,
                                  'x-upgrade-source': 'expression',
                                },
                              },
                              required: ['where'],
                              additionalProperties: false,
                            },
                          ],
                        },
                        custom: {
                          type: 'object',
                          properties: {
                            patch: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 100000,
                              'x-upgrade-source': 'expression',
                            },
                          },
                          required: ['patch'],
                          additionalProperties: false,
                        },
                        usage: {
                          default: 'roll-up',
                          type: 'string',
                          enum: ['roll-up', 'separate'],
                        },
                      },
                      additionalProperties: false,
                    },
                    depthLimitOverride: { type: 'integer', exclusiveMinimum: 0, maximum: 64 },
                  },
                  required: ['loopRef'],
                  additionalProperties: false,
                },
              },
              required: ['id', 'label', 'kind', 'config'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ui: {
                  default: { x: 0, y: 0 },
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                kind: { type: 'string', const: 'wait' },
                config: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        mode: { type: 'string', const: 'input' },
                        prompt: {
                          type: 'string',
                          maxLength: 100000,
                          'x-upgrade-source': 'template',
                        },
                        inputSchema: {
                          type: 'object',
                          propertyNames: { type: 'string' },
                          additionalProperties: {},
                        },
                        exposeTo: {
                          default: ['ui', 'api', 'mcp'],
                          minItems: 1,
                          type: 'array',
                          items: { type: 'string', enum: ['ui', 'api', 'mcp'] },
                        },
                        timeoutSeconds: { type: 'integer', exclusiveMinimum: 0, maximum: 31536000 },
                        onTimeout: {
                          default: 'continue',
                          type: 'string',
                          enum: ['continue', 'fail-run'],
                        },
                      },
                      required: ['mode', 'prompt'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        mode: { type: 'string', const: 'duration' },
                        seconds: { type: 'integer', exclusiveMinimum: 0, maximum: 31536000 },
                        timeoutSeconds: { type: 'integer', exclusiveMinimum: 0, maximum: 31536000 },
                        onTimeout: {
                          default: 'continue',
                          type: 'string',
                          enum: ['continue', 'fail-run'],
                        },
                      },
                      required: ['mode', 'seconds'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        mode: { type: 'string', const: 'until' },
                        timestamp: {
                          type: 'string',
                          maxLength: 100000,
                          'x-upgrade-source': 'template',
                        },
                        timeoutSeconds: { type: 'integer', exclusiveMinimum: 0, maximum: 31536000 },
                        onTimeout: {
                          default: 'continue',
                          type: 'string',
                          enum: ['continue', 'fail-run'],
                        },
                      },
                      required: ['mode', 'timestamp'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        mode: { type: 'string', const: 'signal' },
                        name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                        filter: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                          'x-upgrade-source': 'expression',
                        },
                        timeoutSeconds: { type: 'integer', exclusiveMinimum: 0, maximum: 31536000 },
                        onTimeout: {
                          default: 'continue',
                          type: 'string',
                          enum: ['continue', 'fail-run'],
                        },
                      },
                      required: ['mode', 'name'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              required: ['id', 'label', 'kind', 'config'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ui: {
                  default: { x: 0, y: 0 },
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                kind: { type: 'string', const: 'heartbeat' },
                config: {
                  type: 'object',
                  properties: {
                    intervalSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
                    probe: {
                      default: { kind: 'none' },
                      oneOf: [
                        {
                          type: 'object',
                          properties: {
                            kind: { type: 'string', const: 'http' },
                            method: {
                              default: 'GET',
                              type: 'string',
                              enum: ['GET', 'POST', 'HEAD'],
                            },
                            url: {
                              type: 'string',
                              maxLength: 100000,
                              'x-upgrade-source': 'template',
                            },
                            headers: {
                              type: 'object',
                              propertyNames: { type: 'string' },
                              additionalProperties: {
                                type: 'string',
                                maxLength: 100000,
                                'x-upgrade-source': 'template',
                              },
                            },
                            body: {
                              type: 'string',
                              maxLength: 100000,
                              'x-upgrade-source': 'template',
                            },
                            timeoutSeconds: {
                              default: 30,
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 300,
                            },
                          },
                          required: ['kind', 'url'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            kind: { type: 'string', const: 'script' },
                            command: { type: 'string', minLength: 1 },
                            args: {
                              default: [],
                              type: 'array',
                              items: {
                                type: 'string',
                                maxLength: 100000,
                                'x-upgrade-source': 'template',
                              },
                            },
                            timeoutSeconds: {
                              default: 60,
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 3600,
                            },
                          },
                          required: ['kind', 'command'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            kind: { type: 'string', const: 'signal-count' },
                            name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                          },
                          required: ['kind', 'name'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: { kind: { type: 'string', const: 'none' } },
                          required: ['kind'],
                          additionalProperties: false,
                        },
                      ],
                    },
                    until: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 100000,
                      'x-upgrade-source': 'expression',
                    },
                    maxBeats: { type: 'integer', exclusiveMinimum: 0, maximum: 100000 },
                    deadline: { type: 'string', maxLength: 100000, 'x-upgrade-source': 'template' },
                    onExhausted: {
                      default: 'continue',
                      type: 'string',
                      enum: ['continue', 'fail-run'],
                    },
                    record: { default: 'summary', type: 'string', enum: ['summary', 'full'] },
                  },
                  required: ['intervalSeconds'],
                  additionalProperties: false,
                },
              },
              required: ['id', 'label', 'kind', 'config'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: {
                id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                ui: {
                  default: { x: 0, y: 0 },
                  type: 'object',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                kind: { type: 'string', const: 'exit' },
                config: {
                  type: 'object',
                  properties: {
                    criteria: {
                      default: [],
                      maxItems: 32,
                      type: 'array',
                      items: {
                        oneOf: [
                          {
                            type: 'object',
                            properties: {
                              when: { type: 'string', const: 'max-iterations' },
                              value: {
                                type: 'integer',
                                exclusiveMinimum: 0,
                                maximum: 9007199254740991,
                              },
                              outcome: { default: 'exhausted', type: 'string', const: 'exhausted' },
                            },
                            required: ['when', 'value'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              when: { type: 'string', const: 'max-duration' },
                              seconds: {
                                type: 'integer',
                                exclusiveMinimum: 0,
                                maximum: 9007199254740991,
                              },
                              outcome: { default: 'exhausted', type: 'string', const: 'exhausted' },
                            },
                            required: ['when', 'seconds'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              when: { type: 'string', const: 'predicate' },
                              strategy: { type: 'string', enum: ['jev', 'codex', 'expression'] },
                              question: {
                                type: 'string',
                                maxLength: 100000,
                                'x-upgrade-source': 'template',
                              },
                              jsonata: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100000,
                                'x-upgrade-source': 'expression',
                              },
                              minConfidence: { type: 'number', minimum: 0, maximum: 1 },
                              outcome: { type: 'string', enum: ['success', 'failure'] },
                            },
                            required: ['when', 'strategy', 'outcome'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              when: { type: 'string', const: 'last-output-matches' },
                              jsonSchema: {
                                type: 'object',
                                propertyNames: { type: 'string' },
                                additionalProperties: {},
                              },
                              outcome: { default: 'success', type: 'string', const: 'success' },
                            },
                            required: ['when', 'jsonSchema'],
                            additionalProperties: false,
                          },
                        ],
                      },
                    },
                    default: { default: 'success', type: 'string', enum: ['success', 'loop-back'] },
                    loopBack: {
                      type: 'object',
                      properties: {
                        targetNodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                      },
                      required: ['targetNodeId'],
                      additionalProperties: false,
                    },
                    return: {
                      default: {},
                      type: 'object',
                      properties: {
                        mapping: {
                          default: 'none',
                          anyOf: [
                            { type: 'string', const: 'none' },
                            {
                              type: 'string',
                              minLength: 1,
                              maxLength: 100000,
                              'x-upgrade-source': 'expression',
                            },
                          ],
                        },
                        channels: {
                          default: [{ kind: 'caller' }],
                          maxItems: 16,
                          type: 'array',
                          items: {
                            oneOf: [
                              {
                                type: 'object',
                                properties: { kind: { type: 'string', const: 'caller' } },
                                required: ['kind'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  kind: { type: 'string', const: 'webhook' },
                                  url: { type: 'string', format: 'uri' },
                                  secretRef: { type: 'string', maxLength: 128 },
                                },
                                required: ['kind', 'url'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  kind: { type: 'string', const: 'file' },
                                  path: { type: 'string', minLength: 1, maxLength: 4096 },
                                  format: {
                                    default: 'json',
                                    type: 'string',
                                    enum: ['json', 'markdown', 'text'],
                                  },
                                },
                                required: ['kind', 'path'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  kind: { type: 'string', const: 'event' },
                                  eventType: {
                                    type: 'string',
                                    pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$',
                                  },
                                },
                                required: ['kind', 'eventType'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: { kind: { type: 'string', const: 'log' } },
                                required: ['kind'],
                                additionalProperties: false,
                              },
                            ],
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                  },
                  additionalProperties: false,
                },
              },
              required: ['id', 'label', 'kind', 'config'],
              additionalProperties: false,
            },
          ],
        },
      },
      edges: {
        maxItems: 2000,
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
            from: {
              type: 'object',
              properties: {
                node: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                port: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
              },
              required: ['node', 'port'],
              additionalProperties: false,
            },
            to: {
              type: 'object',
              properties: {
                node: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                port: { default: 'in', type: 'string', const: 'in' },
              },
              required: ['node'],
              additionalProperties: false,
            },
            ui: {
              type: 'object',
              properties: {
                route: { minItems: 1, maxItems: 63, type: 'array', items: { type: 'number' } },
              },
              required: ['route'],
              additionalProperties: false,
            },
          },
          required: ['id', 'from', 'to'],
          additionalProperties: false,
        },
      },
    },
    required: ['schemaVersion', 'name', 'nodes', 'edges'],
    additionalProperties: false,
    definitions: {
      __schema0: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          { type: 'array', items: { $ref: '#/definitions/__schema0' } },
          {
            type: 'object',
            propertyNames: { type: 'string' },
            additionalProperties: { $ref: '#/definitions/__schema0' },
          },
        ],
      },
    },
  },
  event: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    oneOf: [
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.queued' },
          replayOf: {
            type: 'object',
            properties: {
              runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
              nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
            },
            required: ['runId', 'nodeId'],
            additionalProperties: false,
          },
          initialThread: {
            type: 'object',
            properties: {
              schemaVersion: { type: 'number', const: 1 },
              run: {
                type: 'object',
                properties: {
                  id: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
                  loopId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
                  versionId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
                  parentRunId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
                  iteration: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
                },
                required: ['id', 'loopId', 'versionId', 'iteration'],
                additionalProperties: false,
              },
              invocation: {
                type: 'object',
                properties: {
                  id: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
                  source: {
                    type: 'string',
                    enum: [
                      'manual.ui',
                      'manual.api',
                      'manual.mcp',
                      'cron',
                      'webhook',
                      'event',
                      'poll',
                      'subloop',
                    ],
                  },
                  caller: {
                    type: 'object',
                    properties: {
                      kind: {
                        type: 'string',
                        enum: ['user', 'api-key', 'mcp-client', 'run', 'system'],
                      },
                      id: { type: 'string', minLength: 1, maxLength: 256 },
                      label: { type: 'string', maxLength: 256 },
                    },
                    required: ['kind', 'id'],
                    additionalProperties: false,
                  },
                  trigger: {
                    type: 'object',
                    properties: {
                      nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                      kind: {
                        type: 'string',
                        enum: ['manual', 'cron', 'webhook', 'event', 'poll'],
                      },
                      payload: { $ref: '#/definitions/__schema0' },
                      receivedAt: {
                        type: 'string',
                        format: 'date-time',
                        pattern:
                          '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
                      },
                      dedupeKey: { type: 'string', maxLength: 512 },
                    },
                    required: ['nodeId', 'kind', 'payload', 'receivedAt'],
                    additionalProperties: false,
                  },
                  returnDefaults: {
                    type: 'array',
                    items: {
                      oneOf: [
                        {
                          type: 'object',
                          properties: { kind: { type: 'string', const: 'caller' } },
                          required: ['kind'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            kind: { type: 'string', const: 'webhook' },
                            url: { type: 'string', format: 'uri' },
                            secretRef: { type: 'string', maxLength: 128 },
                          },
                          required: ['kind', 'url'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            kind: { type: 'string', const: 'file' },
                            path: { type: 'string', minLength: 1, maxLength: 4096 },
                            format: {
                              default: 'json',
                              type: 'string',
                              enum: ['json', 'markdown', 'text'],
                            },
                          },
                          required: ['kind', 'path'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            kind: { type: 'string', const: 'event' },
                            eventType: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                          },
                          required: ['kind', 'eventType'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: { kind: { type: 'string', const: 'log' } },
                          required: ['kind'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  replayOf: {
                    type: 'object',
                    properties: {
                      runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
                      nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                    },
                    required: ['runId', 'nodeId'],
                    additionalProperties: false,
                  },
                },
                required: ['id', 'source', 'trigger'],
                additionalProperties: false,
              },
              messages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', minLength: 1, maxLength: 64 },
                    role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool', 'note'] },
                    content: { type: 'string' },
                    nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                    ts: {
                      type: 'string',
                      format: 'date-time',
                      pattern:
                        '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
                    },
                    tags: { maxItems: 32, type: 'array', items: { type: 'string', maxLength: 64 } },
                  },
                  required: ['id', 'role', 'content', 'nodeId', 'ts'],
                  additionalProperties: false,
                },
              },
              vars: {
                type: 'object',
                propertyNames: { type: 'string' },
                additionalProperties: { $ref: '#/definitions/__schema0' },
              },
              artifacts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', minLength: 1, maxLength: 64 },
                    kind: { type: 'string', enum: ['transcript', 'file', 'diff', 'json', 'text'] },
                    ref: { type: 'string', minLength: 1, maxLength: 4096 },
                    nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                    label: { type: 'string', maxLength: 256 },
                    bytes: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
                  },
                  required: ['id', 'kind', 'ref', 'nodeId'],
                  additionalProperties: false,
                },
              },
              outputs: {
                type: 'object',
                propertyNames: { type: 'string' },
                additionalProperties: {
                  type: 'object',
                  properties: {
                    nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                    value: { $ref: '#/definitions/__schema0' },
                    schemaRef: { type: 'string', maxLength: 256 },
                    at: {
                      type: 'string',
                      format: 'date-time',
                      pattern:
                        '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
                    },
                  },
                  required: ['nodeId', 'value', 'at'],
                  additionalProperties: false,
                },
              },
              lastOutput: {
                type: 'object',
                properties: {
                  nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                  value: { $ref: '#/definitions/__schema0' },
                  schemaRef: { type: 'string', maxLength: 256 },
                  at: {
                    type: 'string',
                    format: 'date-time',
                    pattern:
                      '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
                  },
                },
                required: ['nodeId', 'value', 'at'],
                additionalProperties: false,
              },
              counters: {
                type: 'object',
                properties: {
                  nodeVisits: {
                    type: 'object',
                    propertyNames: { type: 'string' },
                    additionalProperties: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  usage: {
                    type: 'object',
                    properties: {
                      inputTokens: {
                        default: 0,
                        type: 'integer',
                        minimum: 0,
                        maximum: 9007199254740991,
                      },
                      outputTokens: {
                        default: 0,
                        type: 'integer',
                        minimum: 0,
                        maximum: 9007199254740991,
                      },
                      cachedInputTokens: {
                        default: 0,
                        type: 'integer',
                        minimum: 0,
                        maximum: 9007199254740991,
                      },
                      reasoningOutputTokens: {
                        default: 0,
                        type: 'integer',
                        minimum: 0,
                        maximum: 9007199254740991,
                      },
                    },
                    additionalProperties: false,
                  },
                },
                required: ['nodeVisits', 'usage'],
                additionalProperties: false,
              },
            },
            required: [
              'schemaVersion',
              'run',
              'invocation',
              'messages',
              'vars',
              'artifacts',
              'outputs',
              'counters',
            ],
            additionalProperties: false,
          },
          subloopVersions: {
            type: 'object',
            propertyNames: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
            additionalProperties: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          },
        },
        required: ['runId', 'seq', 'ts', 'type'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.started' },
          attempt: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
        },
        required: ['runId', 'seq', 'ts', 'type', 'attempt'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.finished' },
          status: {
            type: 'string',
            enum: [
              'queued',
              'running',
              'waiting',
              'paused',
              'succeeded',
              'failed',
              'cancelled',
              'exhausted',
            ],
          },
          outcome: { type: 'string', enum: ['success', 'failure', 'exhausted'] },
          resultRef: { type: 'string', maxLength: 4096 },
          result: { allOf: [{ $ref: '#/definitions/__schema0' }] },
        },
        required: ['runId', 'seq', 'ts', 'type', 'status', 'outcome'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.failed' },
          failure: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: [
                  'HARNESS_NOT_INSTALLED',
                  'HARNESS_NOT_AUTHENTICATED',
                  'HARNESS_QUOTA_EXHAUSTED',
                  'HARNESS_TURN_FAILED',
                  'WORKING_DIRECTORY_MISSING',
                  'SCRIPT_EXIT_CODE',
                  'SCRIPT_TIMEOUT',
                  'INFERENCE_TIMEOUT',
                  'OUTPUT_SCHEMA_MISMATCH',
                  'SUBLOOP_DEPTH_EXCEEDED',
                  'SUBLOOP_NOT_FOUND',
                  'DECISION_NO_ROUTE',
                  'DECIDER_UNAVAILABLE',
                  'SECRET_MISSING',
                  'TEMPLATE_ERROR',
                  'EXPRESSION_ERROR',
                  'WAIT_TIMEOUT',
                  'HEARTBEAT_EXHAUSTED',
                  'RETURN_DELIVERY_FAILED',
                  'MAX_ITERATIONS',
                  'INTERNAL_ERROR',
                ],
              },
              message: { type: 'string', maxLength: 10000 },
              nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
              resumable: { type: 'boolean' },
              details: { allOf: [{ $ref: '#/definitions/__schema0' }] },
            },
            required: ['code', 'message', 'resumable'],
            additionalProperties: false,
          },
        },
        required: ['runId', 'seq', 'ts', 'type', 'failure'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.paused' },
          actor: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['user', 'api-key', 'mcp-client', 'system', 'run'] },
              id: { type: 'string', minLength: 1, maxLength: 256 },
            },
            required: ['kind', 'id'],
            additionalProperties: false,
          },
        },
        required: ['runId', 'seq', 'ts', 'type', 'actor'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.resumed' },
          actor: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['user', 'api-key', 'mcp-client', 'system', 'run'] },
              id: { type: 'string', minLength: 1, maxLength: 256 },
            },
            required: ['kind', 'id'],
            additionalProperties: false,
          },
        },
        required: ['runId', 'seq', 'ts', 'type', 'actor'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.cancel_requested' },
          actor: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['user', 'api-key', 'mcp-client', 'system', 'run'] },
              id: { type: 'string', minLength: 1, maxLength: 256 },
            },
            required: ['kind', 'id'],
            additionalProperties: false,
          },
        },
        required: ['runId', 'seq', 'ts', 'type', 'actor'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.cancelled' },
        },
        required: ['runId', 'seq', 'ts', 'type'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.waiting' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          wait: {
            type: 'object',
            properties: {
              nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
              kind: { type: 'string', enum: ['input', 'timer', 'signal', 'heartbeat', 'child'] },
              until: {
                type: 'string',
                format: 'date-time',
                pattern:
                  '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
              },
              prompt: { type: 'string', maxLength: 10000 },
              inputSchema: {
                type: 'object',
                propertyNames: { type: 'string' },
                additionalProperties: {},
              },
              signalName: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
              childRunId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
              beat: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
              timeoutAt: {
                type: 'string',
                format: 'date-time',
                pattern:
                  '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
              },
              startedSeq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
            },
            required: ['nodeId', 'kind'],
            additionalProperties: false,
          },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'wait'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'run.woken' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          reason: {
            type: 'string',
            enum: ['input', 'timer', 'signal', 'child', 'timeout', 'manual'],
          },
          payload: { allOf: [{ $ref: '#/definitions/__schema0' }] },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'reason'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'iteration.incremented' },
          from: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          to: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          targetNodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
        },
        required: ['runId', 'seq', 'ts', 'type', 'from', 'to', 'targetNodeId'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'node.started' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          kind: { type: 'string' },
          attempt: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          configHash: { type: 'string', maxLength: 128 },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'kind', 'attempt', 'configHash'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'node.finished' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          patch: {
            type: 'array',
            items: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    op: { type: 'string', const: 'add' },
                    path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                    value: { $ref: '#/definitions/__schema0' },
                  },
                  required: ['op', 'path', 'value'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    op: { type: 'string', const: 'remove' },
                    path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                  },
                  required: ['op', 'path'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    op: { type: 'string', const: 'replace' },
                    path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                    value: { $ref: '#/definitions/__schema0' },
                  },
                  required: ['op', 'path', 'value'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    op: { type: 'string', const: 'move' },
                    from: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                    path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                  },
                  required: ['op', 'from', 'path'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    op: { type: 'string', const: 'copy' },
                    from: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                    path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                  },
                  required: ['op', 'from', 'path'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    op: { type: 'string', const: 'test' },
                    path: { type: 'string', pattern: '^(\\/([^/~]|~0|~1)*)*$' },
                    value: { $ref: '#/definitions/__schema0' },
                  },
                  required: ['op', 'path', 'value'],
                  additionalProperties: false,
                },
              ],
            },
          },
          route: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          durationMs: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'patch', 'durationMs'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'node.progress' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          progress: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  item: {
                    oneOf: [
                      // Pre-strict-progress Codex projection: no lifecycle or exit facts were recorded.
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string', minLength: 1, maxLength: 256 },
                          summary: { type: 'string', maxLength: 2000 },
                          type: { type: 'string', const: 'command' },
                        },
                        required: ['id', 'summary', 'type'],
                        additionalProperties: false,
                      },
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string', minLength: 1, maxLength: 256 },
                          summary: { type: 'string', maxLength: 2000 },
                          type: { type: 'string', const: 'command' },
                          commandPreview: { type: 'string', maxLength: 160 },
                          exitCode: {
                            type: 'integer',
                            minimum: -9007199254740991,
                            maximum: 9007199254740991,
                          },
                          status: { type: 'string', enum: ['ok', 'failed', 'running'] },
                        },
                        required: ['id', 'summary', 'type', 'status'],
                        additionalProperties: false,
                      },
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string', minLength: 1, maxLength: 256 },
                          summary: { type: 'string', maxLength: 2000 },
                          type: { type: 'string', const: 'message' },
                          status: { type: 'string', enum: ['ok', 'failed', 'running'] },
                        },
                        required: ['id', 'summary', 'type'],
                        additionalProperties: false,
                      },
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string', minLength: 1, maxLength: 256 },
                          summary: { type: 'string', maxLength: 2000 },
                          type: { type: 'string', const: 'reasoning' },
                          status: { type: 'string', enum: ['ok', 'failed', 'running'] },
                        },
                        required: ['id', 'summary', 'type'],
                        additionalProperties: false,
                      },
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string', minLength: 1, maxLength: 256 },
                          summary: { type: 'string', maxLength: 2000 },
                          type: { type: 'string', const: 'file-change' },
                          status: { type: 'string', enum: ['ok', 'failed', 'running'] },
                        },
                        required: ['id', 'summary', 'type'],
                        additionalProperties: false,
                      },
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string', minLength: 1, maxLength: 256 },
                          summary: { type: 'string', maxLength: 2000 },
                          type: { type: 'string', const: 'tool-call' },
                          status: { type: 'string', enum: ['ok', 'failed', 'running'] },
                        },
                        required: ['id', 'summary', 'type'],
                        additionalProperties: false,
                      },
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string', minLength: 1, maxLength: 256 },
                          summary: { type: 'string', maxLength: 2000 },
                          type: { type: 'string', const: 'search' },
                          status: { type: 'string', enum: ['ok', 'failed', 'running'] },
                        },
                        required: ['id', 'summary', 'type'],
                        additionalProperties: false,
                      },
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string', minLength: 1, maxLength: 256 },
                          summary: { type: 'string', maxLength: 2000 },
                          type: { type: 'string', const: 'error' },
                          status: { type: 'string', enum: ['ok', 'failed', 'running'] },
                        },
                        required: ['id', 'summary', 'type'],
                        additionalProperties: false,
                      },
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string', minLength: 1, maxLength: 256 },
                          summary: { type: 'string', maxLength: 2000 },
                          type: { type: 'string', const: 'other' },
                          status: { type: 'string', enum: ['ok', 'failed', 'running'] },
                        },
                        required: ['id', 'summary', 'type'],
                        additionalProperties: false,
                      },
                    ],
                  },
                },
                required: ['item'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  exitCode: {
                    type: 'integer',
                    minimum: -9007199254740991,
                    maximum: 9007199254740991,
                  },
                  stderr: { type: 'string', maxLength: 2000 },
                  stdoutBytes: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
                },
                required: ['exitCode', 'stderr', 'stdoutBytes'],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'progress'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'harness.session' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          harness: { type: 'string', enum: ['codex'] },
          sessionId: { type: 'string', minLength: 1, maxLength: 256 },
          mode: { type: 'string', enum: ['fresh', 'resumed'] },
          model: { type: 'string' },
          effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'harness', 'sessionId', 'mode'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'harness.usage' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          usage: {
            type: 'object',
            properties: {
              inputTokens: { default: 0, type: 'integer', minimum: 0, maximum: 9007199254740991 },
              outputTokens: { default: 0, type: 'integer', minimum: 0, maximum: 9007199254740991 },
              cachedInputTokens: {
                default: 0,
                type: 'integer',
                minimum: 0,
                maximum: 9007199254740991,
              },
              reasoningOutputTokens: {
                default: 0,
                type: 'integer',
                minimum: 0,
                maximum: 9007199254740991,
              },
            },
            additionalProperties: false,
          },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'usage'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'decision.made' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          strategy: { type: 'string', enum: ['jev', 'codex', 'expression'] },
          classifierModel: { type: 'string', pattern: '^[a-z][a-z0-9_.-]{0,63}$' },
          route: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          alternatives: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                route: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['route'],
              additionalProperties: false,
            },
          },
          skipped: {
            maxItems: 3,
            type: 'array',
            items: {
              type: 'object',
              properties: {
                strategy: { type: 'string', enum: ['jev', 'codex', 'expression'] },
                code: {
                  type: 'string',
                  enum: [
                    'CLASSIFIER_MODEL_NOT_FOUND',
                    'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
                    'CLASSIFIER_MODEL_DISABLED',
                    'CLASSIFIER_SECRET_MISSING',
                    'CLASSIFIER_SECRET_UNREADABLE',
                    'PROVIDER_UNAVAILABLE',
                    'EXPRESSION_NOT_APPLICABLE',
                    'UNDECLARED_ROUTE',
                    'INVALID_CONFIDENCE',
                    'LOW_CONFIDENCE',
                  ],
                },
                message: { type: 'string', minLength: 1, maxLength: 256 },
              },
              required: ['strategy', 'code', 'message'],
              additionalProperties: false,
            },
          },
        },
        // Earlier builds recorded no skipped-strategy list. Present evidence is still validated.
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'strategy', 'route'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'exit.evaluated' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          iteration: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          maxIterations: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          criteria: {
            maxItems: 32,
            type: 'array',
            items: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    index: { type: 'integer', minimum: 0, maximum: 31 },
                    strategy: {
                      type: 'string',
                      enum: [
                        'expression',
                        'jev',
                        'codex',
                        'max-iterations',
                        'max-duration',
                        'last-output-matches',
                      ],
                    },
                    model: { type: 'string', minLength: 1, maxLength: 256 },
                    classifierModel: { type: 'string', pattern: '^[a-z][a-z0-9_.-]{0,63}$' },
                    status: { type: 'string', enum: ['matched', 'not-matched'] },
                    holds: { type: 'boolean' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    minConfidence: { type: 'number', minimum: 0, maximum: 1 },
                    reasoning: { type: 'string', maxLength: 2048 },
                  },
                  required: ['index', 'strategy', 'status'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    index: { type: 'integer', minimum: 0, maximum: 31 },
                    strategy: {
                      type: 'string',
                      enum: [
                        'expression',
                        'jev',
                        'codex',
                        'max-iterations',
                        'max-duration',
                        'last-output-matches',
                      ],
                    },
                    model: { type: 'string', minLength: 1, maxLength: 256 },
                    classifierModel: { type: 'string', pattern: '^[a-z][a-z0-9_.-]{0,63}$' },
                    status: { type: 'string', const: 'skipped' },
                    reason: {
                      type: 'object',
                      properties: {
                        code: {
                          type: 'string',
                          enum: ['EARLIER_CRITERION_MATCHED', 'EARLIER_CRITERION_FAILED'],
                        },
                        message: { type: 'string', minLength: 1, maxLength: 256 },
                      },
                      required: ['code', 'message'],
                      additionalProperties: false,
                    },
                  },
                  required: ['index', 'strategy', 'status', 'reason'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    index: { type: 'integer', minimum: 0, maximum: 31 },
                    strategy: {
                      type: 'string',
                      enum: [
                        'expression',
                        'jev',
                        'codex',
                        'max-iterations',
                        'max-duration',
                        'last-output-matches',
                      ],
                    },
                    model: { type: 'string', minLength: 1, maxLength: 256 },
                    classifierModel: { type: 'string', pattern: '^[a-z][a-z0-9_.-]{0,63}$' },
                    status: { type: 'string', const: 'error' },
                    diagnostic: {
                      type: 'object',
                      properties: {
                        code: {
                          type: 'string',
                          enum: [
                            'CRITERION_ERROR',
                            'RETURN_MAPPING_ERROR',
                            'DECIDER_UNAVAILABLE',
                            'DECIDER_NOT_AUTHENTICATED',
                            'DECIDER_RATE_LIMITED',
                            'DECIDER_HTTP_ERROR',
                            'DECIDER_UNREACHABLE',
                            'DECIDER_INVALID_RESPONSE',
                            'DECIDER_REDIRECT',
                            'DECIDER_TIMEOUT',
                            'DECIDER_ERROR',
                          ],
                        },
                        message: { type: 'string', minLength: 1, maxLength: 256 },
                        status: { type: 'integer', minimum: 100, maximum: 599 },
                      },
                      required: ['code', 'message'],
                      additionalProperties: false,
                    },
                  },
                  required: ['index', 'strategy', 'status', 'diagnostic'],
                  additionalProperties: false,
                },
              ],
            },
          },
          result: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'completed' },
                  outcome: { type: 'string', enum: ['success', 'failure', 'exhausted'] },
                  reason: { type: 'string', enum: ['criterion-matched', 'default-success'] },
                  criterionIndex: { type: 'integer', minimum: 0, maximum: 31 },
                },
                required: ['kind', 'outcome', 'reason'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'looped-back' },
                  reason: { type: 'string', const: 'no-criterion-matched' },
                  targetNodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                },
                required: ['kind', 'reason', 'targetNodeId'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'limit-reached' },
                  limit: {
                    type: 'string',
                    enum: ['max-iterations', 'max-duration', 'iteration-ceiling'],
                  },
                  value: { type: 'number', exclusiveMinimum: 0 },
                  criterionIndex: { type: 'integer', minimum: 0, maximum: 31 },
                  outcome: { type: 'string', const: 'exhausted' },
                },
                required: ['kind', 'limit', 'value', 'outcome'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'failed' },
                  diagnostic: {
                    type: 'object',
                    properties: {
                      code: {
                        type: 'string',
                        enum: [
                          'CRITERION_ERROR',
                          'RETURN_MAPPING_ERROR',
                          'DECIDER_UNAVAILABLE',
                          'DECIDER_NOT_AUTHENTICATED',
                          'DECIDER_RATE_LIMITED',
                          'DECIDER_HTTP_ERROR',
                          'DECIDER_UNREACHABLE',
                          'DECIDER_INVALID_RESPONSE',
                          'DECIDER_REDIRECT',
                          'DECIDER_TIMEOUT',
                          'DECIDER_ERROR',
                        ],
                      },
                      message: { type: 'string', minLength: 1, maxLength: 256 },
                      status: { type: 'integer', minimum: 100, maximum: 599 },
                    },
                    required: ['code', 'message'],
                    additionalProperties: false,
                  },
                },
                required: ['kind', 'diagnostic'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'cancelled' } },
                required: ['kind'],
                additionalProperties: false,
              },
            ],
          },
        },
        required: [
          'runId',
          'seq',
          'ts',
          'type',
          'nodeId',
          'iteration',
          'maxIterations',
          'criteria',
          'result',
        ],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'signal.received' },
          name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          payload: { allOf: [{ $ref: '#/definitions/__schema0' }] },
        },
        required: ['runId', 'seq', 'ts', 'type', 'name'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'input.received' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          payload: { $ref: '#/definitions/__schema0' },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'payload'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'heartbeat.beat' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          beat: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          result: { allOf: [{ $ref: '#/definitions/__schema0' }] },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'beat'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'child_run.started' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          childRunId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'childRunId'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'child_run.finished' },
          nodeId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          childRunId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          outcome: { type: 'string', enum: ['success', 'failure', 'exhausted'] },
          status: {
            type: 'string',
            enum: [
              'queued',
              'running',
              'waiting',
              'paused',
              'succeeded',
              'failed',
              'cancelled',
              'exhausted',
            ],
          },
        },
        required: ['runId', 'seq', 'ts', 'type', 'nodeId', 'childRunId', 'status'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'return.delivered' },
          channel: {
            oneOf: [
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'caller' } },
                required: ['kind'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'webhook' },
                  url: { type: 'string', format: 'uri' },
                  secretRef: { type: 'string', maxLength: 128 },
                },
                required: ['kind', 'url'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'file' },
                  path: { type: 'string', minLength: 1, maxLength: 4096 },
                  format: { default: 'json', type: 'string', enum: ['json', 'markdown', 'text'] },
                },
                required: ['kind', 'path'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'event' },
                  eventType: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                },
                required: ['kind', 'eventType'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'log' } },
                required: ['kind'],
                additionalProperties: false,
              },
            ],
          },
          target: { type: 'string', maxLength: 4096 },
        },
        required: ['runId', 'seq', 'ts', 'type', 'channel'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          runId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
          seq: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
          ts: {
            type: 'string',
            format: 'date-time',
            pattern:
              '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
          },
          type: { type: 'string', const: 'return.failed' },
          channel: {
            oneOf: [
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'caller' } },
                required: ['kind'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'webhook' },
                  url: { type: 'string', format: 'uri' },
                  secretRef: { type: 'string', maxLength: 128 },
                },
                required: ['kind', 'url'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'file' },
                  path: { type: 'string', minLength: 1, maxLength: 4096 },
                  format: { default: 'json', type: 'string', enum: ['json', 'markdown', 'text'] },
                },
                required: ['kind', 'path'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', const: 'event' },
                  eventType: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
                },
                required: ['kind', 'eventType'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { kind: { type: 'string', const: 'log' } },
                required: ['kind'],
                additionalProperties: false,
              },
            ],
          },
          error: { type: 'string', maxLength: 4000 },
        },
        required: ['runId', 'seq', 'ts', 'type', 'channel', 'error'],
        additionalProperties: false,
      },
    ],
    definitions: {
      __schema0: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          { type: 'array', items: { $ref: '#/definitions/__schema0' } },
          {
            type: 'object',
            propertyNames: { type: 'string' },
            additionalProperties: { $ref: '#/definitions/__schema0' },
          },
        ],
      },
    },
  },
};
