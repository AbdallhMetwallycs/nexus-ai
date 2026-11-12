//! The model registry: discover GGUF files and read their metadata for real.
//!
//! `MEASUREMENTS.md` §2 is the specification. Two facts from that section shape this file:
//!
//!  1. `general.file_type = 15` is `Q4_K_M`, confirmed against the engine's own loader
//!     ("Q4_K - Medium"). The quant label therefore comes from metadata, not the filename.
//!  2. The metadata block for a Llama-family file is ~4 MB because
//!     `tokenizer.ggml.tokens` is a 128,256-element string array. A reader sized for
//!     "a few KB of header" dies at ~4.1 MB. This reader streams the block and skips
//!     large arrays by seeking, so size is not a correctness variable.
//!
//! Nothing here downloads, copies or mutates a model. Discovery is read-only; removal is
//! an explicit command that validates the path is inside the configured models folder.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::admission::{kv_mb_per_token, Footprint, DEFAULT_CONTEXT};
use crate::error::{CoreResult, NexusError};
use crate::ipc_types::{GgufMetadata, ModelRecord};
use crate::system::iso8601_utc;

/// The one file the owner authorised at M1.2. Kept as a constant so "measured" is a
/// property of a file identity we can state, not a guess from a label.
pub const AUTHORISED_M1_BYTES: u64 = 2_019_377_440;
pub const AUTHORISED_M1_PARAMS: u64 = 3_212_749_888;

const MAGIC: u32 = 0x4655_4747; // "GGUF" little-endian
const MAX_STRING_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct GgufInfo {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub name: String,
    pub architecture: String,
    pub file_type: u32,
    pub context_length: u32,
    pub block_count: u32,
    pub embedding_length: u32,
    pub head_count: u32,
    pub head_count_kv: u32,
    /// Sum of all tensor element counts. `0` when the tensor block could not be read.
    pub parameter_count: u64,
    pub modified_ms: u64,
}

impl GgufInfo {
    pub fn quantization(&self) -> String {
        quant_label(self.file_type)
    }

    pub fn params_b(&self) -> f64 {
        (self.parameter_count as f64 / 1_000_000_000.0 * 100.0).round() / 100.0
    }

    pub fn size_gb(&self) -> f64 {
        round2(self.size_bytes as f64 / 1_073_741_824.0)
    }

    /// The private-RAM line for this file. The authorised model uses the two measured
    /// coefficients; every other file gets the documented estimate.
    pub fn footprint(&self) -> Footprint {
        if self.is_authorised_m1_model() {
            return Footprint::measured_llama_3b();
        }
        let slope = kv_mb_per_token(
            self.block_count,
            self.embedding_length,
            self.head_count,
            self.head_count_kv,
        );
        Footprint::estimated(self.size_bytes as f64 / (1024.0 * 1024.0), slope)
    }

    pub fn is_authorised_m1_model(&self) -> bool {
        self.size_bytes == AUTHORISED_M1_BYTES
            && self.parameter_count == AUTHORISED_M1_PARAMS
            && self.file_type == 15
    }

    pub fn metadata(&self) -> GgufMetadata {
        GgufMetadata {
            name: self.name.clone(),
            architecture: self.architecture.clone(),
            quantization: self.quantization(),
            context_length: self.context_length,
            parameter_count: self.parameter_count.to_string(),
            size_bytes: self.size_bytes,
            // Filled by an explicit integrity job, not by discovery: hashing 1.9 GB off
            // an SMR HDD costs ~25 s and must not block a screen (MEASUREMENTS.md §1).
            sha256: None,
        }
    }

