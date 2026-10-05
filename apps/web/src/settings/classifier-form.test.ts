import { ClassifierModelPutSchema } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { customClassifier } from '../__fixtures__/fake-api.js';
import {
  initialValues,
  primitiveLabel,
  toPut,
  validateClassifier,
  type ClassifierFormValues,
} from './classifier-form.js';

const valid: ClassifierFormValues = {
  id: 'kev',
  displayName: 'Kev 4B',
  providerModel: 'kev-latest',
  endpoint: 'http://127.0.0.1:8008',
  primitives: ['choice'],
  secretRef: '',
};

const check = (patch: Partial<ClassifierFormValues>, isNew = true, existingIds: string[] = []) =>
  validateClassifier({ ...valid, ...patch }, { isNew, existingIds });

describe('classifier form values', () => {
  it('starts a new entry with Choice and no secret, and copies an entry for editing', () => {
    expect(initialValues()).toEqual({
      id: '',
      displayName: '',
      providerModel: '',
      endpoint: '',
      primitives: ['choice'],
      secretRef: '',
    });
    const entry = {
      ...customClassifier({ id: 'kev', primitives: ['score', 'choice'], secretRef: 'kev-key' }),
      configured: true,
    };
    const values = initialValues(entry);
    expect(values).toEqual({
      id: 'kev',
      displayName: 'kev',
      providerModel: 'kev-latest',
      endpoint: 'http://127.0.0.1:8008',
      primitives: ['score', 'choice'],
      secretRef: 'kev-key',
    });
    // A copy: editing the form never touches the cached entry.
    values.primitives.push('noul');
    expect(entry.primitives).toEqual(['score', 'choice']);
  });

  it('sends custom HTTP metadata in the contract shape, capabilities in a fixed order', () => {
    const body = toPut({ ...valid, primitives: ['score', 'choice'], secretRef: 'kev-key' });
    expect(body).toEqual({
      displayName: 'Kev 4B',
      providerModel: 'kev-latest',
      endpoint: 'http://127.0.0.1:8008',
      primitives: ['choice', 'score'],
      provider: 'http',
      secretRef: 'kev-key',
    });
    expect(ClassifierModelPutSchema.safeParse(body).success).toBe(true);
    // No secret: the field is left out, which clears authentication on an edit.
    expect(toPut(valid)).not.toHaveProperty('secretRef');
  });

  it('labels Choice as classification too', () => {
    expect(primitiveLabel('choice')).toBe('Choice / classification');
    expect(primitiveLabel('noul')).toBe('Noul');
    expect(primitiveLabel('score')).toBe('Score');
  });
});

describe('validateClassifier', () => {
  it('accepts what the contract accepts', () => {
    expect(check({})).toEqual({});
    expect(check({ secretRef: 'kev-key', endpoint: 'https://kev.example.com/api' })).toEqual({});
    expect(check({ secretRef: 'kev-key', endpoint: 'http://localhost:8008' })).toEqual({});
    expect(check({ secretRef: 'kev-key', endpoint: 'http://[::1]:8008' })).toEqual({});
  });

  it.each([
    ['', 'Enter an id.'],
    [
      'Kev',
      'Start with a lowercase letter, then use lowercase letters, digits, _ . or - (up to 64 characters).',
    ],
    [
      '1kev',
      'Start with a lowercase letter, then use lowercase letters, digits, _ . or - (up to 64 characters).',
    ],
    ['jev', 'jev is the built-in Jev model; choose another id.'],
    ['kev', 'A classifier with id kev already exists; edit it instead.'],
  ])('refuses the new id %j', (id, message) => {
    expect(check({ id }, true, ['jev', 'kev']).id).toBe(message);
  });

  it('does not check the id of an entry being edited', () => {
    expect(check({ id: 'kev' }, false, ['jev', 'kev'])).toEqual({});
  });

  it('asks for the names and at least one capability', () => {
    expect(check({ displayName: '   ', providerModel: '', primitives: [] })).toEqual({
      displayName: 'Enter a display name.',
      providerModel: 'Enter the model name the endpoint expects, such as kev-latest.',
      primitives: 'Choose at least one capability.',
    });
    expect(check({ displayName: 'x'.repeat(121), providerModel: 'y'.repeat(257) })).toEqual({
      displayName: 'Use at most 120 characters.',
      providerModel: 'Use at most 256 characters.',
    });
  });

  it.each([
    ['', "Enter the endpoint's API root, such as http://127.0.0.1:8008."],
    ['kev', 'Enter an http:// or https:// URL, such as http://127.0.0.1:8008.'],
    ['ftp://127.0.0.1', 'Enter an http:// or https:// URL, such as http://127.0.0.1:8008.'],
    [
      'http://user:pass@127.0.0.1:8008',
      'Use an API root without a user name or password, a query (?), or a fragment (#).',
    ],
    [
      'http://127.0.0.1:8008?x=1',
      'Use an API root without a user name or password, a query (?), or a fragment (#).',
    ],
    [
      'http://127.0.0.1:8008#top',
      'Use an API root without a user name or password, a query (?), or a fragment (#).',
    ],
    ['http://127.0.0.1:0', 'Use a port other than 0.'],
    [
      'http://127.0.0.1:8008/v1/systemone',
      'Enter the API root only; GraphGoblin adds /v1/systemone itself.',
    ],
    ['http://127.0.0.1:8008/a b', 'Remove the spaces or the malformed % encoding.'],
    ['http://127.0.0.1:8008/%zz', 'Remove the spaces or the malformed % encoding.'],
    [`http://${'a'.repeat(4100)}`, 'Use at most 4,096 characters.'],
  ])('explains the contract refusing the endpoint %j', (endpoint, message) => {
    expect(check({ endpoint })).toEqual({ endpoint: message });
    expect(ClassifierModelPutSchema.safeParse(toPut({ ...valid, endpoint })).success).toBe(false);
  });

  it('requires https for a bearer secret except on loopback, even while other fields are empty', () => {
    const message =
      'With a bearer secret, use https:// unless the host is loopback (localhost, 127.0.0.0/8, or [::1]).';
    expect(check({ endpoint: 'http://10.0.0.5:8008', secretRef: 'kev-key' })).toEqual({
      endpoint: message,
    });
    // The contract only checks it once the rest is valid; the form says it at once.
    expect(
      check({ endpoint: 'http://kev.example.com', secretRef: 'kev-key', displayName: '' }),
    ).toEqual({ endpoint: message, displayName: 'Enter a display name.' });
    expect(check({ endpoint: 'http://10.0.0.5:8008' })).toEqual({});
  });
});
