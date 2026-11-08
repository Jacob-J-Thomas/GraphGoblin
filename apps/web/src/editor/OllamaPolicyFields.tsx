import { use } from 'react';
import { useWatch } from 'react-hook-form';
import { Icon } from '../components/icons/index.js';
import { HelpText } from '../components/ui/index.js';
import { DefaultField, FieldControlsContext } from '../forms/fields.js';
import { JsonSection } from '../forms/fields/json.js';
import { fieldMeta, type FieldControl, type FieldProps } from '../forms/fields/shared.js';
import { ollamaPolicyProblems } from './ollama-policy.js';

function StandardField(props: FieldProps) {
  const controls = use(FieldControlsContext);
  const metadata = fieldMeta(props.schema);
  const Control = metadata.control ? (controls[metadata.control] ?? DefaultField) : DefaultField;
  const content = <Control {...props} />;
  return metadata.jsonEditor ? <JsonSection {...props}>{content}</JsonSection> : content;
}

const MESSAGES: Record<string, string> = {
  session: 'Ollama can’t resume a session. Choose Fresh, or switch harness.',
  'harnessOptions.sandbox': 'Ollama runs need a read-only sandbox and approval set to never.',
  'harnessOptions.approval': 'Ollama runs need a read-only sandbox and approval set to never.',
  'harnessOptions.networkAccess': 'Ollama can’t use network access. Remove it, or switch harness.',
  'harnessOptions.webSearch': 'Ollama can’t use web search. Remove it, or switch harness.',
  'harnessOptions.configOverrides':
    'Ollama can’t use config overrides. Remove it, or switch harness.',
  contextFiles: 'Ollama can’t use context files. Remove it, or switch harness.',
  capabilities: 'Ollama can’t use capabilities. Remove it, or switch harness.',
  'output.schema.repair': 'Turn off same-session repair for Ollama.',
};

/** Valid unsupported controls disappear; invalid saved values remain editable and explained. */
const OllamaPolicyField: FieldControl = (props) => {
  const values: Record<string, unknown> = useWatch();
  if (values['harness'] !== 'ollama') return <StandardField {...props} />;
  const invalid = ollamaPolicyProblems(values).includes(props.name);
  const session = props.name === 'session';
  return (
    <>
      {session ? (
        <HelpText>
          <Icon name="info" className="mr-1 inline size-3.5 align-text-bottom" />
          Ollama starts every run fresh. It sees only this node’s rendered prompt, with no earlier
          session, tools, files or web access.
        </HelpText>
      ) : null}
      {invalid ? (
        <>
          <StandardField {...props} />
          <HelpText role="alert" tone="bad">
            {MESSAGES[props.name]}
          </HelpText>
        </>
      ) : session ? (
        <HelpText>Session: fresh (required for Ollama)</HelpText>
      ) : props.name === 'output.schema.repair' ? (
        <HelpText>
          Ollama doesn’t repair invalid structured output in the same session; an invalid result
          fails this step.
        </HelpText>
      ) : props.name === 'harnessOptions.sandbox' ? (
        <HelpText>Sandbox: read-only (required for Ollama)</HelpText>
      ) : props.name === 'harnessOptions.approval' ? (
        <HelpText>Approval: never (required for Ollama)</HelpText>
      ) : null}
    </>
  );
};
OllamaPolicyField.ownsJsonSection = true;

export const OLLAMA_FIELD_OVERRIDES = Object.fromEntries(
  Object.keys(MESSAGES).map((path) => [path, OllamaPolicyField]),
);
