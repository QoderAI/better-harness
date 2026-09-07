//! ACP file and terminal services.
//!
//! Files are fenced by canonical paths before any read or write. Terminals are
//! deliberately non-interactive processes: stdin is null so an Agent cannot hang
//! on a prompt, while stdout and stderr are retained behind a byte ceiling and
//! exposed through the ACP polling methods.
//!
//! Zed renders a true PTY because it owns a terminal emulator. This sidecar has
//! no terminal UI; using piped output is the smaller honest implementation until
//! Studio owns terminal emulation. The ACP lifecycle (`create`, `output`, `kill`,
//! `release`, `wait_for_exit`) remains the same.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{
    CreateTerminalRequest, CreateTerminalResponse, Error, KillTerminalRequest,
    KillTerminalResponse, ReadTextFileRequest, ReadTextFileResponse, ReleaseTerminalRequest,
    ReleaseTerminalResponse, TerminalExitStatus, TerminalOutputRequest, TerminalOutputResponse,
    WaitForTerminalExitRequest, WaitForTerminalExitResponse, WriteTextFileRequest,
    WriteTextFileResponse,
};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::{Mutex as AsyncMutex, mpsc, watch};

use crate::fence::Fence;

pub const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_TERMINALS: usize = 8;
pub const MAX_TERMINAL_OUTPUT_BYTES: usize = 1024 * 1024;

/// Capabilities owned by one Agent connection.
#[derive(Clone)]
pub struct ClientServices {
    fence: Arc<Fence>,
    terminals: TerminalRegistry,
}

impl ClientServices {
    pub fn new(fence: Fence) -> Self {
        Self {
            fence: Arc::new(fence),
            terminals: TerminalRegistry::default(),
        }
    }

    pub fn fence(&self) -> &Fence {
        &self.fence
    }

    pub async fn read_text_file(
        &self,
        request: ReadTextFileRequest,
    ) -> Result<ReadTextFileResponse, Error> {
        let path = self
            .fence
            .resolve_read(&request.path)
            .map_err(fence_error)?;
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|_| Error::resource_not_found(None))?;
        if metadata.len() > MAX_FILE_BYTES as u64 {
            return Err(invalid("the requested file exceeds the 8 MiB read limit"));
        }
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|_| invalid("the requested file is not readable UTF-8 text"))?;
        Ok(ReadTextFileResponse::new(select_lines(
            &content,
            request.line,
            request.limit,
        )?))
    }

    pub async fn write_text_file(
        &self,
        request: WriteTextFileRequest,
    ) -> Result<WriteTextFileResponse, Error> {
        if request.content.len() > MAX_FILE_BYTES {
            return Err(invalid(
                "the requested content exceeds the 8 MiB write limit",
            ));
        }
        let path = self
            .fence
            .resolve_write(&request.path)
            .map_err(fence_error)?;
        tokio::fs::write(path, request.content)
            .await
            .map_err(|_| Error::internal_error().data("the file could not be written"))?;
        Ok(WriteTextFileResponse::new())
    }

    pub async fn create_terminal(
        &self,
        request: CreateTerminalRequest,
    ) -> Result<CreateTerminalResponse, Error> {
        self.terminals.create(&self.fence, request).await
    }

    pub async fn terminal_output(
        &self,
        request: TerminalOutputRequest,
    ) -> Result<TerminalOutputResponse, Error> {
        self.terminals.output(request.terminal_id.0.as_ref()).await
    }

    pub async fn kill_terminal(
        &self,
        request: KillTerminalRequest,
    ) -> Result<KillTerminalResponse, Error> {
        self.terminals.kill(request.terminal_id.0.as_ref()).await?;
        Ok(KillTerminalResponse::new())
    }

    pub async fn release_terminal(
        &self,
        request: ReleaseTerminalRequest,
    ) -> Result<ReleaseTerminalResponse, Error> {
        self.terminals
            .release(request.terminal_id.0.as_ref())
            .await?;
        Ok(ReleaseTerminalResponse::new())
    }

    pub async fn wait_for_terminal_exit(
        &self,
        request: WaitForTerminalExitRequest,
    ) -> Result<WaitForTerminalExitResponse, Error> {
        let status = self.terminals.wait(request.terminal_id.0.as_ref()).await?;
        Ok(WaitForTerminalExitResponse::new(status.to_acp()))
    }
}

fn fence_error(error: crate::fence::FenceError) -> Error {
    // FenceError intentionally contains no path, so forwarding its text does not
    // leak the machine's directory layout into an Agent-visible error.
    Error::invalid_params().data(error.to_string())
}

