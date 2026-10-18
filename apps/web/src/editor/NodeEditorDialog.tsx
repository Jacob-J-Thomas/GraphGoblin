import {
  NodeConfigSchemas,
  SlugSchema,
  type LoopDefinitionInput,
  type NodeInput,
} from '@graphgoblin/contracts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/icons/index.js';
import {
  Button,
  Dialog,
  FieldGroup,
  HelpText,
  Input,
  Label,
  RequiredNote,
  type DialogCloseReason,
} from '../components/ui/index.js';
import { createDisclosureIdentities, type DisclosureStates } from '../forms/disclosures.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { FieldLabelsContext } from '../forms/fields/shared.js';
import { VariableSuggestionsContext } from '../forms/fields/suggestions.js';
import { JsonApplyReviewContext, JsonCandidateContext } from '../forms/fields/json.js';
import { removedAnswerConnections } from './decision-route-edges.js';
import {
  FormEditReviewContext,
  ReorderablePathsContext,
  type FormEditRequest,
  type FormEditApply,
} from '../forms/edit-review.js';
import { convertDecision, decisionFieldLabel } from './decision-authoring.js';
import { DecisionKindPicker } from './DecisionKindPicker.js';
import { DecisionAnswerPicker } from './DecisionAnswerPicker.js';
import { EXIT_FIELD_OVERRIDES } from './ExitFields.js';

import { hasRepeatRoute, cleanGateLimits } from './decision-gates.js';
import { TriggerPresets } from './TriggerPresets.js';
import {
  TriggerTypePicker,
  WebhookAuthenticationPicker,
  WebhookEventTypePicker,
} from './TriggerTypePicker.js';
import { POLL_FIELD_LABELS, WEBHOOK_FIELD_LABELS } from './trigger-field-labels.js';
import { CatalogWarningsContext } from '../forms/fields/model.js';
import { GateLimitIssuesContext } from './DecisionGateFields.js';
import { canvasFocusTarget } from './canvas-focus.js';
import { DECISION_FIELD_OVERRIDES, NODE_FIELD_CONTROLS } from './field-controls.js';
import { focusIssuePath, groupFocus } from './focus-field.js';
import { IssueBadge } from './IssueBadge.js';
import { KindChip } from './KindChip.js';
import { KIND_INFO, type EditorIssue } from './model.js';
import { NodeConnections } from './NodeConnections.js';
import { SubloopPicker } from './SubloopPicker.js';
import { useEditorStore } from './store.js';

/** Why `draft` cannot become the id of node `nodeId`, or undefined when it can (or is unchanged). */
const DECISION_UNION_PICKERS = {
  '': DecisionKindPicker,
  answer: DecisionAnswerPicker,
};
const DECISION_FIELD_ORDER = ['instructions', 'jsonata', 'routes', 'answer'] as const;
const CLASSIFIER_FIELD_ORDER = ['question', 'model', 'answer'] as const;
const TRIGGER_UNION_PICKERS = {
  '': TriggerTypePicker,
  authentication: WebhookAuthenticationPicker,
  eventType: WebhookEventTypePicker,
};
const DECISION_FIELD_LABELS = {
  minConfidence: 'Min confidence',
  truthThreshold: 'Noul true-probability threshold',
  maxPasses: 'Maximum passes',
  maxRunTimeSeconds: 'Maximum run time (seconds)',
};
const DEFAULT_FIELD_LABELS = {};
const DECISION_REORDERABLE = ['routes', 'answer.options', 'answer.bands'];
const NO_REORDERABLE: readonly string[] = [];

export function idProblem(
  draft: string,
  nodeId: string,
  definition: LoopDefinitionInput,
): string | undefined {
  if (draft === nodeId) return undefined;
  if (!SlugSchema.safeParse(draft).success)
    return 'Use a letter first, then letters, digits, _ or -';
  if (definition.nodes.some((n) => n.id === draft)) return `"${draft}" is already used`;
  return undefined;
}

