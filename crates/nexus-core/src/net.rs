//! A loopback HTTP/1.1 client, written on `std::net`.
//!
//! Why this file exists instead of a dependency: the engine is reached at
//! `127.0.0.1:<random port>` over plain HTTP with a bearer token
//! (`PHASE2_SIDECAR_SPEC.md` §1.4). The reqwest/hyper tree is several hundred crates and
//! its value is TLS, connection pools and redirects — none of which cross a loopback
//! socket on a machine whose whole budget is 15 W. What this client must do correctly is
//! small: send a request, read a response, decode chunked transfer, and split an SSE
//! stream into deltas it can hand to a callback that may say "stop".
//!
//! Two measured behaviours shape the API:
//!  - `/health` answers **without** the API key while every other route 401s without it
//!    (`MEASUREMENTS.md` §10), so health probes deliberately send no Authorization header.
//!  - closing the socket mid-stream is the cancel path; the engine then reaches an idle
//!    slot in ~1.7 s (`MEASUREMENTS.md` §8). `stream` therefore returns as soon as the
//!    callback asks it to, and dropping the stream is the abort.

use std::io::{BufRead, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::error::{CoreResult, NexusError};

/// A handle another thread can use to interrupt a blocking stream read.
///
/// Dropping the request's own socket is not enough: the read sits in the kernel. A cloned
/// handle plus `shutdown(Both)` wakes it immediately, which is how Stop interrupts prefill
/// (measured cancel-to-idle: 231–1,744 ms, `MEASUREMENTS.md` §8) rather than waiting for
/// the first token.
#[derive(Clone, Default)]
pub struct CancelHandle {
    socket: Arc<Mutex<Option<TcpStream>>>,
    cancelled: Arc<AtomicBool>,
}

impl CancelHandle {
    pub fn new() -> Self {
        Self::default()
    }

    fn attach(&self, socket: &TcpStream) -> CoreResult<()> {
        let clone = socket
            .try_clone()
            .map_err(|e| NexusError::io("Cloning the streaming socket", &e))?;
        if let Ok(mut slot) = self.socket.lock() {
            *slot = Some(clone);
        }
        Ok(())
    }

    fn detach(&self) {
        if let Ok(mut slot) = self.socket.lock() {
            *slot = None;
        }
    }

    /// Safe to call from any thread and any number of times.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = self.socket.lock() {
            if let Some(socket) = slot.take() {
                let _ = socket.shutdown(Shutdown::Both);
            }
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// One request/response exchange against the sidecar.
#[derive(Clone, Debug)]
pub struct Loopback {
    pub port: u16,
    pub api_key: String,
    pub connect_timeout: Duration,
    pub read_timeout: Duration,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Status(pub u16);

#[derive(Clone, Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    pub fn json(&self) -> CoreResult<Value> {
        serde_json::from_slice(&self.body).map_err(|err| {
            NexusError::internal("The engine answered with something that is not JSON")
                .with_detail(format!("status {}: {err} — {}", self.status, self.text()))
        })
    }
}

impl Loopback {
    pub fn new(port: u16, api_key: impl Into<String>) -> Self {
        Self {
            port,
            api_key: api_key.into(),
            // A weightless start binds in ~100 ms; the generous part of the budget lives in
            // `engine::wait_for_health`, not here, so a hung read is a real fault.
            connect_timeout: Duration::from_millis(500),
            read_timeout: Duration::from_millis(2_000),
        }
    }

    fn connect(&self) -> CoreResult<TcpStream> {
        let addr = std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, self.port));
        let socket = TcpStream::connect_timeout(&addr, self.connect_timeout)
            .map_err(|e| NexusError::io("Connecting to the engine", &e))?;
        socket.set_read_timeout(Some(self.read_timeout))?;
        socket.set_write_timeout(Some(self.connect_timeout))?;
        Ok(socket)
    }

    /// `GET` with no Authorization header — the only route the engine answers keyless.
    pub fn get_unauthenticated(&self, path: &str) -> CoreResult<HttpResponse> {
        self.request("GET", path, None, None, Duration::from_millis(1_500))
    }

    pub fn get(&self, path: &str) -> CoreResult<HttpResponse> {
        self.request("GET", path, None, None, self.read_timeout)
    }

    pub fn post_json(&self, path: &str, body: &Value) -> CoreResult<HttpResponse> {
        self.request("POST", path, Some(body), Some("application/json"), self.read_timeout)
    }

    /// The single low-level call every other method goes through, so there is exactly one
    /// place where the request line and headers are assembled.
    pub fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
        content_type: Option<&str>,
        timeout: Duration,
    ) -> CoreResult<HttpResponse> {
        let mut socket = self.connect()?;
        socket.set_read_timeout(Some(timeout))?;

        let payload = body.map(|b| b.to_string().into_bytes()).unwrap_or_default();
        let mut head = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n", self.port);
        head.push_str("Accept: application/json\r\n");
        if !payload.is_empty() {
            let ct = content_type.unwrap_or("application/json");
            head.push_str(&format!("Content-Type: {ct}\r\nContent-Length: {}\r\n", payload.len()));
        }
        if !self.api_key.is_empty() {
            head.push_str(&format!("Authorization: Bearer {}\r\n", self.api_key));
        }
        head.push_str("Connection: close\r\n\r\n");

        socket.write_all(head.as_bytes())?;
        socket.write_all(&payload)?;
        socket.flush()?;

        let mut raw = Vec::new();
        socket.read_to_end(&mut raw)?;
        split_response(&raw).ok_or_else(|| {
            NexusError::internal("The engine closed the connection without a response")
                .with_detail(format!("{method} {path}"))
        })
    }

    /// `POST` a streaming chat completion and hand each text delta to `on_delta`.
    ///
    /// Returns once the model says it is done, the stream ends, or `on_delta` returns
    /// `false` — the last of those is the cancel path, and it drops the socket on purpose.
    pub fn stream_chat(
        &self,
        body: &Value,
        cancel: Option<&CancelHandle>,
        mut on_delta: impl FnMut(&str) -> bool,
    ) -> CoreResult<StreamOutcome> {
        let mut socket = self.connect()?;
        if let Some(handle) = cancel {
            handle.attach(&socket)?;
        }
        let outcome = self.stream_chat_on(&mut socket, body, cancel, &mut on_delta);
        if let Some(handle) = cancel {
            handle.detach();
            // A stop request shuts the socket down, which surfaces here as an I/O error.
            // That is the intended path, not a fault: report a cancelled stream.
            if handle.is_cancelled() {
                if let Err(_err) = &outcome {
                    return Ok(StreamOutcome { cancelled: true, ..StreamOutcome::default() });
                }
            }
        }
        outcome
    }

    fn stream_chat_on(
        &self,
        socket: &mut TcpStream,
        body: &Value,
        cancel: Option<&CancelHandle>,
        on_delta: &mut dyn FnMut(&str) -> bool,
    ) -> CoreResult<StreamOutcome> {
        // A short timeout is what makes Stop work: Windows `select` does not reliably wake
        // on `shutdown()` from another thread, so the reader wakes itself every 250 ms and
        // checks the cancel flag instead of blocking for the 36 s prefill.
        socket.set_read_timeout(Some(Duration::from_millis(250)))?;

        let payload = body.to_string();
        let mut head = format!("POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n", self.port);
        head.push_str("Content-Type: application/json\r\nAccept: text/event-stream\r\n");
        head.push_str(&format!("Content-Length: {}\r\n", payload.len()));
        head.push_str(&format!("Authorization: Bearer {}\r\n", self.api_key));
        head.push_str("Connection: close\r\n\r\n");
        socket.write_all(head.as_bytes())?;
        socket.write_all(payload.as_bytes())?;
        socket.flush()?;

        let mut reader = std::io::BufReader::new(socket);
        let status = read_status_line_wait(&mut reader, Duration::from_secs(30), cancel)?;
        if status != 200 {
            let mut rest = Vec::new();
            let _ = reader.read_to_end(&mut rest);
            let detail = String::from_utf8_lossy(&rest).into_owned();
            return Err(match status {
                401 => NexusError::internal("The engine rejected the API key")
                    .with_detail("POST /v1/chat/completions: 401"),
                429 => NexusError::new(
                    crate::error::ErrorCode::EngineBusy,
                    "The engine is busy with another request.",
                    true,
                )
                .with_detail(detail),
                other => NexusError::engine_not_ready(format!(
                    "POST /v1/chat/completions answered {other}"
                ))
                .with_detail(detail),
            });
        }
        // Headers are discarded: chunked framing is detected from the header set, and this
        // is a loopback connection we close after one response.
        let mut headers = Vec::new();
        let header_deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let line = read_line_wait(&mut reader, header_deadline, cancel)?;
            let trimmed = line.trim_end();
            if trimmed.is_empty() {
                break;
            }
            headers.push(trimmed.to_string());
        }
        let chunked = headers
            .iter()
            .any(|h| h.to_ascii_lowercase().replace(' ', "").starts_with("transfer-encoding:chunked"));

        let started = Instant::now();
        let mut outcome = StreamOutcome {
            first_token_ms: None,
            tokens: 0,
            chars: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            cached_tokens: 0,
            cancelled: false,
            elapsed_ms: 0,
        };

        let source = if chunked {
            Box::new(ChunkedRead { inner: reader, remaining: 0, header_pending: false })
                as Box<dyn Read + '_>
        } else {
            Box::new(reader) as Box<dyn Read + '_>
        };
        let mut buffered = std::io::BufReader::new(source);

        // SSE frames: "data: {...}\n\n". Anything else (": keep-alive", empty line) is
        // skipped, and the loop stops at the terminal "[DONE]" sentinel. `pending` keeps a
        // partial line across a read timeout rather than dropping it.
        let mut pending: Vec<u8> = Vec::new();
        let mut finished = false;
        while !finished {
            match buffered.read_until(b'\n', &mut pending) {
                Ok(0) => {
                    outcome.cancelled = cancel.is_some_and(CancelHandle::is_cancelled);
                    break;
                }
                Ok(_) => {}
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    if cancel.is_some_and(CancelHandle::is_cancelled) {
                        outcome.cancelled = true;
                        break;
                    }
                    continue;
                }
                Err(e) => {
                    if cancel.is_some_and(CancelHandle::is_cancelled) {
                        outcome.cancelled = true;
                        break;
                    }
                    return Err(e.into());
                }
            }
            if pending.len() > 4 * 1024 * 1024 {
                return Err(NexusError::internal(
                    "A streaming frame grew past 4 MiB without a newline.",
                ));
            }

            while let Some(pos) = pending.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = pending.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line);
                let line = line.trim_end_matches(['\r', '\n']);
                let Some(data) = line.strip_prefix("data:") else { continue };
                let data = data.trim();
                if data == "[DONE]" {
                    finished = true;
                    break;
                }
                let value: Value = match serde_json::from_str(data) {
                    Ok(v) => v,
                    // A malformed frame is a fault, not something to swallow: it says so.
                    Err(err) => {
                        return Err(NexusError::internal("A streaming frame did not parse")
                            .with_detail(format!("{err}: {}", &data[..data.len().min(200)])))
                    }
                };

                if let Some(usage) = value.get("usage").filter(|u| !u.is_null()) {
                    outcome.prompt_tokens = usage_u64(usage, "prompt_tokens") as u32;
                    outcome.completion_tokens = usage_u64(usage, "completion_tokens") as u32;
                    outcome.total_tokens = usage_u64(usage, "total_tokens") as u32;
                    outcome.cached_tokens = usage
                        .get("prompt_tokens_details")
                        .and_then(|d| d.get("cached_tokens"))
                        .and_then(Value::as_u64)
                        .unwrap_or(0) as u32;
                }

                let text = value
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|a| a.first())
                    .and_then(|c| {
                        c.get("delta")
                            .and_then(|d| d.get("content"))
                            .or_else(|| c.get("content"))
                    })
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if !text.is_empty() {
                    if outcome.first_token_ms.is_none() {
                        outcome.first_token_ms = Some(started.elapsed().as_millis() as u64);
                    }
                    outcome.tokens += 1;
                    outcome.chars += text.chars().count() as u32;
                    if !on_delta(text) {
                        outcome.cancelled = true;
                        finished = true;
                        break;
                    }
                }
                if cancel.is_some_and(CancelHandle::is_cancelled) {
                    outcome.cancelled = true;
                    finished = true;
                    break;
                }
            }
        }

        outcome.elapsed_ms = started.elapsed().as_millis() as u64;
        Ok(outcome)
    }
}

