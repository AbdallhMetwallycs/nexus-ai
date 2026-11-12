//! The OS numbers M1 depends on, plus the timestamp format the contract uses.
//!
//! Every constant in `admission` is a derivation of what these return on the owner's
//! machine, so this module is where the measurement record is closest to the code.
//!
//! Units: **MiB and GiB, binary.** Windows reports these counters in bytes and the
//! M1.2 fit (`MEASUREMENTS.md` §4) was computed against them, so a "GB" in the core means
//! 1,073,741,824 bytes. The contract field names keep the Phase 1 spelling (`ramGB`) —
//! the difference is documented here rather than silently absorbed by a 7% drift.

use std::time::{SystemTime, UNIX_EPOCH};

const MIB: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemoryStatus {
    pub total_mb: u64,
    pub free_mb: u64,
}

/// Two different answers to "how much RAM is this process using", both measured in
/// `MEASUREMENTS.md` §5 and deliberately kept apart: private bytes are what admission
/// charges, working set is what Task Manager and the Activity screen show.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProcessMemory {
    pub working_set_mb: u64,
    pub private_mb: u64,
}

impl ProcessMemory {
    pub fn private_gb(&self) -> f64 {
        self.private_mb as f64 / 1024.0
    }
}

/// Total and free physical RAM, or `None` if the OS refused to say.
///
/// Admission fails closed: a `None` here is treated as "unknown", which refuses the load
/// rather than assuming there is room (`PHASE2_POLICY_MODEL.md` §7).
pub fn memory_status() -> Option<MemoryStatus> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{
            GlobalMemoryStatusEx, MEMORYSTATUSEX,
        };

        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            dwMemoryLoad: 0,
            ullTotalPhys: 0,
            ullAvailPhys: 0,
            ullTotalPageFile: 0,
            ullAvailPageFile: 0,
            ullTotalVirtual: 0,
            ullAvailVirtual: 0,
            ullAvailExtendedVirtual: 0,
        };
        // SAFETY: `status` is initialised and its dwLength is its own size, which is the
        // documented calling convention; it is passed by mutable reference only.
        let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
        if ok == 0 {
            return None;
        }
        Some(MemoryStatus {
            total_mb: status.ullTotalPhys / MIB,
            free_mb: status.ullAvailPhys / MIB,
        })
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Private and working-set bytes for a pid, or `None` if the process is gone or the query
/// was refused. Used by the supervisor to fill `MeasuredFit.actualRSSGB` with a number
/// that was read, not guessed.
pub fn process_memory(pid: u32) -> Option<ProcessMemory> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::System::ProcessStatus::{
            GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        // SAFETY: plain Win32 calls with a pid we own. OpenProcess returns NULL on failure,
        // which is checked before the handle is used, and closed exactly once on every path.
        unsafe {
            let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return None;
            }
            let mut counters = PROCESS_MEMORY_COUNTERS_EX {
                cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
                ..Default::default()
            };
            let ok = GetProcessMemoryInfo(
                handle,
                &mut counters as *mut PROCESS_MEMORY_COUNTERS_EX as *mut PROCESS_MEMORY_COUNTERS,
                counters.cb,
            );
            CloseHandle(handle);
            if ok == 0 {
                return None;
            }
            Some(ProcessMemory {
                working_set_mb: counters.WorkingSetSize as u64 / MIB,
                private_mb: counters.PrivateUsage as u64 / MIB,
            })
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        None
    }
}