    pub fn to_record(&self, in_catalog: bool) -> ModelRecord {
        let ram_at_default = self.footprint().estimate_private_mb(DEFAULT_CONTEXT) / 1024.0;
        ModelRecord {
            id: model_id_for(&self.path),
            name: self.name.clone(),
            family: self.architecture.clone(),
            params_b: self.params_b(),
            quantization: self.quantization(),
            context_window: self.context_length,
            size_gb: self.size_gb(),
            ram_gb: round2(ram_at_default),
            // The CPU baseline is verified; GPU offload is the MX150 question, still open.
            gpu_recommended: false,
            installed: true,
            in_catalog,
            version: "local".to_owned(),
            updated_at: iso8601_utc(self.modified_ms),
            description: format!(
                "Local {} file: {} parameters, {} quantization, {} advertised context.",
                self.architecture,
                human_params(self.parameter_count),
                self.quantization(),
                self.context_length
            ),
            tags: vec!["local".to_owned(), "gguf".to_owned(), self.quantization()],
        }
    }
}

/// Read one GGUF file's header, metadata and tensor table.
pub fn read_gguf(path: &Path) -> CoreResult<GgufInfo> {
    let file = File::open(path)
        .map_err(|e| NexusError::corrupt_model(&path.display().to_string(), e.to_string()))?;
    let meta = file
        .metadata()
        .map_err(|e| NexusError::corrupt_model(&path.display().to_string(), e.to_string()))?;
    let size_bytes = meta.len();
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut r = BufReader::with_capacity(64 * 1024, file);
    let magic = read_u32(&mut r).map_err(|e| corrupt(path, e))?;
    if magic != MAGIC {
        return Err(corrupt(path, "magic is not GGUF"));
    }
    let version = read_u32(&mut r).map_err(|e| corrupt(path, e))?;
    if version != 2 && version != 3 {
        return Err(corrupt(path, format!("unsupported GGUF version {version}")));
    }
    let tensor_count = read_u64(&mut r).map_err(|e| corrupt(path, e))?;
    let kv_count = read_u64(&mut r).map_err(|e| corrupt(path, e))?;
    if tensor_count > 1_000_000 || kv_count > 1_000_000 {
        return Err(corrupt(path, "implausible tensor/metadata counters"));
    }

    let mut kv: BTreeMap<String, Meta> = BTreeMap::new();
    for _ in 0..kv_count {
        let key = read_string(&mut r).map_err(|e| corrupt(path, e))?;
        let kind = read_u32(&mut r).map_err(|e| corrupt(path, e))?;
        let value = read_value(&mut r, kind).map_err(|e| corrupt(path, e))?;
        // Only scalars and short strings are kept; arrays are skipped after measuring
        // their length. `tokenizer.chat_template` (3.8 KB) is kept because it is small
        // and useful for prompt assembly later.
        if value.is_scalar() || value.str_len().is_some_and(|n| n <= 65_536) {
            kv.insert(key, value);
        }
    }

    let mut parameter_count = 0u64;
    for _ in 0..tensor_count {
        let _name = read_string(&mut r).map_err(|e| corrupt(path, e))?;
        let n_dims = read_u32(&mut r).map_err(|e| corrupt(path, e))?;
        if n_dims > 8 {
            return Err(corrupt(path, "tensor with more than 8 dimensions"));
        }
        let mut elements: u128 = 1;
        for _ in 0..n_dims {
            let dim = read_u64(&mut r).map_err(|e| corrupt(path, e))?;
            elements = elements.saturating_mul(dim as u128);
        }
        let _tensor_type = read_u32(&mut r).map_err(|e| corrupt(path, e))?;
        let _offset = read_u64(&mut r).map_err(|e| corrupt(path, e))?;
        parameter_count = parameter_count.saturating_add(elements.min(u128::from(u64::MAX)) as u64);
    }

    let architecture = kv
        .get("general.architecture")
        .and_then(Meta::as_str)
        .unwrap_or("unknown")
        .to_owned();
    let key = |suffix: &str| format!("{architecture}.{suffix}");
    let name = kv
        .get("general.name")
        .and_then(Meta::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
        });
    let context_length = kv
        .get(&key("context_length"))
        .and_then(Meta::as_u64)
        .unwrap_or(0)
        .min(u64::from(u32::MAX)) as u32;
    let block_count = kv.get(&key("block_count")).and_then(Meta::as_u64).unwrap_or(0) as u32;
    let embedding_length =
        kv.get(&key("embedding_length")).and_then(Meta::as_u64).unwrap_or(0) as u32;
    let head_count = kv
        .get(&key("attention.head_count"))
        .and_then(Meta::as_u64)
        .unwrap_or(0) as u32;
    let head_count_kv = kv
        .get(&key("attention.head_count_kv"))
        .and_then(Meta::as_u64)
        .unwrap_or(u64::from(head_count)) as u32;
    let file_type = kv.get("general.file_type").and_then(Meta::as_u64).unwrap_or(0) as u32;

    if context_length == 0 {
        return Err(corrupt(path, "missing context_length; refusing to guess a context cap"));
    }

    Ok(GgufInfo {
        path: path.to_path_buf(),
        size_bytes,
        name,
        architecture,
        file_type,
        context_length,
        block_count,
        embedding_length,
        head_count,
        head_count_kv,
        parameter_count,
        modified_ms,
    })
}