/// What one streamed completion cost, as the engine reported it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StreamOutcome {
    pub first_token_ms: Option<u64>,
    /// SSE frames carrying content, not model tokens.
    pub tokens: u32,
    pub chars: u32,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    /// `prompt_tokens_details.cached_tokens`. Zero every time in `MEASUREMENTS.md` §7;
    /// carried forward because making it non-zero is the M1 premise follow-up.
    pub cached_tokens: u32,
    pub cancelled: bool,
    pub elapsed_ms: u64,
}

fn usage_u64(usage: &Value, key: &str) -> u64 {
    usage.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn read_status_line_wait<R: BufRead>(
    reader: &mut R,
    budget: Duration,
    cancel: Option<&CancelHandle>,
) -> CoreResult<u16> {
    let line = read_line_wait(reader, Instant::now() + budget, cancel)?;
    if line.is_empty() {
        return Err(NexusError::internal("The engine closed the connection without a status"));
    }
    let code = line
        .split_whitespace()
        .nth(1)
        .and_then(|n| n.parse::<u16>().ok())
        .ok_or_else(|| {
            NexusError::internal("An HTTP status line could not be read").with_detail(line)
        })?;
    Ok(code)
}

/// Read one line, waking every 250 ms so Stop can be checked during prefill.
///
/// The accumulated bytes survive a timeout, which is why this is not `read_line` on a fresh
/// `String`: a partial SSE frame must not be dropped just because the model had not finished
/// thinking when the timeout fired.
fn read_line_wait<R: BufRead>(
    reader: &mut R,
    deadline: Instant,
    cancel: Option<&CancelHandle>,
) -> CoreResult<String> {
    let mut acc: Vec<u8> = Vec::new();
    loop {
        match reader.read_until(b'\n', &mut acc) {
            Ok(_) => return Ok(String::from_utf8_lossy(&acc).into_owned()),
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                if cancel.is_some_and(CancelHandle::is_cancelled) {
                    return Err(NexusError::new(
                        crate::error::ErrorCode::JobCancelled,
                        "The generation was stopped.",
                        false,
                    ));
                }
                if Instant::now() > deadline {
                    return Err(NexusError::engine_not_ready(
                        "No HTTP response head arrived within the budget.",
                    ));
                }
                continue;
            }
            Err(e) => return Err(e.into()),
        }
    }
}

