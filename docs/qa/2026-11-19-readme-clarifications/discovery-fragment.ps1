    if (!$PwaShortcut) {
        $candidates = @(
            if ($programs) { Join-Path $programs 'Chrome Apps\GraphGoblin.lnk' }
            if ($desktop) { Join-Path $desktop 'GraphGoblin.lnk' }
        )
        $PwaShortcut = $candidates | Where-Object { [IO.File]::Exists($_) } | Select-Object -First 1
    }