/// One failed file, surfaced rather than silently dropped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanFailure {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ScanReport {
    pub models: Vec<ModelRecord>,
    pub failures: Vec<ScanFailure>,
}

/// Read-only discovery over a models folder.
#[derive(Clone, Debug)]
pub struct Registry {
    pub models_dir: PathBuf,
}

impl Registry {
    pub fn new(models_dir: impl Into<PathBuf>) -> Self {
        Self { models_dir: models_dir.into() }
    }

    pub fn scan(&self) -> ScanReport {
        let mut report = ScanReport::default();
        let entries = match std::fs::read_dir(&self.models_dir) {
            Ok(entries) => entries,
            Err(_) => return report,
        };
        let mut paths: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("gguf"))
            })
            .collect();
        paths.sort();
        for path in paths {
            match read_gguf(&path) {
                Ok(info) => report.models.push(info.to_record(false)),
                Err(err) => report
                    .failures
                    .push(ScanFailure { path, message: err.to_string() }),
            }
        }
        report
    }

    pub fn find(&self, model_id: &str) -> CoreResult<GgufInfo> {
        for path in self.gguf_paths() {
            if model_id_for(&path) == model_id {
                return read_gguf(&path);
            }
        }
        Err(NexusError::model_not_found(model_id))
    }

    pub fn find_path(&self, model_id: &str) -> CoreResult<PathBuf> {
        for path in self.gguf_paths() {
            if model_id_for(&path) == model_id {
                return Ok(path);
            }
        }
        Err(NexusError::model_not_found(model_id))
    }

    pub fn gguf_paths(&self) -> Vec<PathBuf> {
        let mut paths: Vec<PathBuf> = std::fs::read_dir(&self.models_dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("gguf"))
            })
            .collect();
        paths.sort();
        paths
    }

    /// Remove one model by id, refusing ids that resolve outside the models folder.
    ///
    /// Deletion is permanent and only the UI's explicit confirmation may reach this; the
    /// function itself still re-validates the path so a crafted `modelId` cannot walk out.
    pub fn remove(&self, model_id: &str) -> CoreResult<u64> {
        let path = self.find_path(model_id)?;
        let canonical_root = self
            .models_dir
            .canonicalize()
            .map_err(|e| NexusError::internal("The models folder could not be resolved")
                .with_detail(e.to_string()))?;
        let canonical = path.canonicalize().map_err(|e| {
            NexusError::model_not_found(model_id).with_detail(e.to_string())
        })?;
        if !canonical.starts_with(&canonical_root) || canonical == canonical_root {
            return Err(NexusError::new(
                crate::error::ErrorCode::PolicyRootDenied,
                "That model path is outside the configured models folder.",
                false,
            ));
        }
        let size = std::fs::metadata(&canonical).map(|m| m.len()).unwrap_or(0);
        std::fs::remove_file(&canonical)
            .map_err(|e| NexusError::io("Removing the model file", &e))?;
        Ok(size)
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Meta {
    U(u64),
    I(i64),
    F(f64),
    Bool(bool),
    Str(String),
    Array(u64),
}

impl Meta {
    fn is_scalar(&self) -> bool {
        !matches!(self, Meta::Array(_))
    }

    fn as_u64(&self) -> Option<u64> {
        match self {
            Meta::U(v) => Some(*v),
            Meta::I(v) => u64::try_from(*v).ok(),
            Meta::Bool(v) => Some(u64::from(*v)),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Meta::Str(v) => Some(v),
            _ => None,
        }
    }

    fn str_len(&self) -> Option<u64> {
        match self {
            Meta::Str(v) => Some(v.len() as u64),
            _ => None,
        }
    }
}

fn read_value<R: Read + Seek>(r: &mut R, kind: u32) -> std::io::Result<Meta> {
    Ok(match kind {
        0 => Meta::U(u64::from(read_u8(r)?)),
        1 => Meta::I(i64::from(read_u8(r)? as i8)),
        2 => Meta::U(u64::from(read_u16(r)?)),
        3 => Meta::I(i64::from(read_u16(r)? as i16)),
        4 => Meta::U(u64::from(read_u32(r)?)),
        5 => Meta::I(i64::from(read_u32(r)? as i32)),
        6 => {
            let mut b = [0u8; 4];
            r.read_exact(&mut b)?;
            Meta::F(f32::from_le_bytes(b) as f64)
        }
        7 => Meta::Bool(read_u8(r)? != 0),
        8 => Meta::Str(read_string(r)?),
        9 => {
            let elem_kind = read_u32(r)?;
            let len = read_u64(r)?;
            if len > 100_000_000 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "array longer than 100M elements",
                ));
            }
            skip_array(r, elem_kind, len)?;
            Meta::Array(len)
        }
        10 => Meta::U(read_u64(r)?),
        11 => Meta::I(read_i64(r)?),
        12 => {
            let mut b = [0u8; 8];
            r.read_exact(&mut b)?;
            Meta::F(f64::from_le_bytes(b))
        }
        other => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unknown GGUF metadata type {other}"),
            ))
        }
    })
}