/// Split a fully buffered response into status and body, handling both
/// `Content-Length` and chunked framing.
fn split_response(raw: &[u8]) -> Option<HttpResponse> {
    let separator = b"\r\n\r\n";
    let head_end = raw.windows(4).position(|w| w == separator)?;
    let head = std::str::from_utf8(&raw[..head_end]).ok()?;
    let mut lines = head.lines();
    let status = lines
        .next()?
        .split_whitespace()
        .nth(1)?
        .parse::<u16>()
        .ok()?;
    let mut chunked = false;
    let mut length: Option<usize> = None;
    for line in lines {
        let (name, value) = line.split_once(':')?;
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        match name.as_str() {
            "transfer-encoding" => chunked = value.to_ascii_lowercase().contains("chunked"),
            "content-length" => length = value.parse().ok(),
            _ => {}
        }
    }
    let body_bytes = &raw[head_end + 4..];
    let body = if chunked {
        decode_chunks(body_bytes)?
    } else if let Some(n) = length {
        body_bytes[..n.min(body_bytes.len())].to_vec()
    } else {
        body_bytes.to_vec()
    };
    Some(HttpResponse { status, body })
}

fn decode_chunks(mut data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let line_end = data.windows(2).position(|w| w == b"\r\n")?;
        let size_hex = std::str::from_utf8(&data[..line_end]).ok()?;
        let size = usize::from_str_radix(size_hex.trim().split(';').next()?, 16).ok()?;
        if size == 0 {
            return Some(out);
        }
        let start = line_end + 2;
        let end = start + size;
        if data.len() < end + 2 {
            return None;
        }
        out.extend_from_slice(&data[start..end]);
        data = &data[end + 2..];
    }
}

