import json
from pathlib import Path

directory = Path(__file__).resolve().parent.parent / 'i5-d242-b2-independent63-execution-01'
prefix = 'B1_FEEDBACK_DIAGNOSTIC '
records = []
for phase, label in [('fresh2', '06-fresh2'), ('full63', '07-full63')]:
    phase_records = []
    for stream in ['stdout', 'stderr']:
        filename = f'{label}.{stream}.log'
        for number, line in enumerate((directory / filename).read_text(encoding='utf-8').splitlines(), 1):
            position = line.find(prefix)
            if position < 0:
                continue
            value, _ = json.JSONDecoder().raw_decode(line[position + len(prefix):])
            phase_records.append({'phase': phase, 'source': filename, 'line': number, 'value': value})
    assert len(phase_records) == 2
    records.extend(phase_records)
with (directory / 'DOM-DIAGNOSTICS.raw.json').open('x', encoding='utf-8') as stream:
    json.dump(records, stream, indent=2)
    stream.write('\n')
summary = []
for record in records:
    value = record['value']
    feedback = value['feedbackObservation']
    stages = {sample['stage']: sample for sample in value['domSamples'] if sample['stage'] != 'observed-dom-mutation'}
    summary.append({
        'phase': record['phase'], 'replacement': value['replacement'], 'source': record['source'], 'sourceLine': record['line'],
        'defaultWaitForMs': value['defaultWaitForMs'], 'immediateText': feedback['immediate']['text'],
        'immediateVisible': feedback['immediate']['visible'], 'settledText': feedback['settled']['text'],
        'settledVisible': feedback['settled']['visible'], 'settleOutcome': feedback['settleOutcome'],
        'waitObservedMs': feedback['waitFinishedMs'] - feedback['waitStartedMs'],
        'beforeOldChoiceRelease': stages['before-old-choice-release'],
        'beforeKeyRotation': stages.get('before-key-rotation'), 'afterStorageEvent': stages.get('after-storage-event'),
        'removedOriginalButtonRecords': value['removedOriginalButtonRecords'],
        'removedOriginalHeaderRecords': value['removedOriginalHeaderRecords'],
        'observedBatches': value['observedBatches'], 'samples': len(value['domSamples']),
        'sampleLimitFlag': value['domSamplesTruncated'],
        'postCountAtCleanup': value['postCountAtCleanup'], 'postBodies': value['postBodies'],
    })
with (directory / 'DOM-DIAGNOSTICS.summary.json').open('x', encoding='utf-8') as stream:
    json.dump(summary, stream, indent=2)
    stream.write('\n')
print(json.dumps(summary, indent=2))