fn invalid(message: &str) -> Error {
    Error::invalid_params().data(message)
}

/// ACP line arguments are 1-based. Missing, zero, and one all start at line one,
/// matching Zed's `unwrap_or_default().saturating_sub(1)` behavior.
fn select_lines(content: &str, line: Option<u32>, limit: Option<u32>) -> Result<String, Error> {
    let start = line.unwrap_or_default().saturating_sub(1) as usize;
    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    // A trailing file without a newline is still one line. Empty files accept
    // line one and return empty text.
    let line_count = lines.len().max(1);
    if start >= line_count && !(content.is_empty() && start == 0) {
        return Err(invalid(
            "the requested start line is past the end of the file",
        ));
    }
    let count = limit.unwrap_or(u32::MAX) as usize;
    Ok(lines.into_iter().skip(start).take(count).collect())
}

#[derive(Clone, Default)]
struct TerminalRegistry {
    terminals: Arc<AsyncMutex<HashMap<String, Arc<Terminal>>>>,
}

impl TerminalRegistry {
    async fn create(
        &self,
        fence: &Fence,
        request: CreateTerminalRequest,
    ) -> Result<CreateTerminalResponse, Error> {
        let mut terminals = self.terminals.lock().await;
        if terminals.len() >= MAX_TERMINALS {
            return Err(invalid(
                "the session already has the maximum of 8 terminals",
            ));
        }
        let cwd = match request.cwd.as_ref() {
            Some(cwd) => {
                let path = fence.resolve_read(cwd).map_err(fence_error)?;
                if !path.is_dir() {
                    return Err(invalid("the terminal cwd is not a directory"));
                }
                path
            }
            None => fence
                .roots()
                .first()
                .cloned()
                .ok_or_else(|| invalid("the terminal needs a granted working directory"))?,
        };
        let limit = request
            .output_byte_limit
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(MAX_TERMINAL_OUTPUT_BYTES)
            .min(MAX_TERMINAL_OUTPUT_BYTES);

        let id = uuid::Uuid::new_v4().to_string();
        let terminal = Arc::new(Terminal::spawn(request, cwd, limit).await?);
        terminals.insert(id.clone(), terminal);
        Ok(CreateTerminalResponse::new(id))
    }

    async fn get(&self, id: &str) -> Result<Arc<Terminal>, Error> {
        self.terminals
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| Error::resource_not_found(None))
    }

    async fn output(&self, id: &str) -> Result<TerminalOutputResponse, Error> {
        let terminal = self.get(id).await?;
        let (output, truncated) = terminal.output.snapshot();
        let exit = terminal.exit.borrow().clone();
        Ok(TerminalOutputResponse::new(output, truncated)
            .exit_status(exit.map(|status| status.to_acp())))
    }

    async fn kill(&self, id: &str) -> Result<(), Error> {
        self.get(id)
            .await?
            .kill
            .send(())
            .await
            .map_err(|_| Error::internal_error().data("the terminal has already exited"))
    }

    async fn release(&self, id: &str) -> Result<(), Error> {
        let terminal = self
            .terminals
            .lock()
            .await
            .remove(id)
            .ok_or_else(|| Error::resource_not_found(None))?;
        // Release is kill + unregister. Failure to send means it already exited,
        // which is still a successful release.
        let _ = terminal.kill.send(()).await;
        Ok(())
    }

    async fn wait(&self, id: &str) -> Result<ExitSnapshot, Error> {
        let terminal = self.get(id).await?;
        let mut exit = terminal.exit.clone();
        loop {
            if let Some(status) = exit.borrow().clone() {
                return Ok(status);
            }
            exit.changed()
                .await
                .map_err(|_| Error::internal_error().data("the terminal exit channel closed"))?;
        }
    }
}

struct Terminal {
    output: OutputBuffer,
    kill: mpsc::Sender<()>,
    exit: watch::Receiver<Option<ExitSnapshot>>,
}