fn skip_array<R: Read + Seek>(r: &mut R, elem_kind: u32, len: u64) -> std::io::Result<()> {
    let fixed = match elem_kind {
        0 | 1 | 7 => Some(1u64),
        2 | 3 => Some(2),
        4..=6 => Some(4),
        10..=12 => Some(8),
        8 => None,
        9 => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "nested metadata arrays are not valid GGUF",
            ))
        }
        other => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unknown GGUF array element type {other}"),
            ))
        }
    };
    match fixed {
        Some(width) => {
            let bytes = width.saturating_mul(len);
            if bytes > 0 {
                skip_bytes(r, bytes)?;
            }
        }
        None => {
            // String array: each element is a u64 length plus bytes. The tokenizer table
            // is the 128k-element case from MEASUREMENTS.md §2.
            for _ in 0..len {
                let n = read_u64(r)?;
                if n > MAX_STRING_BYTES {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "string element larger than 16 MiB",
                    ));
                }
                if n > 0 {
                    skip_bytes(r, n)?;
                }
            }
        }
    }
    Ok(())
}

fn skip_bytes<R: Read + Seek>(r: &mut R, mut bytes: u64) -> std::io::Result<()> {
    // Small skips stay inside the BufReader's buffer; large ones seek so a 4 MB tokenizer
    // array is not read at all.
    if bytes <= 64 * 1024 {
        let mut scratch = [0u8; 8192];
        while bytes > 0 {
            let want = usize::try_from(bytes.min(scratch.len() as u64)).unwrap_or(scratch.len());
            r.read_exact(&mut scratch[..want])?;
            bytes -= want as u64;
        }
    } else {
        r.seek(SeekFrom::Current(i64::try_from(bytes).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "skip larger than i64")
        })?))?;
    }
    Ok(())
}

