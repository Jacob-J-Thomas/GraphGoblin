"""Owned Windows Job process helpers, derived from the verified #499 fixture."""

import ctypes
from ctypes import wintypes
from pathlib import Path
import subprocess
import time

PACKET = Path(__file__).resolve().parent
NO_WINDOW = subprocess.CREATE_NO_WINDOW

KERNEL = ctypes.WinDLL('kernel32', use_last_error=True)
SIZE = ctypes.c_size_t
U64 = ctypes.c_uint64
I64 = ctypes.c_int64
D = wintypes.DWORD
H = wintypes.HANDLE


class BasicJob(ctypes.Structure):
    _fields_ = [
        ('processTime', I64), ('jobTime', I64), ('limitFlags', D),
        ('minWorkingSet', SIZE), ('maxWorkingSet', SIZE), ('activeProcessLimit', D),
        ('affinity', SIZE), ('priority', D), ('scheduling', D),
    ]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, U64) for name in ('reads','writes','other','readBytes','writeBytes','otherBytes')]


class ExtendedJob(ctypes.Structure):
    _fields_ = [
        ('basic', BasicJob), ('io', IoCounters), ('processMemory', SIZE), ('jobMemory', SIZE),
        ('peakProcessMemory', SIZE), ('peakJobMemory', SIZE),
    ]


def signature(name, args, result):
    function = getattr(KERNEL, name)
    function.argtypes, function.restype = args, result
    return function


create_job = signature('CreateJobObjectW', [ctypes.c_void_p, wintypes.LPCWSTR], H)
configure_job = signature('SetInformationJobObject', [H, ctypes.c_int, ctypes.c_void_p, D], wintypes.BOOL)
assign_job = signature('AssignProcessToJobObject', [H, H], wintypes.BOOL)
close_handle = signature('CloseHandle', [H], wintypes.BOOL)
create_file = signature('CreateFileW', [wintypes.LPCWSTR,D,D,ctypes.c_void_p,D,D,H], H)
BAD_HANDLE = ctypes.c_void_p(-1).value


class OwnedJob:
    def __init__(self):
        if ctypes.sizeof(ExtendedJob) != 144:
            raise RuntimeError('Job structure requires the reviewed x64 ABI')
        self.handle = create_job(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        info = ExtendedJob()
        info.basic.limitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
        if not configure_job(self.handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def attach(self, process):
        if not assign_job(self.handle, H(int(process._handle))):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            handle, self.handle = self.handle, None
            if not close_handle(handle):
                raise ctypes.WinError(ctypes.get_last_error())


def contained(args, env, timeout, signal=b'START-OWNED-536-CASE\n'):
    job = OwnedJob()
    attached = False
    process = None
    try:
        with subprocess.Popen([str(arg) for arg in args], cwd=PACKET, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=NO_WINDOW) as process:
            try:
                job.attach(process)
                attached = True
                out, err = process.communicate(signal, timeout=timeout)
                return process.returncode, out, err, False, process.pid
            except subprocess.TimeoutExpired:
                job.close()
                out, err = process.communicate(timeout=10)
                return process.returncode, out, err, True, process.pid
            except BaseException:
                if not attached and process.poll() is None:
                    # The waiting wrapper has not been allowed to invoke the installer.
                    process.kill()
                job.close()
                process.wait(timeout=10)
                raise
    finally:
        job.close()


def nondelete_read(path):
    handle = create_file(str(path), 0x80000000, 1, None, 3, 0x80, None)
    if handle in (None, BAD_HANDLE):
        raise ctypes.WinError(ctypes.get_last_error())
    return handle


def deadline(started, maximum, ceiling=20):
    remaining = maximum - (time.monotonic() - started)
    if remaining <= 0:
        raise TimeoutError('The matrix overall deadline expired')
    return min(ceiling, remaining)


# FUP054 local extension only. The original shared helper and original failed receipts stay exact.
query_job = signature('QueryInformationJobObject', [H, ctypes.c_int, ctypes.c_void_p, D, ctypes.c_void_p], wintypes.BOOL)
open_process = signature('OpenProcess', [D, wintypes.BOOL, D], H)
process_in_job = signature('IsProcessInJob', [H, H, ctypes.POINTER(wintypes.BOOL)], wintypes.BOOL)
process_times = signature('GetProcessTimes', [H, ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME),
                                          ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME)], wintypes.BOOL)


class Accounting(ctypes.Structure):
    _fields_ = [('TotalUserTime', I64), ('TotalKernelTime', I64), ('PeriodUserTime', I64),
                ('PeriodKernelTime', I64), ('PageFaults', D), ('TotalProcesses', D),
                ('ActiveProcesses', D), ('TerminatedProcesses', D)]