impl Terminal {
    async fn spawn(
        request: CreateTerminalRequest,
        cwd: std::path::PathBuf,
        output_limit: usize,
    ) -> Result<Self, Error> {
        let mut command = Command::new(&request.command);
        command
            .args(&request.args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // A dropped supervisor must not leave the command behind.
            .kill_on_drop(true)
            .env("PAGER", "")
            .env("GIT_PAGER", "cat");
        // Agent values intentionally win over the safe defaults, matching Zed.
        for variable in request.env {
            command.env(variable.name, variable.value);
        }
        let mut child = command
            .spawn()
            .map_err(|_| Error::internal_error().data("the terminal command could not start"))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let output = OutputBuffer::new(output_limit);
        let stdout_task = stdout.map(|stdout| tokio::spawn(drain_output(stdout, output.clone())));
        let stderr_task = stderr.map(|stderr| tokio::spawn(drain_output(stderr, output.clone())));
        let (kill_tx, mut kill_rx) = mpsc::channel(1);
        let (exit_tx, exit_rx) = watch::channel(None);
        tokio::spawn(async move {
            let status = tokio::select! {
                status = child.wait() => status.ok(),
                _ = kill_rx.recv() => {
                    let _ = child.kill().await;
                    child.wait().await.ok()
                }
            };
            // EOF follows process exit, but reader tasks may need another poll to
            // drain the final pipe bytes. Publish the exit only after both are
            // done, so wait_for_exit followed by output cannot race to an empty
            // result.
            if let Some(task) = stdout_task { let _ = task.await; }
            if let Some(task) = stderr_task { let _ = task.await; }
            let _ = exit_tx.send(Some(ExitSnapshot {
                code: status
                    .and_then(|status| status.code())
                    .and_then(|code| u32::try_from(code).ok()),
            }));
        });
        Ok(Self {
            output,
            kill: kill_tx,
            exit: exit_rx,
        })
    }
}

async fn drain_output(mut reader: impl tokio::io::AsyncRead + Unpin, output: OutputBuffer) {
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(count) => output.append(&chunk[..count]),
        }
    }
}

#[derive(Clone)]
struct OutputBuffer {
    inner: Arc<Mutex<OutputState>>,
    limit: usize,
}

#[derive(Default)]
struct OutputState {
    bytes: Vec<u8>,
    original_bytes: usize,
}

impl OutputBuffer {
    fn new(limit: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(OutputState::default())),
            limit,
        }
    }

    fn append(&self, bytes: &[u8]) {
        let mut state = self.inner.lock().expect("terminal output");
        state.original_bytes = state.original_bytes.saturating_add(bytes.len());
        let remaining = self.limit.saturating_sub(state.bytes.len());
        state
            .bytes
            .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
    }

    fn snapshot(&self) -> (String, bool) {
        let state = self.inner.lock().expect("terminal output");
        truncate_output(&state.bytes, self.limit, state.original_bytes)
    }
}

/// Return valid UTF-8, never cutting a partial final line when truncation occurs.
fn truncate_output(bytes: &[u8], limit: usize, original_bytes: usize) -> (String, bool) {
    let mut end = bytes.len().min(limit);
    let text = loop {
        match std::str::from_utf8(&bytes[..end]) {
            Ok(text) => break text,
            Err(error) if error.error_len().is_none() => end = error.valid_up_to(),
            // Invalid bytes inside the retained region are replaced; an Agent
            // should still be able to inspect the rest of the terminal output.
            Err(_) => break "",
        }
    };
    let truncated = original_bytes > end;
    let output = if truncated {
        let boundary = text.rfind('\n').unwrap_or(text.len());
        text[..boundary].to_owned()
    } else {
        text.to_owned()
    };
    (output, truncated)
}

#[derive(Debug, Clone)]
struct ExitSnapshot {
    code: Option<u32>,
}

impl ExitSnapshot {
    fn to_acp(&self) -> TerminalExitStatus {
        TerminalExitStatus::new().exit_code(self.code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_selection_is_one_based_and_bounded_by_count() {
        let text = "one\ntwo\nthree\n";
        assert_eq!(select_lines(text, None, Some(2)).unwrap(), "one\ntwo\n");
        assert_eq!(select_lines(text, Some(0), Some(1)).unwrap(), "one\n");
        assert_eq!(select_lines(text, Some(1), Some(1)).unwrap(), "one\n");
        assert_eq!(select_lines(text, Some(2), Some(1)).unwrap(), "two\n");
        assert!(select_lines(text, Some(5), None).is_err());
    }

    #[test]
    fn terminal_output_truncates_at_a_utf8_and_line_boundary() {
        let text = "first\n你好世界\nthird\n";
        let (output, truncated) = truncate_output(text.as_bytes(), 12, text.len());
        assert!(truncated);
        assert_eq!(output, "first");
        assert!(!output.contains('�'));
    }

    #[test]
    fn terminal_output_without_a_newline_keeps_the_valid_prefix() {
        let text = "你好世界";
        let (output, truncated) = truncate_output(text.as_bytes(), 7, text.len());
        assert!(truncated);
        assert_eq!(output, "你好");
    }

    #[test]
    fn complete_terminal_output_is_not_marked_truncated() {
        let (output, truncated) = truncate_output(b"done\n", 1024, 5);
        assert_eq!(output, "done\n");
        assert!(!truncated);
    }
}
