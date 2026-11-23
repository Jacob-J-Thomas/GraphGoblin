import json
from pathlib import Path

directory = Path(__file__).parent
prefix = 'B1_FEEDBACK_DIAGNOSTIC '
records = []
for filename in ['06-diagnostic63.stdout.log', '06-diagnostic63.stderr.log']:
    for number, line in enumerate((directory / filename).read_text(encoding='utf-8').splitlines(), 1):
        position = line.find(prefix)
        if position < 0:
            continue
        value, end = json.JSONDecoder().raw_decode(line[position + len(prefix):])
        records.append({'source': filename, 'line': number, 'value': value})
assert len(records) == 2
with (directory / 'DOM-DIAGNOSTICS.raw.json').open('x', encoding='utf-8') as stream:
    json.dump(records, stream, indent=2)
    stream.write('\n')
summary = []
for record in records:
    value = record['value']
    feedback = value['feedbackObservation']
    summary.append({
        'replacement': value['replacement'], 'sourceLine': record['line'],
        'existingDefaultWaitForMs': value['defaultWaitForMs'],
        'immediateText': feedback['immediate']['text'], 'immediateVisible': feedback['immediate']['visible'],
        'settledText': feedback['settled']['text'], 'settledVisible': feedback['settled']['visible'],
        'settleOutcome': feedback['settleOutcome'],
        'waitObservedMs': feedback['waitFinishedMs'] - feedback['waitStartedMs'],
        'removedOriginalButtonRecords': value['removedOriginalButtonRecords'],
        'removedOriginalHeaderRecords': value['removedOriginalHeaderRecords'],
        'observedBatches': value['observedBatches'], 'domSamplesCount': len(value['domSamples']),
        'domSamplesLimitFlag': value['domSamplesTruncated'],
        'stagedSamples': [sample for sample in value['domSamples'] if sample['stage'] != 'observed-dom-mutation'],
        'postCountAtCleanup': value['postCountAtCleanup'], 'postBodies': value['postBodies'],
    })
with (directory / 'DOM-DIAGNOSTICS.summary.json').open('x', encoding='utf-8') as stream:
    json.dump(summary, stream, indent=2)
    stream.write('\n')
print(json.dumps(summary, indent=2))
