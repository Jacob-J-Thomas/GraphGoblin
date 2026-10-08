import {
  DecisionEvaluationSchema,
  NodeConfigSchemas,
  SlugSchema,
  type LoopDefinitionInput,
  type DecisionAnswer,
  type DecisionEvaluation,
  type NodeInput,
} from '@graphgoblin/contracts';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { DecisionKindPicker } from './DecisionKindPicker.js';
import { DecisionAnswerPicker } from './DecisionAnswerPicker.js';
import { TriggerPresets } from './TriggerPresets.js';
import { CatalogWarningsContext } from '../forms/fields/model.js';
import { canvasFocusTarget } from './canvas-focus.js';
import { NODE_FIELD_CONTROLS } from './field-controls.js';
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
  const parsed = DecisionEvaluationSchema.safeParse(nextConfig['evaluation']);
  let evaluation: DecisionEvaluation;
  if (nextType === 'score' && (!parsed.success || parsed.data.kind !== 'classifier')) {
    const question =
      parsed.success && parsed.data.kind === 'llm'
        ? parsed.data.question
        : 'Score the input against the ordered rubric.';
    const context =
      parsed.success && parsed.data.kind !== 'expression'
        ? parsed.data.context
        : { messages: 'last' as const, includeLastOutput: true };
    evaluation = {
      kind: 'classifier',
      model: 'jev',
      question,
      context,
    };
  } else if (parsed.success && parsed.data.kind === 'classifier') {
    const { truthThreshold: _truthThreshold, ...classifier } = parsed.data;
    evaluation = nextType === 'noul' ? parsed.data : classifier;
  } else if (parsed.success && parsed.data.kind === 'expression') {
    evaluation = {
      ...parsed.data,
      jsonata: nextType === 'noul' ? 'true' : '"yes"',
    };
  } else if (parsed.success) {
    evaluation = parsed.data;
  } else {
    evaluation = {
      kind: 'expression',
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

  const commitId = () => {
    const error = idProblem(id.value, node.id, definition);
    setIdState({ ...id, error });
    if (!error && id.value !== node.id) renameNode(node.id, id.value);
  };

  const handleConfigChange = (config: unknown, change: Parameters<typeof updateNode>[2]) => {
    if (node.kind === 'decision' && change?.path === 'answer') {
      const normalized = decisionVariantChange(config, node.config);
      if (normalized !== config) setEpoch((current) => current + 1);
      updateNode(node.id, { config: normalized }, change);
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