def owned_identities(job, deadline_at):
    """Only IDs returned by this job; held handles are membership-checked before identity claims."""
    size = ctypes.sizeof(ctypes.c_size_t)
    failure = None
    for capacity in (64, 512):
        if time.monotonic() >= deadline_at:
            return {'supported': False, 'reason': 'observation-allowance-ended-before-id-query'}
        buffer = ctypes.create_string_buffer(8 + capacity * size)
        needed = D()
        if query_job(job, 3, buffer, len(buffer), ctypes.byref(needed)):
            assigned, listed = D.from_buffer(buffer, 0).value, D.from_buffer(buffer, 4).value
            if listed > capacity or listed > assigned:
                return {'supported': False, 'reason': 'inconsistent-owned-job-id-list'}
            ids = [ctypes.c_size_t.from_buffer(buffer, 8 + n * size).value for n in range(listed)]
            identities = []
            for pid in ids:
                if time.monotonic() >= deadline_at:
                    return {'supported': True, 'assigned': assigned, 'listed': listed,
                            'processes': identities, 'remainingListedPidsNotIdentityQueried': ids[len(identities):],
                            'identityQueriesBoundedByAllowance': True}
                value = {'pid': pid, 'membershipVerified': False}
                handle = open_process(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION; no actuation.
                if not handle:
                    value['queryWinError'] = ctypes.get_last_error()
                else:
                    try:
                        belongs = wintypes.BOOL()
                        if not process_in_job(handle, job, ctypes.byref(belongs)):
                            value['membershipWinError'] = ctypes.get_last_error()
                        elif not belongs.value:
                            value['membershipChangedBeforeHandleRead'] = True
                        else:
                            value['membershipVerified'] = True
                            created, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
                            if process_times(handle, ctypes.byref(created), ctypes.byref(exited),
                                             ctypes.byref(kernel), ctypes.byref(user)):
                                value['creationFileTime'] = str((created.dwHighDateTime << 32) | created.dwLowDateTime)
                            else:
                                value['identityWinError'] = ctypes.get_last_error()
                    finally:
                        close_handle(handle)
                identities.append(value)
            return {'supported': True, 'assigned': assigned, 'listed': listed, 'processes': identities}
        failure = ctypes.get_last_error()
        if failure != 234:  # ERROR_MORE_DATA alone permits the second bounded capacity.
            break
    return {'supported': False, 'queryWinError': failure, 'reason': 'owned-job-id-list-unavailable'}


def await_quiescence(job, maximum_seconds=2.0):
    """Separate bounded settlement after direct child exit; active>0 never passes."""
    from datetime import datetime, timezone
    if maximum_seconds != 2.0:
        raise ValueError('FUP054 owns exactly a two-second observation allowance')
    started = time.monotonic()
    deadline_at = started + maximum_seconds
    observations = []
    while True:
        if observations and time.monotonic() >= deadline_at:
            last = observations[-1]
            return {'quiescent': False, 'observationReliable': True, 'observations': observations,
                    'elapsedMs': round((time.monotonic() - started) * 1000, 3),
                    'lastActiveProcesses': last['activeProcesses'],
                    'remainingOwnedIdentities': last['ownedIdentities']}
        account = Accounting()
        if not query_job(job, 1, ctypes.byref(account), ctypes.sizeof(account), None):
            return {'quiescent': False, 'observationReliable': False, 'queryWinError': ctypes.get_last_error(),
                    'observations': observations, 'elapsedMs': round((time.monotonic() - started) * 1000, 3)}
        identities = owned_identities(job, deadline_at)
        observation = {'atUtc': datetime.now(timezone.utc).isoformat(),
                       'elapsedMs': round((time.monotonic() - started) * 1000, 3),
                       'activeProcesses': account.ActiveProcesses, 'ownedIdentities': identities}
        observations.append(observation)
        elapsed = time.monotonic() - started
        if (elapsed <= maximum_seconds and account.ActiveProcesses == 0
                and (not identities['supported'] or identities['listed'] == 0)):
            return {'quiescent': True, 'observationReliable': True, 'observations': observations,
                    'elapsedMs': round(elapsed * 1000, 3), 'lastActiveProcesses': 0}
        if elapsed >= maximum_seconds:
            return {'quiescent': False, 'observationReliable': True, 'observations': observations,
                    'elapsedMs': round(elapsed * 1000, 3), 'lastActiveProcesses': account.ActiveProcesses,
                    'remainingOwnedIdentities': identities}
        time.sleep(min(0.025, maximum_seconds - elapsed))
