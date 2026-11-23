from pathlib import Path
from hashlib import sha1, sha256
from collections import Counter
import json
import struct

O = Path(__file__).resolve().parent
STAT_NAMES = ('ctimeSeconds', 'ctimeNanoseconds', 'mtimeSeconds', 'mtimeNanoseconds', 'device', 'inode', 'mode', 'uid', 'gid', 'size')


def parse(path):
    raw = path.read_bytes()
    assert raw[:4] == b'DIRC'
    version, count = struct.unpack('>II', raw[4:12])
    assert version in (2, 3)
    assert sha1(raw[:-20]).digest() == raw[-20:]
    pos = 12
    entries = []
    for ordinal in range(count):
        start = pos
        values = struct.unpack('>10I', raw[pos:pos + 40])
        object_id = raw[pos + 40:pos + 60].hex()
        flags = struct.unpack('>H', raw[pos + 60:pos + 62])[0]
        pos += 62
        extended = 0
        if flags & 0x4000:
            assert version == 3
            extended = struct.unpack('>H', raw[pos:pos + 2])[0]
            pos += 2
        path_start = pos
        nul = raw.index(0, pos)
        name = raw[pos:nul]
        assert (flags & 0xfff) == min(len(name), 0xfff)
        pos = start + ((nul + 1 - start + 7) // 8) * 8
        assert not any(raw[nul + 1:pos])
        semantic = {'path': name.decode('utf-8', 'surrogateescape'), 'pathHex': name.hex(),
                    'mode': f'{values[6]:06o}', 'objectId': object_id, 'stage': (flags >> 12) & 3,
                    'assumeValid': bool(flags & 0x8000), 'extended': bool(flags & 0x4000),
                    'skipWorktree': bool(extended & 0x4000), 'intentToAdd': bool(extended & 0x2000),
                    'flagsRaw': f'{flags:04x}', 'extendedFlagsRaw': f'{extended:04x}'}
        entries.append({'ordinal': ordinal, 'start': start, 'end': pos, 'pathStart': path_start,
                        'paddingBytes': pos - nul - 1, 'semantic': semantic,
                        'stat': {k: v for k, v in zip(STAT_NAMES, values) if k != 'mode'},
                        'raw': raw[start:pos]})
    extension_start = pos
    extensions = []
    while pos < len(raw) - 20:
        start = pos
        signature = raw[pos:pos + 4]
        length = struct.unpack('>I', raw[pos + 4:pos + 8])[0]
        pos += 8
        assert pos + length <= len(raw) - 20
        payload = raw[pos:pos + length]
        pos += length
        extensions.append({'signature': signature.decode('ascii'), 'offset': start, 'payloadBytes': length,
                           'payloadSha256': sha256(payload).hexdigest(),
                           'wholeExtensionSha256': sha256(raw[start:pos]).hexdigest()})
    assert pos == len(raw) - 20
    return {'raw': raw, 'version': version, 'count': count, 'entries': entries,
            'extensions': extensions, 'extensionBytes': raw[extension_start:-20],
            'checksumSha1': raw[-20:].hex()}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('utf-8')


def put(name, value):
    with (O / name).open('x', encoding='utf-8', newline='\n') as output:
        json.dump(value, output, indent=2, ensure_ascii=True)
        output.write('\n')


def main():
    before, current = (parse(O / name) for name in ('index.before.raw', 'index.current.raw'))
    assert before['version'] == current['version'] and before['count'] == current['count']
    changes = []
    field_counts = Counter()
    semantic_changes = []
    for old, new in zip(before['entries'], current['entries']):
        if old['semantic'] != new['semantic']:
            semantic_changes.append({'ordinal': old['ordinal'], 'before': old['semantic'], 'current': new['semantic']})
        stat_changes = {key: {'before': value, 'current': new['stat'][key]}
                        for key, value in old['stat'].items() if value != new['stat'][key]}
        field_counts.update(stat_changes.keys())
        if old['raw'] != new['raw']:
            changes.append({'ordinal': old['ordinal'], 'path': old['semantic']['path'],
                            'entryOffsetBefore': old['start'], 'entryOffsetCurrent': new['start'],
                            'entryBytesBefore': old['end'] - old['start'], 'entryBytesCurrent': new['end'] - new['start'],
                            'pathOffsetBefore': old['pathStart'], 'pathOffsetCurrent': new['pathStart'],
                            'paddingBytesBefore': old['paddingBytes'], 'paddingBytesCurrent': new['paddingBytes'],
                            'semanticChanges': {key: {'before': value, 'current': new['semantic'][key]}
                                                for key, value in old['semantic'].items() if value != new['semantic'][key]},
                            'statChanges': stat_changes, 'beforeStat': old['stat'], 'currentStat': new['stat']})
    core_fields = ('pathHex', 'mode', 'objectId', 'stage', 'assumeValid', 'intentToAdd')
    old_core = [{key: row['semantic'][key] for key in core_fields} for row in before['entries']]
    new_core = [{key: row['semantic'][key] for key in core_fields} for row in current['entries']]
    raw_offsets = [i for i, (a, b) in enumerate(zip(before['raw'], current['raw'])) if a != b]
    changed_ranges = [(a['start'], a['end']) for a, b in zip(before['entries'], current['entries']) if a['raw'] != b['raw']]
    entry_byte_changes = [i for i in raw_offsets if any(start <= i < end for start, end in changed_ranges)]
    checksum_byte_changes = [i for i in raw_offsets if i >= len(before['raw']) - 20]
    uncovered = sorted(set(raw_offsets) - set(entry_byte_changes) - set(checksum_byte_changes))
    report = {'state': 'READ_ONLY_INDEX_DRIFT_AUDIT', 'entryCount': before['count'], 'version': before['version'],
              'contentModesPathsBlobsStagesAssumeValidIntentToAddEqual': old_core == new_core,
              'contentCoreCanonicalSha256Before': sha256(canonical(old_core)).hexdigest(),
              'contentCoreCanonicalSha256Current': sha256(canonical(new_core)).hexdigest(),
              'semanticFlagChangedEntries': len(semantic_changes), 'rawChangedEntries': len(changes),
              'changedStatFieldCounts': dict(field_counts), 'changes': changes,
              'headersByteEqual': before['raw'][:12] == current['raw'][:12],
              'extensionsByteEqual': before['extensionBytes'] == current['extensionBytes'],
              'extensionsBefore': before['extensions'], 'extensionsCurrent': current['extensions'],
              'validSha1ChecksumBefore': before['checksumSha1'], 'validSha1ChecksumCurrent': current['checksumSha1'],
              'rawChangedBytes': len(raw_offsets), 'changedEntryBytes': len(entry_byte_changes),
              'changedChecksumBytes': len(checksum_byte_changes), 'unexplainedChangedOffsets': uncovered,
              'preciselyStatOnly': False if semantic_changes else not uncovered,
              'stagedContentChangeObserved': old_core != new_core, 'causeEstablished': False,
              'cause': None, 'gitCommandsExecuted': 0, 'sourceOrIndexWrites': 0}
    assert old_core == new_core and len(changes) == len(semantic_changes) == 1
    assert changes[0]['path'] == 'docs/qa/design-contrast.md'
    assert report['headersByteEqual'] and report['extensionsByteEqual'] and not uncovered
    put('REPORT.json', report)
    with (O / 'ENTRY-SEMANTICS.current.json').open('xb') as output:
        output.write(canonical([row['semantic'] for row in current['entries']]) + b'\n')
    return report


if __name__ == '__main__':
    print(json.dumps(main(), indent=2))