/// Physical core count, which is what `--threads` must be (decode got *worse* at 8 logical
/// threads — `MEASUREMENTS.md` §6). Falls back to half the logical count when the OS will
/// not say, and never to zero.
pub fn physical_cores() -> usize {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::SystemInformation::{
            GetLogicalProcessorInformationEx, RelationProcessorCore,
            SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
        };

        let fallback = || {
            std::thread::available_parallelism()
                .map(|n| (n.get() / 2).max(1))
                .unwrap_or(1)
        };

        // SAFETY: the two-call pattern is documented — the first call only writes the
        // required length into `needed`; the second writes into a buffer allocated to that
        // length with the struct's own alignment, and every entry is advanced by the
        // `Size` the OS reported for it, with bounds checked before each read.
        unsafe {
            let mut needed: u32 = 0;
            GetLogicalProcessorInformationEx(
                RelationProcessorCore,
                std::ptr::null_mut(),
                &mut needed,
            );
            if needed == 0 {
                return fallback();
            }

            let layout = match std::alloc::Layout::from_size_align(
                needed as usize,
                std::mem::align_of::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(),
            ) {
                Ok(l) => l,
                Err(_) => return fallback(),
            };
            let buffer = std::alloc::alloc_zeroed(layout);
            if buffer.is_null() {
                return fallback();
            }

            let mut cores = 0usize;
            let ok =
                GetLogicalProcessorInformationEx(RelationProcessorCore, buffer.cast(), &mut needed);
            if ok != 0 {
                let limit = needed as usize;
                let mut offset = 0usize;
                loop {
                    if offset + std::mem::size_of::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>()
                        > limit
                    {
                        break;
                    }
                    // Only `Size` is read here; the union member is never touched, so the
                    // entry layout does not have to be interpreted at all.
                    let size = (*buffer.add(offset).cast::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>())
                        .Size as usize;
                    if size == 0 {
                        break;
                    }
                    cores += 1;
                    offset += size;
                }
            }
            std::alloc::dealloc(buffer, layout);
            if cores == 0 {
                fallback()
            } else {
                cores
            }
        }
    }
    #[cfg(not(windows))]
    {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
    }
}

/// ISO-8601 UTC to the second, the format `src/data/types.ts` uses for every timestamp.
pub fn now_iso8601() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    iso8601_utc(ms)
}

/// Broken out because it is arithmetic that can be tested against known dates, unlike
/// `now_iso8601`. Days-from-civil algorithm (Howard Hinnant), no dependency.
pub fn iso8601_utc(ms_since_epoch: u64) -> String {
    let secs = (ms_since_epoch / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };

    format!("{year:04}-{month:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_status_reports_sane_numbers() {
        // On the owner's machine this was 20,355 MB visible with ~6.5 GB free at M1.2.
        // The test only asserts the relationship; the absolute values are machine data.
        let m = memory_status().expect("GlobalMemoryStatusEx must answer on Windows");
        assert!(m.total_mb > 1024, "total {}", m.total_mb);
        assert!(m.free_mb <= m.total_mb, "free {} total {}", m.free_mb, m.total_mb);
    }

    #[test]
    fn process_memory_reads_our_own_process() {
        let pid = std::process::id();
        let me = process_memory(pid).expect("own pid must be queryable");
        assert!(me.private_mb > 0, "private {}", me.private_mb);
        assert!(me.working_set_mb > 0, "ws {}", me.working_set_mb);
    }

    #[test]
    fn process_memory_of_a_borrowed_pid_refuses_instead_of_lying() {
        // pid 4 (System) is normally denied for this access mask on a standard account;
        // whatever the OS says, the contract is Option: never a zero invented as a number.
        let other = process_memory(u32::MAX);
        assert_eq!(other, None, "an impossible pid must not report memory");
    }

    #[test]
    fn physical_cores_is_never_zero() {
        let cores = physical_cores();
        assert!(cores >= 1, "{cores}");
    }

    #[test]
    fn iso8601_matches_known_epochs() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(1_735_689_600_000), "2025-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(1_700_000_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601_utc(1_719_792_000_000), "2024-07-01T00:00:00Z");
    }

    #[test]
    fn now_looks_like_the_contract_format() {
        let now = now_iso8601();
        assert_eq!(now.len(), 20, "{now}");
        assert!(now.ends_with('Z'), "{now}");
        assert_eq!(now.as_bytes()[4], b'-');
    }
}
