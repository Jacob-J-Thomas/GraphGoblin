import type { TemplateCatalogEntry, TemplateDraftResponse } from '@graphgoblin/contracts';
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Badge, Button, Card } from '../components/ui/index.js';
import { errorMessage } from '../lib/utils.js';

export interface TemplateGalleryProps {
  templates: readonly TemplateCatalogEntry[];
  onCreateDraft: (templateId: string) => Promise<TemplateDraftResponse>;
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
  const openerId = useId();

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

  const createDraft = async (entry: TemplateCatalogEntry) => {
    const templateId = entry.manifest.id;
    if (actionInFlightRef.current || createdDrafts[templateId]) return;
    actionInFlightRef.current = true;
    setPendingTemplateId(templateId);
    setDraftErrors((current) => ({ ...current, [templateId]: '' }));
    setHandoffErrors((current) => ({ ...current, [templateId]: '' }));
    try {
      const result = await onCreateDraft(templateId);
      const loopId = result.loop.id;
      setCreatedDrafts((current) => ({ ...current, [templateId]: loopId }));
      try {
        await onCreated(loopId);
      } catch (error) {
        setHandoffErrors((current) => ({ ...current, [templateId]: errorMessage(error) }));
      }
    } catch (error) {
      setDraftErrors((current) => ({ ...current, [templateId]: errorMessage(error) }));
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
            </p>
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-muted">No templates are available right now.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {templates.map((entry) => (
                <Card
                  key={`${entry.manifest.id}:${entry.manifest.version}`}
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
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => {
                        if (actionInFlightRef.current) return;
                        const createdLoopId = createdDrafts[entry.manifest.id];
                        if (createdLoopId) {
                          void openCreatedDraft(entry.manifest.id, createdLoopId);
                        } else {
                          void createDraft(entry);
                        }
                      }}
                      aria-disabled={pendingTemplateId !== undefined || undefined}
                      aria-busy={pendingTemplateId === entry.manifest.id || undefined}
                    >
                      {pendingTemplateId === entry.manifest.id
                        ? createdDrafts[entry.manifest.id]
                          ? 'Opening draft…'
                          : 'Creating draft…'
                        : `Use ${entry.manifest.title}`}
                    </Button>
                    {pendingTemplateId === entry.manifest.id ? (
                      <p role="status" aria-live="polite" className="text-sm text-muted">
                        {createdDrafts[entry.manifest.id] ? 'Opening draft…' : 'Creating draft…'}
                      </p>
                    ) : null}
                    {draftErrors[entry.manifest.id] ? (
                      <Alert title={`Could not create the ${entry.manifest.title} draft`}>
                        <p>{draftErrors[entry.manifest.id]}</p>
                        <p className="mt-2">
                          If the request timed out, check the loop list for a draft before trying
                          again.
                        </p>
                      </Alert>
                    ) : null}
                    {handoffErrors[entry.manifest.id] && createdDrafts[entry.manifest.id] ? (
                      <Alert
                        title={`${entry.manifest.title} draft created, but the editor could not be opened`}
                      >
                        <p>{handoffErrors[entry.manifest.id]}</p>
                        <p className="mt-2">
                          Use {entry.manifest.title} again to open the same draft.
                        </p>
                        <Link
                          className="mt-2 inline-block underline"
                          to={`/loops/${encodeURIComponent(createdDrafts[entry.manifest.id]!)}/edit`}
                        >
                          Open the created draft
                        </Link>
                      </Alert>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