/// `Read` that un-skins HTTP chunked framing on the fly, for streaming.
struct ChunkedRead<R: BufRead> {
    inner: R,
    remaining: usize,
    header_pending: bool,
}

impl<R: BufRead> Read for ChunkedRead<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.remaining == 0 && !self.header_pending {
            // Read the next chunk size line.
            let mut line = String::new();
            let read = self.inner.read_line(&mut line)?;
            if read == 0 {
                return Ok(0);
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return Ok(0);
            }
            let size = usize::from_str_radix(trimmed.split(';').next().unwrap_or("").trim(), 16)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            if size == 0 {
                self.remaining = 0;
                self.header_pending = true; // terminal chunk: stop serving data
                return Ok(0);
            }
            self.remaining = size;
        } else if self.header_pending {
            return Ok(0);
        }

        let want = buf.len().min(self.remaining);
        let got = self.inner.read(&mut buf[..want])?;
        self.remaining -= got;
        if self.remaining == 0 && !self.header_pending {
            // Consume the CRLF that terminates a chunk.
            let mut crlf = [0u8; 2];
            let _ = self.inner.read_exact(&mut crlf);
        }
        Ok(got)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_response_handles_content_length() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello";
        let r = split_response(raw).unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.text(), "hello");
    }

    #[test]
    fn split_response_handles_chunked() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
        let r = split_response(raw).unwrap();
        assert_eq!(r.text(), "hello world");
    }

    #[test]
    fn chunked_reader_unwraps_a_split_stream() {
        let raw = b"7\r\ndata: o\r\n\r\n0\r\n\r\n";
        let cursor = std::io::Cursor::new(&raw[..]);
        let mut reader = ChunkedRead {
            inner: std::io::BufReader::new(cursor),
            remaining: 0,
            header_pending: false,
        };
        let mut out = String::new();
        reader.read_to_string(&mut out).unwrap();
        assert_eq!(out, "data: o");
    }

    #[test]
    fn a_closed_port_is_an_error_not_a_hang() {
        // Bind and drop a listener so the port is definitely unused, then try it.
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let client = Loopback::new(port, "0".repeat(32));
        let err = client.get("/health").unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::Internal);
        assert!(err.retryable, "a refused socket is retryable by definition");
    }

    /// Serve one HTTP/1.1 chunked SSE response. `gap` is the delay before the first frame,
    /// which is how prefill looks to the client: headers already sent, no token yet.
    fn mock_sse_server(
        frames: Vec<String>,
        gap: Duration,
    ) -> (u16, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else { return };
            let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
            let mut content_length = 0usize;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                if line == "\r\n" {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    if name.eq_ignore_ascii_case("content-length") {
                        content_length = value.trim().parse().unwrap_or(0);
                    }
                }
            }
            let mut body = vec![0u8; content_length];
            let _ = reader.read_exact(&mut body);
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
            );
            let _ = stream.flush();
            std::thread::sleep(gap);
            for frame in frames {
                let bytes = frame.as_bytes();
                if write!(stream, "{:x}\r\n", bytes.len()).is_err() {
                    return;
                }
                if stream.write_all(bytes).is_err() || stream.write_all(b"\r\n").is_err() {
                    return;
                }
                let _ = stream.flush();
                std::thread::sleep(Duration::from_millis(40));
            }
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        (port, handle)
    }

    #[test]
    fn streaming_unwraps_chunked_sse_and_reads_usage() {
        let frames = vec![
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n".to_string(),
            "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n".to_string(),
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":2,\"total_tokens\":9}}\n\n".to_string(),
            "data: [DONE]\n\n".to_string(),
        ];
        let (port, server) = mock_sse_server(frames, Duration::ZERO);
        let client = Loopback::new(port, "token");
        let mut text = String::new();
        let outcome = client
            .stream_chat(&serde_json::json!({"messages":[]}), None, |delta| {
                text.push_str(delta);
                true
            })
            .unwrap();
        assert_eq!(text, "Hello");
        assert_eq!(outcome.tokens, 2);
        assert_eq!(outcome.prompt_tokens, 7);
        assert_eq!(outcome.completion_tokens, 2);
        assert!(!outcome.cancelled);
        let _ = server.join();
    }

    #[test]
    fn stop_interrupts_the_read_during_prefill_without_waiting_for_a_token() {
        // One frame arrives after 2 s; cancel is fired at 100 ms. If cancellation only
        // checked on a delta, this test would take two seconds and return a token.
        let frames = vec![
            "data: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n\n".to_string(),
            "data: [DONE]\n\n".to_string(),
        ];
        let (port, server) = mock_sse_server(frames, Duration::from_secs(2));
        let client = Loopback::new(port, "token");
        let handle = CancelHandle::new();
        let trigger = handle.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            trigger.cancel();
        });
        let started = Instant::now();
        let mut text = String::new();
        let outcome = client
            .stream_chat(&serde_json::json!({"messages":[]}), Some(&handle), |delta| {
                text.push_str(delta);
                true
            })
            .unwrap();
        let elapsed = started.elapsed();
        assert!(outcome.cancelled, "{outcome:?}");
        assert_eq!(text, "");
        assert!(elapsed < Duration::from_millis(1_500), "took {elapsed:?}");
        let _ = canceller.join();
        let _ = server.join();
    }
}
