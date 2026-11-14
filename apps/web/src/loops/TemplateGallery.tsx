import type { TemplateCatalogEntry, TemplateDraftResponse } from '@graphgoblin/contracts';
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { focusById, LoopNameRetryForm } from '../components/loop-name-conflict.js';
import { Alert, Badge, Button, Card } from '../components/ui/index.js';
import { LOOP_NAME_RULE, loopNameConflict, type LoopNameConflict } from '../lib/loop-names.js';
import { errorMessage } from '../lib/utils.js';

export interface TemplateGalleryProps {
  templates: readonly TemplateCatalogEntry[];
  /** Create a draft; `name` is the user's explicit choice after a name refusal, else the template's. */
  onCreateDraft: (templateId: string, name?: string) => Promise<TemplateDraftResponse>;
  onCreated: (loopId: string) => void | Promise<void>;
  onCreateFailed?: () => void | Promise<void>;
}

export function TemplateGallery({
  templates,
  onCreateDraft,
  onCreated,
  onCreateFailed,
}: TemplateGalleryProps) {
  const [open, setOpen] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<string>();
  const actionInFlightRef = useRef(false);
  const [createdDrafts, setCreatedDrafts] = useState<Record<string, string>>({});
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [handoffErrors, setHandoffErrors] = useState<Record<string, string>>({});
  // A name refusal per card: the first (of the template's own name) and the latest (#209).
  const [nameConflicts, setNameConflicts] = useState<
    Record<string, { first: LoopNameConflict; latest: LoopNameConflict }>
  >({});
  const openerId = useId();
  const actionId = (templateId: string) => `${openerId}-use-${templateId}`;

  const openCreatedDraft = async (templateId: string, loopId: string) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setPendingTemplateId(templateId);
    setHandoffErrors((current) => ({ ...current, [templateId]: '' }));
    try {
      await onCreated(loopId);
    } catch (error) {
      setHandoffErrors((current) => ({ ...current, [templateId]: errorMessage(error) }));
    } finally {
      actionInFlightRef.current = false;
      setPendingTemplateId(undefined);
    }
  };

  const createDraft = async (entry: TemplateCatalogEntry, name?: string) => {
    const templateId = entry.manifest.id;
    if (actionInFlightRef.current || createdDrafts[templateId]) return;
    actionInFlightRef.current = true;
    setPendingTemplateId(templateId);
    setDraftErrors((current) => ({ ...current, [templateId]: '' }));
    setHandoffErrors((current) => ({ ...current, [templateId]: '' }));
    try {
      const result = await (name === undefined
        ? onCreateDraft(templateId)
        : onCreateDraft(templateId, name));
      const loopId = result.loop.id;
      setCreatedDrafts((current) => ({ ...current, [templateId]: loopId }));
      setNameConflicts(({ [templateId]: _resolved, ...rest }) => rest);
      try {
        await onCreated(loopId);
      } catch (error) {
        setHandoffErrors((current) => ({ ...current, [templateId]: errorMessage(error) }));
      }
    } catch (error) {
      const refused = loopNameConflict(error, name);
      if (refused) {
        // Nothing was created. The card asks for a name; a retry is the user's next submission.
        setNameConflicts((current) => ({
          ...current,
          [templateId]: { first: current[templateId]?.first ?? refused, latest: refused },
        }));
      } else {
        setDraftErrors((current) => ({ ...current, [templateId]: errorMessage(error) }));
      }
      try {
        // Reconcile the visible loop list after a failed or interrupted response. Never retry the
        // creation mutation automatically; a timed-out request may already have committed.
        await onCreateFailed?.();
      } catch {
        // Preserve the original creation error if the list refresh also fails.
      }
    } finally {
      actionInFlightRef.current = false;
      setPendingTemplateId(undefined);
    }
  };

  return (
    <div className="grid gap-4">
      <Button
        id={openerId}
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={`${openerId}-gallery`}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide templates' : 'New from template'}
      </Button>
      {open ? (
        <section
          id={`${openerId}-gallery`}
          aria-labelledby={`${openerId}-heading`}
          className="grid gap-3"
        >
          <div>
            <h2 id={`${openerId}-heading`} className="text-md font-semibold text-heading">
              Choose a template
            </h2>
            <p className="mt-1 text-sm text-muted">
              Use a template to create an independent loop, then customize it in the editor.
              Templates are starting graphs; publish and run each copy separately.
            </p>
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-muted">No templates are available right now.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {templates.map((entry) => {
                const templateId = entry.manifest.id;
                const conflict = createdDrafts[templateId] ? undefined : nameConflicts[templateId];
                const pending = pendingTemplateId === templateId;
                const explanationId = `${actionId(templateId)}-name-taken`;
                return (
                  <Card
                    key={`${templateId}:${entry.manifest.version}`}
                    title={entry.manifest.title}
                    titleLevel={3}
                    className="md:row-span-4 md:grid md:grid-rows-subgrid md:gap-y-3"
                    bodyClassName="grid grid-cols-1 gap-3 md:row-span-3 md:grid-rows-subgrid md:gap-y-3"
                  >
                    <div className="text-sm text-muted">
                      <p>{entry.manifest.description}</p>
                    </div>
                    <div
                      className="flex flex-wrap content-start gap-2"
                      aria-label={`${entry.manifest.title} tags`}
                    >
                      {entry.manifest.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                    <div className="grid min-w-0 grid-cols-1 content-start gap-2">
                      {conflict ? (
                        // The refused Use action gives way to a deliberate, named second attempt.
                        <>
                          <div id={explanationId}>
                            <Alert tone="warn" title={`Name the new ${entry.manifest.title} draft`}>
                              {conflict.first.name === undefined
                                ? 'Another loop already has the name this template uses.'
                                : `Another loop already has the name “${conflict.first.name.trim()}”.`}{' '}
                              {LOOP_NAME_RULE} Choose a name for the new draft. Existing loops and
                              the template are not changed.
                            </Alert>
                          </div>
                          <LoopNameRetryForm
                            label="Name for the new draft"
                            submitLabel="Create draft"
                            pendingLabel="Creating draft…"
                            initialName={conflict.first.suggestedName ?? ''}
                            conflict={conflict.latest}
                            pending={pending}
                            describedBy={explanationId}
                            onSubmit={(name) => void createDraft(entry, name)}
                            onCancel={() => {
                              setNameConflicts(({ [templateId]: _cancelled, ...rest }) => rest);
                              focusById(actionId(templateId));
                            }}
                          />
                        </>
                      ) : (
                        <>
                          <Button
                            id={actionId(templateId)}
                            type="button"
                            className="w-full"
                            onClick={() => {
                              if (actionInFlightRef.current) return;
                              const createdLoopId = createdDrafts[templateId];
                              if (createdLoopId) {
                                void openCreatedDraft(templateId, createdLoopId);
                              } else {
                                void createDraft(entry);
                              }
                            }}
                            aria-disabled={pendingTemplateId !== undefined || undefined}
                            aria-busy={pending || undefined}
                          >
                            {pending
                              ? createdDrafts[templateId]
                                ? 'Opening draft…'
                                : 'Creating draft…'
                              : `Use ${entry.manifest.title}`}
                          </Button>
                          {pending ? (
                            <p role="status" aria-live="polite" className="text-sm text-muted">
                              {createdDrafts[templateId] ? 'Opening draft…' : 'Creating draft…'}
                            </p>
                          ) : null}
                        </>
                      )}
                      {draftErrors[templateId] ? (
                        <Alert title={`Could not create the ${entry.manifest.title} draft`}>
                          <p>{draftErrors[templateId]}</p>
                          <p className="mt-2">
                            If the request timed out, check the loop list for a draft before trying
                            again.
                          </p>
                        </Alert>
                      ) : null}
                      {handoffErrors[templateId] && createdDrafts[templateId] ? (
                        <Alert
                          title={`${entry.manifest.title} draft created, but the editor could not be opened`}
                        >
                          <p>{handoffErrors[templateId]}</p>
                          <p className="mt-2">
                            Use {entry.manifest.title} again to open the same draft.
                          </p>
                          <Link
                            className="mt-2 inline-block underline"
                            to={`/loops/${encodeURIComponent(createdDrafts[templateId])}/edit`}
                          >
                            Open the created draft
                          </Link>
                        </Alert>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