fn read_u8<R: Read>(r: &mut R) -> std::io::Result<u8> {
    let mut b = [0u8; 1];
    r.read_exact(&mut b)?;
    Ok(b[0])
}

fn read_u16<R: Read>(r: &mut R) -> std::io::Result<u16> {
    let mut b = [0u8; 2];
    r.read_exact(&mut b)?;
    Ok(u16::from_le_bytes(b))
}

fn read_u32<R: Read>(r: &mut R) -> std::io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_u64<R: Read>(r: &mut R) -> std::io::Result<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

fn read_i64<R: Read>(r: &mut R) -> std::io::Result<i64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(i64::from_le_bytes(b))
}

fn read_string<R: Read>(r: &mut R) -> std::io::Result<String> {
    let len = read_u64(r)?;
    if len > MAX_STRING_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "GGUF string larger than 16 MiB",
        ));
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn corrupt(path: &Path, detail: impl ToString) -> NexusError {
    NexusError::corrupt_model(&path.display().to_string(), detail.to_string())
}

/// Stable, filename-derived id. Phase 1 ids look like `llama-3.2-3b`; the same rule is
/// applied here so a renamed file becomes a different model rather than a silent swap.
pub fn model_id_for(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy()).unwrap_or_default();
    let mut out = String::with_capacity(stem.len());
    let mut last_dash = false;
    for ch in stem.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() || c == '.' {
            out.push(c);
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "model".to_owned()
    } else {
        out
    }
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// llama.cpp's `llama_ftype` enum, as recorded by `general.file_type`.
pub fn quant_label(file_type: u32) -> String {
    let label = match file_type {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        7 => "Q8_0",
        8 => "Q5_0",
        9 => "Q5_1",
        10 => "Q2_K",
        11 => "Q3_K_S",
        12 => "Q3_K_M",
        13 => "Q3_K_L",
        14 => "Q4_K_S",
        15 => "Q4_K_M",
        16 => "Q5_K_S",
        17 => "Q5_K_M",
        18 => "Q6_K",
        19 => "IQ2_XXS",
        20 => "IQ2_XS",
        21 => "IQ3_XXS",
        22 => "IQ1_S",
        23 => "IQ4_NL",
        24 => "IQ3_S",
        25 => "IQ2_S",
        26 => "IQ4_XS",
        27 => "IQ1_M",
        28 => "BF16",
        29 => "Q4_0_4_4",
        30 => "Q4_0_4_8",
        31 => "Q4_0_8_8",
        32 => "TQ1_0",
        33 => "TQ2_0",
        _ => return format!("FT{file_type}"),
    };
    label.to_owned()
}

