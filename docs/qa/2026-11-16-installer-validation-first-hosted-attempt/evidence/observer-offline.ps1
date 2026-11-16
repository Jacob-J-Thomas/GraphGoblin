# Consumes copies already collected by the owned classic process ETW session.
function Read-QaEventId([string]$Value) {
    if ($Value -match '^0x[0-9a-f]+$') { return [Convert]::ToUInt32($Value.Substring(2), 16) }
    if ($Value -cmatch '^[0-9]+$') { return [uint32]$Value }
    throw 'An observed process event has a malformed process identifier.'
}

function Read-QaEventField($Event, [string[]]$Names) {
    $payload = $Event.SelectNodes("./*[local-name()='EventData' or local-name()='UserData']")
    $matches = @(
        foreach ($section in $payload) {
            foreach ($node in $section.SelectNodes('.//*')) {
                if (($node.LocalName -eq 'Data' -and $node.GetAttribute('Name') -in $Names) -or
                    $node.LocalName -in $Names) { $node }
            }
        }
    )
    if ($matches.Count -ne 1) { throw 'Classic process payload field unavailable or ambiguous: ' + ($Names -join '/') }
    return $matches[0].InnerText
}

function Read-QaProcessTrace([string]$Xml, $Run, $Before, $After, [string]$Driver, [string]$Evidence,
    [string]$ValidatorArgument, [string]$Output, [string]$Node, [string]$NodeCanonical) {
    $processGuid = [guid]'3d6fa8d0-fe05-11d0-9dda-00c04fd7ba7c'
    $config = [Xml.XmlReaderSettings]::new()
    $config.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $config.XmlResolver = $null
    $config.MaxCharactersInDocument = 134217728
    $xmlReader = [Xml.XmlReader]::Create($Xml, $config)
    try {
        $xmlDoc = [Xml.XmlDocument]::new()
        $xmlDoc.XmlResolver = $null
        $xmlDoc.Load($xmlReader)
    } finally { $xmlReader.Dispose() }
    $eventStream = [Collections.Generic.List[object]]::new()
    $versions = [Collections.Generic.HashSet[string]]::new()
    $ordinal = 0
    foreach ($event in $xmlDoc.SelectNodes("//*[local-name()='Event' and *[local-name()='System']]")) {
        $ordinal++
        $system = $event.SelectSingleNode("./*[local-name()='System']")
        $provider = $system.SelectSingleNode("./*[local-name()='Provider']")
        $actualProvider = [guid]::Empty
        $systemTraceGuid = [guid]'9e814aad-3204-11d2-9a82-006008a86939'
        if (!$provider -or ![guid]::TryParse($provider.GetAttribute('Guid'), [ref]$actualProvider) -or $actualProvider -ne $systemTraceGuid) { continue }
        $eventGuid = $event.SelectSingleNode("./*[local-name()='ExtendedTracingInfo']/*[local-name()='EventGuid']")
        $actualEventGuid = [guid]::Empty
        if (!$eventGuid -or ![guid]::TryParse($eventGuid.InnerText, [ref]$actualEventGuid) -or $actualEventGuid -ne $processGuid) { continue }
        $opcode = $system.SelectSingleNode("./*[local-name()='Opcode']")
        if (!$opcode) { throw 'The native decoder omitted the classic process opcode.' }
        $op = $opcode.InnerText
        # Classic opcode 3/4 is rundown, not process creation or termination.
        if ($op -notin @('1','2','Start','End','Stop')) { continue }
        $clock = $system.SelectSingleNode("./*[local-name()='TimeCreated']")
        $version = $system.SelectSingleNode("./*[local-name()='Version']")
        if (!$clock -or !$version) { throw 'The native decoder omitted process time or version.' }
        $time = [DateTimeOffset]::Parse($clock.GetAttribute('SystemTime'), [Globalization.CultureInfo]::InvariantCulture)
        $new = $op -in @('1','Start')
        $pidNumber = Read-QaEventId (Read-QaEventField $event @('ProcessId','ProcessID'))
        $entry = [ordered]@{
            ordinal=$ordinal; start=$new; time=$time.UtcDateTime.ToString('o'); pid=$pidNumber
            version=$version.InnerText
        }
        if ($new) {
            $entry.parent = Read-QaEventId (Read-QaEventField $event @('ParentId','ParentProcessId','ParentProcessID'))
            $entry.image = Read-QaEventField $event @('ImageFileName','ImageName')
            $entry.commandLine = Read-QaEventField $event @('CommandLine')
            if ([string]::IsNullOrWhiteSpace($entry.image)) { throw 'Decoded process start has no executable image.' }
            [void]$versions.Add($entry.version)
        }
        $eventStream.Add($entry)
    }
    if (!$versions.Count) { throw 'Native decoder produced no classic process-start payloads with argv fields.' }
    $ordered = @($eventStream | Sort-Object @{Expression='time'}, @{Expression='ordinal'})

    function Read-Birth($Receipt, [string]$Argument) {
        if (!$Receipt.birthUtc) { throw 'The direct child has no creation-time receipt.' }
        $typed = [DateTimeOffset]$Receipt.birthUtc
        $recorded = @($ordered | Where-Object {
            $_.start -and $_.pid -eq $Receipt.pid -and $_.parent -eq $Receipt.parentPid -and
            [Math]::Abs((([DateTimeOffset]$_.time) - $typed).TotalSeconds) -lt 2 -and
            $_.commandLine.IndexOf($Argument, [StringComparison]::OrdinalIgnoreCase) -ge 0
        })
        if ($recorded.Count -ne 1) { throw 'A direct receipt lacks one unambiguous matching process-start record for PID ' + $Receipt.pid }
        return $recorded[0]
    }

    $first = Read-Birth $Before.spawn $Before.marker
    $last = Read-Birth $After.spawn $After.marker
    foreach ($pair in @(@{canary=$Before; event=$first}, @{canary=$After; event=$last})) {
        $argv = [GraphGoblin.Qa436.ProcessTrace]::SplitArguments($pair.event.commandLine)
        if ($argv.Count -ne 3 -or ($argv[0] -ine $Node -and $argv[0] -ine $NodeCanonical) -or
            $argv[1] -cne '-e' -or $argv[2] -cne $pair.canary.script -or
            $pair.canary.exit.exitCode -ne 0 -or !$pair.canary.close.streamsClosed) {
            throw 'A fast Node canary did not match its exact argv/exit/close receipt.'
        }
    }
    $outer = Read-Birth $Run.spawn $Driver
    $outerArgv = [GraphGoblin.Qa436.ProcessTrace]::SplitArguments($outer.commandLine)
    if ($Driver -inotIn $outerArgv) { throw 'Trace driver argv did not name the sealed script.' }
    if (([DateTimeOffset]$first.time) -ge ([DateTimeOffset]$outer.time) -or
        ([DateTimeOffset]$last.time) -le ([DateTimeOffset]$Run.close.closedUtc)) {
        throw 'Process traces did not bracket the entire direct driver execution and stream close.'
    }

    $descendants = [Collections.Generic.List[object]]::new()
    $problems = [Collections.Generic.List[string]]::new()
    $active = @{}
    foreach ($item in $ordered) {
        if (([DateTimeOffset]$item.time) -lt ([DateTimeOffset]$first.time) -or ([DateTimeOffset]$item.time) -gt ([DateTimeOffset]$last.time)) { continue }
        if (!$item.start) {
            [void]$active.Remove([string]$item.pid)
            continue
        }
        if ($item.ordinal -eq $outer.ordinal -or $active.ContainsKey([string]$item.parent)) {
            if ($active.ContainsKey([string]$item.pid)) { $problems.Add('Overlapping observed PID reuse: ' + $item.pid) }
            $item['rooted'] = $true
            if ($active.ContainsKey([string]$item.parent)) { $item['parentBirthOrdinal'] = $active[[string]$item.parent].ordinal }
            $active[[string]$item.pid] = $item
            $descendants.Add($item)
        }
        $image = [IO.Path]::GetFileName($item.image)
        if ($image -match '^chrome(?:_proxy)?(?:\.ex(?:e)?)?$') {
            $problems.Add('Chrome/Chrome proxy process birth in the bounded installer window: ' + $item.pid)
        }
        if ($image -in @('node.exe','node')) {
            if ([string]::IsNullOrWhiteSpace($item.commandLine)) {
                $problems.Add('Node process birth without attributable argv: ' + $item.pid)
            } else {
                $argv = [GraphGoblin.Qa436.ProcessTrace]::SplitArguments($item.commandLine)
                if (@($argv | Where-Object { $_ -match '(^|[/\\])main\.js$' }).Count) {
                    $problems.Add('Node main.js process birth during the installer window: ' + $item.pid)
                }
                if ($item.Contains('rooted') -and ($argv.Count -ne 2 -or $argv[1] -cne '--version')) {
                    $problems.Add('Unclassified descendant Node invocation: ' + $item.pid)
                }
            }
        }
        if ($item.Contains('rooted') -and [string]::IsNullOrWhiteSpace($item.commandLine)) {
            $problems.Add('A driver descendant had no decodable argv: ' + $item.pid)
        }
    }
    if ($active.Count) { $problems.Add('One or more driver PID/birth lifetimes lacked an end before the closing canary.') }

    $matchedCases = [Collections.Generic.List[object]]::new()
    foreach ($spawnFile in Get-ChildItem -LiteralPath $Evidence -Recurse -File -Filter '*.spawn.json') {
        $receipt = Read-QaJson $spawnFile.FullName
        if (!$receipt.startedUtc) { $problems.Add('No direct case birth receipt: ' + $spawnFile.Name); continue }
        $birth = [DateTimeOffset]$receipt.startedUtc
        $matching = @($descendants | Where-Object {
            $_.pid -eq $receipt.pid -and [Math]::Abs((([DateTimeOffset]$_.time) - $birth).TotalSeconds) -lt 2
        })
        if ($matching.Count -ne 1) { $problems.Add('Case pid/birth missing from trace: ' + $spawnFile.Name); continue }
        $matchedCases.Add([ordered]@{ file=$spawnFile.FullName; start=$matching[0] })
    }
    if (!$matchedCases.Count) { $problems.Add('No sealed driver child receipt matched the trace.') }
    if ($ValidatorArgument) {
        foreach ($name in @('01','02','03','04')) {
            $case = @($matchedCases | Where-Object {
                $_.file -ceq (Join-Path $Evidence "$name\installer.spawn.json")
            })
            if ($case.Count -ne 1) {
                $problems.Add('Required positive installer receipt unavailable for validator: ' + $name)
                continue
            }
            $ownedOrdinals = @{}
            $ownedOrdinals[[int]$case[0].start.ordinal] = $true
            $validatorObserved = $false
            foreach ($candidate in $descendants) {
                if (!$candidate.Contains('parentBirthOrdinal') -or !$ownedOrdinals.ContainsKey([int]$candidate.parentBirthOrdinal)) { continue }
                $ownedOrdinals[[int]$candidate.ordinal] = $true
                if (!$candidate.commandLine) { continue }
                $argv = [GraphGoblin.Qa436.ProcessTrace]::SplitArguments($candidate.commandLine)
                if ($ValidatorArgument -cin $argv) { $validatorObserved = $true }
            }
            if (!$validatorObserved) { $problems.Add('Admitted validator argv was unobserved for case ' + $name) }
        }
    }
    $result = [ordered]@{
        classification=if ($problems.Count) {'incomplete-or-observed-forbidden-starts'} else {'complete-no-gateway-or-chrome-process-starts'}
        providerGuid=$processGuid.ToString(); decodedVersions=@($versions | Sort-Object); decodedStarts=@($ordered | Where-Object start).Count
        canaries=@($first,$last); driver=$outer; driverClose=$Run.close
        ownedStarts=$descendants.ToArray(); caseBirths=$matchedCases.ToArray(); problems=$problems.ToArray()
    }
    Save-QaJson $Output $result
    if ($problems.Count) { throw 'Process witness did not establish the absence of gateway/Chrome starts. See observer-summary.json.' }
    return $result.classification
}
