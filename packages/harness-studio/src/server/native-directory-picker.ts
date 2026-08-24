import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class DirectoryPickerUnavailableError extends Error {}

/**
 * Opens the host operating system's directory chooser without invoking a
 * shell. A browser file input cannot reveal the absolute path that Inspector's
 * workspace-scoped provider matching requires.
 */
export async function pickLocalWorkspaceDirectory(platform = process.platform): Promise<string | undefined> {
  if (platform === "darwin") {
    return runPicker("/usr/bin/osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Open a project workspace in Harness Studio")',
    ]);
  }
  if (platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Open a project workspace in Harness Studio'",
      "$dialog.ShowNewFolderButton = $false",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
    ].join("; ");
    return runPicker("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", script]);
  }
  if (platform === "linux") {
    for (const candidate of [
      { command: "/usr/bin/zenity", args: ["--file-selection", "--directory", "--title=Open a project workspace in Harness Studio"] },
      { command: "/usr/bin/kdialog", args: ["--getexistingdirectory", ".", "--title", "Open a project workspace in Harness Studio"] },
    ]) {
      if (await access(candidate.command).then(() => true).catch(() => false)) {
        return runPicker(candidate.command, candidate.args);
      }
    }
    throw new DirectoryPickerUnavailableError("No supported native directory chooser is installed (expected zenity or kdialog).");
  }
  throw new DirectoryPickerUnavailableError(`Native directory selection is unavailable on '${platform}'.`);
}

async function runPicker(command: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      windowsHide: false,
      maxBuffer: 16 * 1024,
    });
    const selected = stdout.trim();
    return selected === "" ? undefined : selected;
  } catch (error) {
    const exitCode = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (exitCode === 1 || exitCode === 130) return undefined;
    throw new DirectoryPickerUnavailableError("The operating system directory chooser could not be opened.");
  }
}