fn human_params(n: u64) -> String {
    if n >= 1_000_000_000 {
        format!("{:.2}B", n as f64 / 1_000_000_000.0)
    } else if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else {
        n.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Builder(Vec<u8>);

    impl Builder {
        fn u32(&mut self, v: u32) {
            self.0.extend_from_slice(&v.to_le_bytes());
        }
        fn u64(&mut self, v: u64) {
            self.0.extend_from_slice(&v.to_le_bytes());
        }
        fn string(&mut self, s: &str) {
            self.u64(s.len() as u64);
            self.0.extend_from_slice(s.as_bytes());
        }
        fn kv_string(&mut self, key: &str, value: &str) {
            self.string(key);
            self.u32(8);
            self.string(value);
        }
        fn kv_u32(&mut self, key: &str, value: u32) {
            self.string(key);
            self.u32(4);
            self.u32(value);
        }
        fn kv_array_strings(&mut self, key: &str, values: &[&str]) {
            self.string(key);
            self.u32(9);
            self.u32(8);
            self.u64(values.len() as u64);
            for v in values {
                self.string(v);
            }
        }
    }

    fn synthetic(path: &Path, tensors: &[(&str, &[u64])]) {
        let mut b = Builder(Vec::new());
        b.u32(MAGIC);
        b.u32(3);
        b.u64(tensors.len() as u64);
        b.u64(9);
        b.kv_string("general.name", "Synthetic Llama");
        b.kv_string("general.architecture", "llama");
        b.kv_u32("general.file_type", 15);
        b.kv_u32("llama.context_length", 131_072);
        b.kv_u32("llama.block_count", 28);
        b.kv_u32("llama.embedding_length", 3_072);
        b.kv_u32("llama.attention.head_count", 24);
        b.kv_u32("llama.attention.head_count_kv", 8);
        // The 4 MB trap, shrunk: a string array must be skipped, not sized as "a few KB".
        b.kv_array_strings("tokenizer.ggml.tokens", &["a", "bb", "ccc"]);
        for (name, dims) in tensors {
            b.string(name);
            b.u32(dims.len() as u32);
            for d in *dims {
                b.u64(*d);
            }
            b.u32(0);
            b.u64(0);
        }
        std::fs::write(path, b.0).unwrap();
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nexus-registry-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_metadata_and_sums_tensor_elements() {
        let dir = temp_dir("read");
        let path = dir.join("Synthetic-Llama-3B-Q4_K_M.gguf");
        synthetic(&path, &[("token_embd.weight", &[128_256, 3_072]), ("blk.0.attn_q.weight", &[3_072, 3_072])]);
        let info = read_gguf(&path).unwrap();
        assert_eq!(info.name, "Synthetic Llama");
        assert_eq!(info.architecture, "llama");
        assert_eq!(info.quantization(), "Q4_K_M");
        assert_eq!(info.context_length, 131_072);
        assert_eq!(info.head_count_kv, 8);
        assert_eq!(info.parameter_count, 128_256 * 3_072 + 3_072 * 3_072);
        assert!(!info.is_authorised_m1_model());
        assert!((info.footprint().kv_mb_per_token - 0.1094).abs() < 0.001);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_truncated_file_is_model_corrupt_and_names_the_file() {
        let dir = temp_dir("truncated");
        let path = dir.join("broken.gguf");
        std::fs::write(&path, b"GGUF\x03\x00").unwrap();
        let err = read_gguf(&path).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::ModelCorrupt);
        assert!(err.message.contains("broken.gguf"), "{}", err.message);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_missing_context_is_refused_rather_than_defaulted() {
        let dir = temp_dir("noctx");
        let path = dir.join("noctx.gguf");
        let mut b = Builder(Vec::new());
        b.u32(MAGIC);
        b.u32(3);
        b.u64(0);
        b.u64(2);
        b.kv_string("general.architecture", "llama");
        b.kv_u32("llama.block_count", 28);
        std::fs::write(&path, b.0).unwrap();
        let err = read_gguf(&path).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::ModelCorrupt);
        assert!(err.to_string().contains("context_length"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn scan_separates_good_files_from_failures() {
        let dir = temp_dir("scan");
        synthetic(&dir.join("good.gguf"), &[("x", &[10, 10])]);
        std::fs::write(dir.join("bad.gguf"), b"not a gguf").unwrap();
        std::fs::write(dir.join("ignored.txt"), b"not a model").unwrap();
        let report = Registry::new(&dir).scan();
        assert_eq!(report.models.len(), 1);
        assert_eq!(report.failures.len(), 1);
        assert_eq!(report.models[0].id, "good");
        assert!(report.models[0].installed);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn removal_refuses_a_path_outside_the_models_folder() {
        let dir = temp_dir("remove");
        let outside = std::env::temp_dir().join(format!("nexus-outside-{}.gguf", std::process::id()));
        std::fs::write(&outside, b"x").unwrap();
        let registry = Registry::new(&dir);
        // No id can resolve outside because find_path only enumerates the folder; this
        // test documents the invariant rather than inventing a traversal input.
        assert!(registry.remove("../../../../etc/passwd").is_err());
        let _ = std::fs::remove_file(outside);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ids_are_stable_and_lowercase() {
        assert_eq!(
            model_id_for(Path::new("Llama-3.2-3B-Instruct-Q4_K_M.gguf")),
            "llama-3.2-3b-instruct-q4-k-m"
        );
    }
}
