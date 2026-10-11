import {
  NodeConfigSchemas,
  SlugSchema,
  type LoopDefinitionInput,
  type DecisionAnswer,
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
import { nextChangeId } from '../forms/changes.js';
import { isUnset } from '../forms/unset.js';
import { DecisionKindPicker } from './DecisionKindPicker.js';
import { DecisionAnswerPicker } from './DecisionAnswerPicker.js';
import { EXIT_PREDICATE_FIELD_OVERRIDES } from './ExitPredicateFields.js';
import { TriggerPresets } from './TriggerPresets.js';
import { CatalogWarningsContext } from '../forms/fields/model.js';
import { canvasFocusTarget } from './canvas-focus.js';
import { DECISION_FIELD_OVERRIDES, NODE_FIELD_CONTROLS } from './field-controls.js';
import { focusIssuePath } from './focus-field.js';
import { IssueBadge } from './IssueBadge.js';
import { KindChip } from './KindChip.js';
import { KIND_INFO, type EditorIssue } from './model.js';
import { NodeConnections } from './NodeConnections.js';
import { SubloopPicker } from './SubloopPicker.js';
import { useEditorStore } from './store.js';

/** Why `draft` cannot become the id of node `nodeId`, or undefined when it can (or is unchanged). */
const DECISION_UNION_PICKERS = {
  answer: DecisionAnswerPicker,
  evaluation: DecisionKindPicker,
};
const DECISION_FIELD_ORDER = ['answer', 'evaluation'] as const;
const DECISION_FIELD_LABELS = {
  'evaluation.minConfidence': 'Min confidence',
  'evaluation.truthThreshold': 'Noul true-probability threshold',
};
const POLL_FIELD_LABELS = {
  dedupeKey: 'Whole-probe dedupe key (single-result only)',
  'items.dedupeKey': 'Per-item dedupe key',
};
const DEFAULT_FIELD_LABELS = {};

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

function answerType(config: unknown): DecisionAnswer['type'] | undefined {
  const type = record(record(config)['answer'])['type'];
  return type === 'choice' || type === 'noul' || type === 'score' ? type : undefined;
}

const EXIT_ANSWER_DEFAULTS = {
  choice: {
    type: 'choice',
    options: [
      { id: 'yes', label: 'Yes', criteria: 'The predicate matches' },
      { id: 'no', label: 'No', criteria: 'The predicate does not match' },
    ],
  },
  noul: {
    type: 'noul',
    true: { label: 'True', criteria: 'The predicate is true' },
    false: { label: 'False', criteria: 'The predicate is false' },
  },
  score: {
    type: 'score',
    anchors: ['Does not meet the rubric', 'Partly meets the rubric', 'Fully meets the rubric'],
  },
} as const;

function answerPrimitive(value: unknown): 'choice' | 'noul' | 'score' | undefined {
  const type = record(value)['type'];
  return type === 'choice' || type === 'noul' || type === 'score' ? type : undefined;
}

function exitMatchDefault(answer: Record<string, unknown>) {
  const type = answerPrimitive(answer);
  if (type === 'choice') {
    const options = Array.isArray(answer['options']) ? answer['options'].map(record) : [];
    const first = options.find(
      (option) => typeof option['id'] === 'string' && option['id'] !== '',
    )?.['id'];
    return {
      type,
      optionIds: typeof first === 'string' ? [first] : [],
    };
  }
  if (type === 'score') return { type, operator: 'gte', value: 0 };
  return {
    type: 'noul',
    value: true,
  };
}

/** Keep an exit predicate's answer, evaluator and match variants in a usable combination. */
function exitPredicateVariantChange(config: unknown, previous: unknown, path?: string): unknown {
  const changed = /^criteria\.(\d+)(?:\.(answer|evaluation))?$/.exec(path ?? '');
  if (!changed) return config;
  const index = Number(changed[1]);
  const section = changed[2];
  const currentConfig = record(config);
  const previousConfig = record(previous);
  const criteria: unknown[] = Array.isArray(currentConfig['criteria'])
    ? currentConfig['criteria']
    : [];
  const oldCriteria: unknown[] = Array.isArray(previousConfig['criteria'])
    ? previousConfig['criteria']
    : [];
  const row = record(criteria[index]);
  if (row['when'] !== 'predicate') return config;
  const oldRow = record(oldCriteria[index]);
  let answer = { ...record(row['answer']) };
  let evaluation = { ...record(row['evaluation']) };
  const oldAnswerType = answerPrimitive(oldRow['answer']);
  let answerTypeNow = answerPrimitive(answer);
  const oldEvaluationKind = record(oldRow['evaluation'])['kind'];
  let evaluationKindNow = evaluation['kind'];
  let changedRow = { ...row };
  const newPredicate = section === undefined && oldRow['when'] !== 'predicate';
  const answerChanged =
    section === 'answer' && oldAnswerType !== answerTypeNow && answerTypeNow !== undefined;
  const evaluationChanged =
    section === 'evaluation' &&
    oldEvaluationKind !== evaluationKindNow &&
    (evaluationKindNow === 'expression' ||
      evaluationKindNow === 'classifier' ||
      evaluationKindNow === 'llm');
  if (!newPredicate && !answerChanged && !evaluationChanged) return config;

  if (newPredicate) {
    // Expression exit predicates are Noul-only, so start with the coherent boolean form.
    answer = { type: 'noul' };
    answerTypeNow = 'noul';
    evaluation = { kind: 'expression', jsonata: 'true' };
    evaluationKindNow = 'expression';
  }

  if (answerChanged) {
    if (answerTypeNow === 'noul') {
      Object.assign(
        answer,
        evaluationKindNow === 'expression' ? { type: 'noul' } : EXIT_ANSWER_DEFAULTS.noul,
      );
    } else if (answerTypeNow === 'choice' && !Array.isArray(answer['options'])) {
      Object.assign(answer, EXIT_ANSWER_DEFAULTS.choice);
    }
    if (answerTypeNow === 'score' && evaluationKindNow !== 'classifier') {
      const question =
        typeof evaluation['question'] === 'string'
          ? evaluation['question']
          : 'Evaluate the current input against the ordered rubric.';
      evaluation = { kind: 'classifier', model: '', question };
      evaluationKindNow = 'classifier';
    } else if (evaluationKindNow === 'expression' && answerTypeNow === 'choice') {
      evaluation = {
        kind: 'classifier',
        model: '',
        question: 'Evaluate the current input against the declared Choice options.',
      };
      evaluationKindNow = 'classifier';
    } else if (evaluationKindNow === 'expression') {
      const first = Array.isArray(answer['options'])
        ? record(answer['options'][0])['id']
        : undefined;
      evaluation = {
        ...evaluation,
        jsonata:
          answerTypeNow === 'noul'
            ? 'true'
            : JSON.stringify(typeof first === 'string' ? first : 'yes'),
      };
    }
  }

  if (evaluationChanged) {
    if (answerTypeNow === 'noul') {
      if (evaluationKindNow === 'expression') answer = { type: 'noul' };
      else if (!('true' in answer) || !('false' in answer))
        Object.assign(answer, EXIT_ANSWER_DEFAULTS.noul);
    }
  }

  if (
    (answerChanged || evaluationChanged) &&
    answerTypeNow === 'score' &&
    evaluationKindNow !== 'classifier'
  ) {
    // Score cannot be authored with expression or Codex. Keep the question when converting LLM.
    const question =
      typeof evaluation['question'] === 'string'
        ? evaluation['question']
        : 'Evaluate the current input against the ordered rubric.';
    evaluation = { kind: 'classifier', model: '', question };
  }

  const priorMatch = record(row['match']);
  let match = priorMatch;
  if (newPredicate) {
    match = { type: 'noul', value: true };
  } else if (answerChanged && priorMatch['type'] !== answerTypeNow) {
    const nextMatch = exitMatchDefault(answer);
    const preserveReportedMinimum =
      evaluationKindNow === 'llm' &&
      (oldAnswerType === 'noul' || oldAnswerType === 'choice') &&
      (answerTypeNow === 'noul' || answerTypeNow === 'choice') &&
      Object.hasOwn(priorMatch, 'minReportedConfidence') &&
      !isUnset(priorMatch['minReportedConfidence']);
    match = preserveReportedMinimum
      ? { ...nextMatch, minReportedConfidence: priorMatch['minReportedConfidence'] }
      : nextMatch;
  }
  changedRow = { ...row, answer, evaluation, match };
  const nextCriteria = criteria.map((criterion, rowIndex) =>
    rowIndex === index ? changedRow : criterion,
  );
  return { ...currentConfig, criteria: nextCriteria };
}

const ANSWER_DEFAULTS = {
  choice: {
    type: 'choice',
    options: [
      { id: 'yes', label: 'Yes', criteria: 'The answer is yes' },
      { id: 'no', label: 'No', criteria: 'The answer is no' },
    ],
  },
  noul: {
    type: 'noul',
    true: { id: 'true', label: 'True', criteria: 'The statement is true' },
    false: { id: 'false', label: 'False', criteria: 'The statement is false' },
  },
  score: {
    type: 'score',
    anchors: ['Does not meet the rubric', 'Partly meets the rubric', 'Fully meets the rubric'],
    bands: [
      { id: 'low', label: 'Low', min: 0, max: 0.5 },
      { id: 'mid', label: 'Middle', min: 0.5, max: 1.5 },
      { id: 'high', label: 'High', min: 1.5, max: 2 },
    ],
  },
} satisfies Record<DecisionAnswer['type'], DecisionAnswer>;

/** Keep a newly selected primitive usable before the user fills its route-specific fields. */
function decisionVariantChange(next: unknown, previous: unknown): unknown {
  const nextConfig = record(next);
  const oldType = answerType(previous);
  const nextType = answerType(next);
  if (!nextType || nextType === oldType) return next;

  const answer = ANSWER_DEFAULTS[nextType];
  const rawEvaluation = record(nextConfig['evaluation']);
  const kind = rawEvaluation['kind'];
  let evaluation: unknown = nextConfig['evaluation'];
  if (kind === 'classifier') {
    const classifier = { ...rawEvaluation };
    if (nextType !== 'noul') delete classifier['truthThreshold'];
    evaluation = classifier;
  } else if (kind === 'llm' && nextType === 'score') {
    evaluation = {
      kind: 'classifier',
      model: 'jev',
      question: Object.hasOwn(rawEvaluation, 'question')
        ? rawEvaluation['question']
        : 'Score the input against the ordered rubric.',
      context: Object.hasOwn(rawEvaluation, 'context')
        ? rawEvaluation['context']
        : { messages: 'last', includeLastOutput: true },
    };
  } else if (kind === 'expression' && nextType === 'score') {
    evaluation = {
      kind: 'classifier',
      model: 'jev',
      question: 'Score the input against the ordered rubric.',
      context: { messages: 'last', includeLastOutput: true },
    };
  } else if (kind === 'expression') {
    evaluation = {
      ...rawEvaluation,
      jsonata: nextType === 'noul' ? 'true' : '"yes"',
    };
  }
  return { ...nextConfig, answer, evaluation };
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

interface PendingAnswerFocus {
  nodeId: string;
  answerType: DecisionAnswer['type'];
  epoch: number;
  historyEpoch: number;
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
  const bodyRef = useRef<HTMLElement>(null);
  const pendingHarnessFocusRef = useRef(false);
  const pendingAnswerFocusRef = useRef<PendingAnswerFocus | undefined>(undefined);
  const [epoch, setEpoch] = useState(0);
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
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);
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

  useLayoutEffect(() => {
    const pending = pendingAnswerFocusRef.current;
    if (!pending) return;
    pendingAnswerFocusRef.current = undefined;
    if (
      pending.nodeId !== node.id ||
      pending.epoch !== epoch ||
      pending.historyEpoch !== historyEpoch
    )
      return;
    const dialog = bodyRef.current?.closest('dialog');
    if (document.activeElement !== document.body && document.activeElement !== dialog) return;
    const radios = bodyRef.current?.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="answer"]',
    );
    const selected = radios
      ? Array.from(radios).find((radio) => radio.value === pending.answerType)
      : undefined;
    selected?.focus();
  }, [epoch, historyEpoch, node.id]);

  const commitId = () => {
    const error = idProblem(id.value, node.id, definition);
    setIdState({ ...id, error });
    if (!error && id.value !== node.id) renameNode(node.id, id.value);
  };

  const handleConfigChange = (config: unknown, change: Parameters<typeof updateNode>[2]) => {
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
      const normalized = decisionVariantChange(config, node.config);
      if (normalized !== config) {
        const active = document.activeElement;
        const radioHadFocus =
          active instanceof HTMLInputElement && active.type === 'radio' && active.name === 'answer';
        const selected = answerType(normalized);
        if (radioHadFocus && selected) {
          pendingAnswerFocusRef.current = {
            nodeId: node.id,
            answerType: selected,
            epoch: epoch + 1,
            historyEpoch,
          };
        }
        setEpoch((current) => current + 1);
      }
      updateNode(node.id, { config: normalized }, change);
      return;
    }
    if (node.kind === 'exit') {
      updateNode(
        node.id,
        { config: exitPredicateVariantChange(config, node.config, change?.path) },
        change,
      );
      return;
    }
    updateNode(node.id, { config }, change);
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
      className="lg:w-[min(52rem,calc(100vw-2rem))] xl:w-[min(64rem,calc(100vw-2rem))]"
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
            <TriggerPresets
              config={node.config}
              onApply={(config) => {
                updateNode(node.id, { config }, { path: '', kind: 'commit', id: nextChangeId() });
                setEpoch((current) => current + 1);
              }}
            />
          ) : null}
          {node.kind === 'trigger' && node.config?.subtype === 'poll' ? (
            <HelpText>
              With Items configured, leave Whole-probe dedupe key empty and use Per-item dedupe key.
            </HelpText>
          ) : null}
          {node.kind === 'exit' ? (
            <HelpText>
              Exit predicates run in order. Evaluation produces a typed answer; Match declares which
              answer exits the loop. A classifier or self-reported confidence gate rejection is
              always a nonmatch, and the run inspector keeps the raw answer and gate separate.
            </HelpText>
          ) : null}
          <CatalogWarningsContext
            value={nodeIssues.map((issue) => ({
              ...issue,
              path: issue.path?.startsWith('config.')
                ? issue.path.slice('config.'.length)
                : issue.path,
            }))}
          >
            <FieldLabelsContext
              value={
                node.kind === 'trigger' && node.config?.subtype === 'poll'
                  ? POLL_FIELD_LABELS
                  : node.kind === 'decision'
                    ? DECISION_FIELD_LABELS
                    : DEFAULT_FIELD_LABELS
              }
            >
              <SchemaForm
                key={`${node.kind}:${epoch}:${historyEpoch}`}
                schema={NodeConfigSchemas[node.kind]}
                fieldOrder={node.kind === 'decision' ? DECISION_FIELD_ORDER : undefined}
                value={node.config}
                label={`${node.id} config`}
                controls={NODE_FIELD_CONTROLS}
                unionPickers={node.kind === 'decision' ? DECISION_UNION_PICKERS : undefined}
                fieldOverrides={
                  node.kind === 'decision'
                    ? DECISION_FIELD_OVERRIDES
                    : node.kind === 'exit'
                      ? EXIT_PREDICATE_FIELD_OVERRIDES
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
            </FieldLabelsContext>
          </CatalogWarningsContext>
        </div>
        <NodeConnections
          node={node}
          definition={definition}
          onChange={(port) => {
            // Connecting or removing an exit's loop-back also sets or clears its config.
            if (port === 'loopBack') setEpoch((e) => e + 1);
          }}
        />
      </section>
    </Dialog>
  );
}
