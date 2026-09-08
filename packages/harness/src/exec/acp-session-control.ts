/** Controls are valid only while the executor owns this live session. */
export interface AcpSessionControl {
  sessionId: string;
  setConfigOption(configId: string, value: string | boolean): Promise<unknown>;
  setMode(modeId: string): Promise<unknown>;
}
export type AcpSessionReadyHandler = (control: AcpSessionControl | undefined) => void | Promise<void>;

export interface AcpSessionRecovery { sessionId: string; method?: "load" | "resume" }