function subloopId(config: unknown): string {
  const ref = (config as { loopRef?: { loopId?: unknown } } | undefined)?.loopRef;
  return typeof ref?.loopId === 'string' ? ref.loopId : '';
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function answerType(config: unknown): 'choice' | 'noul' | 'score' | undefined {
  const type = record(record(config)['answer'])['type'];
  return type === 'choice' || type === 'noul' || type === 'score' ? type : undefined;
}

/** The heading of the dialog `from` sits in (it names the dialog). */
function dialogHeading(from: Element | null): HTMLElement | null {
  const id = from?.closest('dialog')?.getAttribute('aria-labelledby');
  return id ? document.getElementById(id) : null;
}

/**
 * Focus the field at an issue's path inside the node editor's body (`root`): a config field, the
 * id, or the label. Without a path, or when no field matches, focus goes to the dialog's heading.
 */
function focusIssue(root: HTMLElement | null, path: string | undefined): void {
  if (!root) return;
  if (path && focusIssuePath(root, path)) return;
  dialogHeading(root)?.focus();
}

/**
 * The id being typed for a node. It applies on Enter, on leaving the field, and when the dialog
 * closes; `warned` is the text the user was already stopped for once.
 */
interface IdDraft {
  /** The node id this draft was typed for; a draft for another id is stale. */
  for: string;
  /** The store's `historyEpoch` it was typed in; an undo or redo since makes it stale too. */
  epoch: number;
  value: string;
  error?: string | undefined;
  warned?: string | undefined;
}

/**
 * The editor of one node, in a modal dialog named "Edit <kind> <id>": the node's issue badge beside
 * the title (choosing an issue focuses its field), id, label, the subloop picker, the config form
 * generated from the kind's schema, its connections with the Connect form (the keyboard path for
 * edges), and Delete node. Opened at an issue (`openNode(id, { field })`), it focuses that field. Every edit goes to the
 * store as it is made (and autosaves from there), so closing never discards anything, with one
 * exception handled here: an id still being typed. A valid one is applied on close; an invalid one
 * keeps the dialog open once, with the reason, and is dropped if the user closes again.
 */
export function NodeEditorDialog({
  node,
  definition,
  issues,
  loopId,
  notice,
}: {
  node: NodeInput;
  definition: LoopDefinitionInput;
  issues: EditorIssue[];
  loopId: string;
  /** Shown at the top of the dialog, for notices that need an answer while it is open. */
  notice?: ReactNode;
}) {
  const fieldErrors = useEditorStore((s) => s.fieldErrors);
  const nodeFocus = useEditorStore((s) => s.nodeFocus);
  // Bumped by undo and redo: the config form remounts with the restored values.
  const historyEpoch = useEditorStore((s) => s.historyEpoch);
  const generation = useEditorStore((s) => s.generation);
  const bodyRef = useRef<HTMLElement>(null);
  const pendingHarnessFocusRef = useRef(false);
  const [epoch, setEpoch] = useState(0);
  const [review, setReview] = useState<{
    title: string;
    lost: string[];
    incomplete: string[];
    blocked?: string | undefined;
    apply: () => void;
    config: unknown;
    edges: LoopDefinitionInput['edges'];
    historyEpoch: number;
    focusPath: string;
    routing?: string | undefined;
  }>();
  const activeReview =
    review?.config === node.config &&
    review?.edges === definition.edges &&
    review?.historyEpoch === historyEpoch
      ? review
      : undefined;
  const reviewRef = useRef<HTMLDivElement>(null);
  const reviewReturnRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (review) reviewRef.current?.focus();
  }, [review]);
  // Which of the config form's disclosures are open (Advanced, collapsed list items). Kept here,
  // not in the form, so the remounts below (undo and redo, a subloop pick) keep what the user
  // opened; the dialog is mounted per node and per opening, so another node starts collapsed.
  const [openDisclosures, setOpenDisclosures] = useState<DisclosureStates>({});
  const [disclosureIdentities] = useState(createDisclosureIdentities);
  const disclosures = useMemo(
    () => ({
      open: openDisclosures,
      setOpen: setOpenDisclosures,
      identities: disclosureIdentities,
    }),
    [openDisclosures, disclosureIdentities],
  );
  const [idState, setIdState] = useState<IdDraft>({
    for: node.id,
    epoch: historyEpoch,
    value: node.id,
  });
  // After a rename the node has its new id, which the draft already holds.
  const id: IdDraft =
    idState.for === node.id && idState.epoch === historyEpoch
      ? idState
      : { for: node.id, epoch: historyEpoch, value: node.id };
  const { updateNode, removeNode, renameNode, closeNodeDialog, setFieldError } =
    useEditorStore.getState();
  const info = KIND_INFO[node.kind];
  const nodeIssues = useMemo(() => issues.filter((i) => i.nodeId === node.id), [issues, node.id]);
  const variables = useMemo(() => Object.keys(definition.variables ?? {}), [definition.variables]);
  const lostGateLimits = () =>
    ['maxPasses', 'maxRunTimeSeconds'].flatMap((path) => {
      const held = fieldErrors[`node:${node.id}`]?.[path];
      return record(node.config)[path] !== undefined || held
        ? [
            `${path === 'maxPasses' ? 'Maximum passes' : 'Maximum run time'}${held ? ' (unfinished text)' : ''}`,
          ]
        : [];
    });
  const normalizeJsonCandidate = useMemo(
    () => (candidate: unknown) =>
      node.kind === 'decision' && hasRepeatRoute(node.config)
        ? cleanGateLimits(candidate)
        : candidate,
    [node.kind, node.config],
  );
  const reviewJsonApply = useMemo(
    () => (path: string, next: unknown) => {
      if (node.kind !== 'decision' || (path !== 'answer' && path !== 'routes')) return [];
      const removedGate =
        hasRepeatRoute(node.config) && !hasRepeatRoute({ ...record(node.config), [path]: next });
      return [
        ...(removedGate
          ? ['maxPasses', 'maxRunTimeSeconds'].flatMap((key) =>
              record(node.config)[key] !== undefined || fieldErrors[`node:${node.id}`]?.[key]
                ? [
                    {
                      id: key,
                      description: `${key === 'maxPasses' ? 'Maximum passes' : 'Maximum run time'}${fieldErrors[`node:${node.id}`]?.[key] ? ' (unfinished text)' : ''}`,
                      kind: 'field' as const,
                    },
                  ]
                : [],
            )
          : []),
        ...removedAnswerConnections(definition.edges, node.id, next).map((edge) => ({
          id: edge.id,
          description: `${edge.from.port ?? '(no route)'} → ${edge.to.node}`,
        })),
      ];
    },
    [definition.edges, node.id, node.kind, node.config, fieldErrors],
  );
  const catalogWarnings = useMemo(
    () =>
      nodeIssues.map((issue) => ({
        ...issue,
        path: issue.path?.startsWith('config.') ? issue.path.slice('config.'.length) : issue.path,
      })),
    [nodeIssues],
  );
  const labelIssue = nodeIssues.find((i) => i.path === 'label' && i.severity === 'error');
  // The loop's errors about config fields (template and expression syntax, the API's checks), so
  // a collapsed Advanced group or operation holding one says so.
  const configProblems = nodeIssues.flatMap((i) =>
    i.severity === 'error' && i.path?.startsWith('config.') ? [i.path.slice('config.'.length)] : [],
  );

  // Opened at an issue: focus its field once the form is in place (the dialog has focused its
  // heading by now), then forget the request. The clear waits a task, so a Strict Mode replay of
  // this effect still finds the request.
  useEffect(() => {
    if (nodeFocus?.nodeId !== node.id) return;
    focusIssue(bodyRef.current, nodeFocus.field);
    const timer = setTimeout(() => useEditorStore.getState().clearNodeFocus(), 0);
    return () => clearTimeout(timer);
  }, [nodeFocus, node.id]);

  useLayoutEffect(() => {
    if (!pendingHarnessFocusRef.current) return;
    pendingHarnessFocusRef.current = false;
    bodyRef.current
      ?.querySelector<HTMLInputElement>('input[type="radio"][value="claude"]')
      ?.focus();
  }, [epoch]);

  const commitId = () => {
    const error = idProblem(id.value, node.id, definition);
    setIdState({ ...id, error });
    if (!error && id.value !== node.id) renameNode(node.id, id.value);
  };

  const handleConfigChange = (config: unknown, change: Parameters<typeof updateNode>[2]) => {
    if (node.kind === 'decision' && hasRepeatRoute(node.config) && !hasRepeatRoute(config)) {
      config = cleanGateLimits(config);
      for (const path of ['maxPasses', 'maxRunTimeSeconds'])
        setFieldError(`node:${node.id}`, path, undefined, undefined, change);
      setEpoch((current) => current + 1);
    }
    if (
      node.kind === 'inference' &&
      change?.path === 'harness' &&
      record(config)['harness'] === 'claude' &&
      node.config.harness !== 'claude'
    ) {
      // Switching harness is explicit; start with Claude's least-privileged supported policy.
      pendingHarnessFocusRef.current =
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.type === 'radio';
      config = {
        ...record(config),
        harnessOptions: {
          ...record(record(config)['harnessOptions']),
          sandbox: 'read-only',
          approval: 'never',
        },
      };
      setEpoch((current) => current + 1);
    }
    if (node.kind === 'decision' && change?.path === 'answer') {
      const raw = record(config);
      const normalized =
        answerType(config) !== 'noul' && raw['truthThreshold'] !== undefined
          ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'truthThreshold'))
          : config;
      if (normalized !== config) setEpoch((current) => current + 1);
      updateNode(node.id, { config: normalized }, change);
      return;
    }
    updateNode(node.id, { config }, change);
  };

  const reviewEdit = (request: FormEditRequest, apply: FormEditApply) => {
    if (node.kind !== 'decision') return apply(request.value);
    reviewReturnRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (request.type === 'gate') {
      setReview({
        config: node.config,
        edges: definition.edges,
        historyEpoch,
        focusPath: request.path,
        title: 'Remove repeat route?',
        lost: [
          ...lostGateLimits(),
          ...definition.edges
            .filter((e) => e.from.node === node.id && e.from.port === 'limit-reached')
            .map((e) => `Connection Limit reached → ${e.to.node} (${e.id})`),
        ],
        incomplete: [],
        apply: () => apply(request.value),
      });
      return;
    }
    if (request.type === 'variant' && (request.path === '' || request.path === 'answer')) {
      const converted = convertDecision(
        node.config,
        request.path === '' ? record(request.value)['kind'] : 'classifier',
        request.path === 'answer' ? record(request.value)['type'] : undefined,
      );
      const held = Object.keys(fieldErrors[`node:${node.id}`] ?? {}).filter(
        (path) =>
          ![...converted.keep, ...converted.moves.map(({ from }) => from)].some(
            (key) => path === key || path.startsWith(`${key}.`),
          ),
      );
      setReview({
        config: node.config,
        edges: definition.edges,
        historyEpoch,
        focusPath: request.path || 'kind',
        title: request.path === '' ? 'Change decision kind?' : 'Change classifier answer type?',
        lost: [
          ...converted.lost,
          ...held.map((path) => `${decisionFieldLabel(node.config, path)} (unfinished text)`),
        ],
        incomplete: converted.incomplete,
        routing:
          record(converted.config['answer'])['type'] === 'noul' && !converted.blocked
            ? `True → ${String(record(record(converted.config['answer'])['true'])['label'])} (${String(record(record(converted.config['answer'])['true'])['id'])}); false → ${String(record(record(converted.config['answer'])['false'])['label'])} (${String(record(record(converted.config['answer'])['false'])['id'])}). Review that these sides match your question.`
            : undefined,
        blocked: converted.blocked,
        apply: () =>
          apply(
            request.path === '' ? converted.config : converted.config['answer'],
            converted.keep,
            converted.moves,
          ),
      });
      return;
    }
    if (
      request.type === 'remove' &&
      ['routes', 'answer.options', 'answer.bands'].includes(request.path)
    ) {
      const owned =
        useEditorStore.getState().decisionRoutes[node.id]?.rows[request.index!]?.edgeIds ?? [];
      const rows =
        request.path === 'routes'
          ? record(node.config)['routes']
          : record(record(node.config)['answer'])[
              request.path === 'answer.options' ? 'options' : 'bands'
            ];
      const removedRepeat = Array.isArray(rows) && record(rows[request.index!])['repeat'] === true;
      const edges = definition.edges.filter(
        (edge) =>
          owned.includes(edge.id) ||
          (removedRepeat && edge.from.node === node.id && edge.from.port === 'limit-reached'),
      );
      if (edges.length || removedRepeat) {
        setReview({
          config: node.config,
          edges: definition.edges,
          historyEpoch,
          focusPath: request.path,
          title: 'Remove connected route?',
          lost: [
            ...(removedRepeat ? lostGateLimits() : []),
            ...edges.map((edge) => `Connection ${edge.from.port} → ${edge.to.node} (${edge.id})`),
          ],
          incomplete: [],
          apply: () => apply(request.value),
        });
        return;
      }
    }
    apply(request.value);
  };

  const requestClose = (reason: DialogCloseReason) => {
    const error = idProblem(id.value, node.id, definition);
    if (!error && id.value !== node.id) {
      renameNode(node.id, id.value);
    } else if (error && reason !== 'dismissed' && id.warned !== id.value) {
      // Stop once for an id that cannot apply, so typed text is never dropped unseen.
      setIdState({ ...id, error, warned: id.value });
      document.getElementById('node-id')?.focus();
      return;
    }
    closeNodeDialog();
  };

  return (
    <Dialog
      open
      className="lg:w-[min(78rem,calc(100vw-2rem))] xl:w-[min(96rem,calc(100vw-2rem))]"
      onClose={requestClose}
      icon={<KindChip kind={node.kind} />}
      actions={
        nodeIssues.length > 0 ? (
          <IssueBadge
            nodeId={node.id}
            issues={nodeIssues}
            onChoose={(issue) => focusIssue(bodyRef.current, issue.path)}
            fallbackFocus={() => dialogHeading(bodyRef.current)}
          />
        ) : undefined
      }
      title={
        <>
          Edit {info.label.toLowerCase()}{' '}
          <span className="block font-mono text-sm font-regular text-muted">{node.id}</span>
        </>
      }
      returnFocus={() => canvasFocusTarget(useEditorStore.getState().selectedNodeId)}
      footer={
        <>
          <Button size="sm" variant="destructive" onClick={() => removeNode(node.id)}>
            <Icon name="trash" />
            Delete node
          </Button>
          <Button size="sm" className="ml-auto" onClick={() => requestClose('button')}>
            Done
          </Button>
        </>
      }
    >
      <section ref={bodyRef} aria-label="Node properties" className="grid gap-field">
        {notice}
        <RequiredNote />
        {/* Issue paths `id` and `label` name these fields (focus-field.ts). */}
        <div data-field-scope="node" className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <FieldGroup data-field="id">
            <Label htmlFor="node-id" required>
              Node id
            </Label>
            <Input
              id="node-id"
              className="font-mono text-sm"
              value={id.value}
              aria-required
              aria-invalid={id.error ? true : undefined}
              aria-describedby={id.error ? 'node-id-error' : undefined}
              onChange={(e) => setIdState({ ...id, value: e.target.value })}
              onBlur={commitId}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitId();
              }}
            />
            {id.error ? (
              <HelpText id="node-id-error" role="alert" tone="bad">
                {id.error}
              </HelpText>
            ) : null}
          </FieldGroup>
          <FieldGroup data-field="label">
            <Label htmlFor="node-label" required>
              Label
            </Label>
            <Input
              id="node-label"
              aria-required
              aria-invalid={labelIssue ? true : undefined}
              aria-describedby={labelIssue ? 'node-label-error' : undefined}
              value={node.label}
              onChange={(e) => updateNode(node.id, { label: e.target.value })}
            />
            {/* The loop's validation of the label (a blank one, say), beside the field too. */}
            {labelIssue ? (
              <HelpText id="node-label-error" role="alert" tone="bad">
                {labelIssue.message}
              </HelpText>
            ) : null}
          </FieldGroup>
        </div>
        {node.kind === 'subloop' ? (
          <SubloopPicker
            currentLoopId={loopId}
            value={subloopId(node.config)}
            onPick={(picked) => {
              const cfg = (node.config ?? {}) as Record<string, unknown>;
              const ref = (cfg['loopRef'] ?? {}) as Record<string, unknown>;
              updateNode(node.id, { config: { ...cfg, loopRef: { ...ref, loopId: picked } } });
              setEpoch((e) => e + 1);
            }}
          />
        ) : null}
        {/* Not keyed by the node id: a rename keeps the form (and focus) where it is. Issue paths
            `config.<path>` name its fields (focus-field.ts). */}
        <div data-field-scope="config" className="grid min-w-0">
          {node.kind === 'trigger' ? (
            <HelpText>
              Use a downstream decision for payload checks. Route unwanted input to a quiet success
              exit with no returns or destinations.
            </HelpText>
          ) : null}
          {node.kind === 'exit' ? (
            <HelpText>
              Exits finish the run with Success, Failure or Exhausted. Returns is a JSONata
              expression, or none. Destinations receive the returned value.
            </HelpText>
          ) : null}
          {node.kind === 'decision' && hasRepeatRoute(node.config) ? (
            <HelpText>
              Limit reached is taken when a limit stops the chosen repeat route. Connect it to an
              Exhausted exit. Evaluation happens first: a non-repeat choice wins on the last pass.
            </HelpText>
          ) : null}
          {activeReview ? (
            <div
              ref={reviewRef}
              role="region"
              aria-label={activeReview.title}
              tabIndex={-1}
              className="my-3 grid gap-3 rounded-md border border-default p-4"
            >
              <p className="font-semibold">{activeReview.title}</p>
              {activeReview.blocked ? (
                <p role="alert">{activeReview.blocked}</p>
              ) : (
                <>
                  <p>
                    {['Remove connected route?', 'Remove repeat route?'].includes(
                      activeReview.title,
                    )
                      ? 'The repeat settings and listed connections will be removed together in one undoable edit.'
                      : 'Route IDs, labels and representable connections stay together. This is one undoable edit.'}
                  </p>
                  {activeReview.routing ? <p>{activeReview.routing}</p> : null}
                  {activeReview.lost.length ? (
                    <>
                      <p>These fields or connections will be removed:</p>
                      <ul className="list-disc pl-4">
                        {activeReview.lost.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>No authored fields will be lost.</p>
                  )}
                  {activeReview.incomplete.length ? (
                    <p>
                      Complete before saving and publishing: {activeReview.incomplete.join(', ')}.
                      No source or criteria are generated.
                    </p>
                  ) : null}
                </>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setReview(undefined);
                    requestAnimationFrame(() => {
                      const target = reviewReturnRef.current;
                      if (target && bodyRef.current) groupFocus(target, bodyRef.current).focus();
                    });
                  }}
                >
                  Cancel change
                </Button>
                {!activeReview.blocked ? (
                  <Button
                    onClick={() => {
                      activeReview.apply();
                      setReview(undefined);
                      requestAnimationFrame(() => {
                        focusIssue(bodyRef.current, `config.${activeReview.focusPath}`);
                      });
                    }}
                  >
                    Confirm change
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          <FormEditReviewContext value={reviewEdit}>
            <ReorderablePathsContext
              value={node.kind === 'decision' ? DECISION_REORDERABLE : NO_REORDERABLE}
            >
              <CatalogWarningsContext value={catalogWarnings}>
                <GateLimitIssuesContext value={nodeIssues}>
                  <FieldLabelsContext
                    value={
                      node.kind === 'trigger' && node.config?.type === 'poll'
                        ? POLL_FIELD_LABELS
                        : node.kind === 'trigger' && node.config?.type === 'webhook'
                          ? WEBHOOK_FIELD_LABELS
                          : node.kind === 'decision'
                            ? DECISION_FIELD_LABELS
                            : DEFAULT_FIELD_LABELS
                    }
                  >
                    <VariableSuggestionsContext value={variables}>
                      <JsonApplyReviewContext value={reviewJsonApply}>
                        <JsonCandidateContext value={normalizeJsonCandidate}>
                          <fieldset
                            disabled={activeReview !== undefined}
                            inert={activeReview !== undefined}
                            className="grid min-w-0 gap-0 border-0 p-0"
                          >
                            <SchemaForm
                              key={`${node.kind}:${epoch}:${historyEpoch}`}
                              schema={NodeConfigSchemas[node.kind]}
                              fieldOrder={
                                node.kind === 'decision'
                                  ? node.config.kind === 'classifier'
                                    ? CLASSIFIER_FIELD_ORDER
                                    : DECISION_FIELD_ORDER
                                  : undefined
                              }
                              value={node.config}
                              label={`${node.id} config`}
                              controls={NODE_FIELD_CONTROLS}
                              unionPickers={
                                node.kind === 'decision'
                                  ? DECISION_UNION_PICKERS
                                  : node.kind === 'trigger'
                                    ? TRIGGER_UNION_PICKERS
                                    : undefined
                              }
                              fieldOverrides={
                                node.kind === 'decision'
                                  ? DECISION_FIELD_OVERRIDES
                                  : node.kind === 'exit'
                                    ? EXIT_FIELD_OVERRIDES
                                    : undefined
                              }
                              problems={configProblems}
                              disclosures={disclosures}
                              onChange={handleConfigChange}
                              parseErrors={fieldErrors[`node:${node.id}`]}
                              onParseError={(path, error, reason, change) =>
                                setFieldError(`node:${node.id}`, path, error, reason, change)
                              }
                            />
                          </fieldset>
                        </JsonCandidateContext>
                      </JsonApplyReviewContext>
                    </VariableSuggestionsContext>
                  </FieldLabelsContext>
                </GateLimitIssuesContext>
              </CatalogWarningsContext>
            </ReorderablePathsContext>
          </FormEditReviewContext>
          {node.kind === 'trigger' ? (
            <TriggerPresets
              config={node.config}
              definition={definition}
              triggerId={node.id}
              draftInputs={fieldErrors}
              generation={generation}
              heldInputs={fieldErrors[`node:${node.id}`]}
              historyEpoch={historyEpoch}
              onApply={(preview) => {
                const problem = useEditorStore.getState().applyGitHubPreset(preview, {
                  fieldErrors,
                  historyEpoch,
                  generation,
                });
                if (problem) return problem;
                setEpoch((current) => current + 1);
                requestAnimationFrame(() => focusIssue(bodyRef.current, 'config.type'));
                return undefined;
              }}
            />
          ) : null}
        </div>
        <NodeConnections node={node} definition={definition} />
      </section>
    </Dialog>
  );
}
