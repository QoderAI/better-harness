import { describe, it, expect } from "vitest";
import { AcpConversation, type AcpConversationDriver, type AcpConversationSnapshot, type AcpOptionalAction } from "../src/exec/acp-conversation.js";
const content = (text: string) => [{ type: "text" as const, text }];
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture() {
  const requests: Array<{ content: unknown; result: ReturnType<typeof deferred<{ stopReason: string }>> }> = [];
  const snapshots: AcpConversationSnapshot[] = [], saved: unknown[] = [];
  let cancels = 0;
  const driver: AcpConversationDriver = { sessionId: "same-session", capabilities: { image: false, audio: false, embeddedContext: false, actions: [] },
    setMode: async () => ({}), setConfigOption: async () => ({}),
    prompt: async value => { const result = deferred<{ stopReason: string }>(); requests.push({ content: value, result }); return result.promise; },
    cancel: async () => { cancels++; requests.at(-1)?.result.resolve({ stopReason: "cancelled" }); },
  };
  const conversation = new AcpConversation({ onChange: state => snapshots.push(state), onTurnComplete: turn => { saved.push(turn); }, idleTimeoutMs: 1_000 });
  const run = () => conversation.run(driver, { id: "initial", content: content("first") }, content("preamble\nfirst"));
  return { conversation, driver, requests, snapshots, saved, run, cancels: () => cancels };
}
const flush = async () => { for (let i=0;i<10;i++) await Promise.resolve(); };
describe("ACP conversation acceptance", () => {
  it("AC-01/13: keeps three turns on one session with one preamble and saves each before the next", async () => {
    const f = fixture(); const completed = f.run();
    for (let index=0;index<3;index++) {
      if(index) await f.conversation.submit({ id: `follow-${index}`, content: content(`turn-${index}`) });
      await flush(); expect(f.requests).toHaveLength(index+1);
      expect(f.requests[index]!.content).toEqual(content(index ? `turn-${index}` : "preamble\nfirst"));
      f.requests[index]!.result.resolve({ stopReason: "end_turn" }); await flush();
      expect(f.saved).toHaveLength(index+1); expect(f.conversation.snapshot().status).toBe("idle");
    }
    expect(f.conversation.snapshot().turns.map(turn=>turn.turnId)).toEqual(["same-session:1","same-session:2","same-session:3"]);
    await f.conversation.close(); await completed;
  });
  it("AC-03/04: queues while generating, pauses on stop, and resumes explicitly", async () => {
    const f=fixture(); const completed=f.run();
    await f.conversation.submit({ id:"next", content:content("queued") }); expect(f.requests).toHaveLength(1);
    await f.conversation.stop(); await flush();
    expect(f.conversation.snapshot()).toMatchObject({ status:"idle", queuePaused:true, queue:[{ id:"next" }] });
    f.conversation.resumeQueue(); await flush(); expect(f.requests).toHaveLength(2);
    await f.conversation.close(); await completed; expect(f.cancels()).toBe(2);
  });
  it("AC-03/05: send now waits for cancel completion and goes before queued input", async () => {
    const f=fixture(); const completed=f.run(); await f.conversation.submit({id:"later",content:content("later")});
    const ack=deferred<void>(); f.driver.cancel=async()=>{ await ack.promise; f.requests[0]!.result.resolve({stopReason:"cancelled"}); };
    const immediate=f.conversation.submit({id:"now",content:content("now")},true);
    await flush(); expect(f.requests).toHaveLength(1); ack.resolve(); await immediate; await flush(); expect(f.requests[1]!.content).toEqual(content("now"));
    f.requests[1]!.result.resolve({stopReason:"end_turn"}); await flush(); expect(f.requests[2]!.content).toEqual(content("later"));
    f.driver.cancel=async()=>{f.requests.at(-1)!.result.resolve({stopReason:"cancelled"});}; await f.conversation.close(); await completed;
  });
  it("AC-02: lane queues and close are independent", async()=>{
    const a=fixture(),b=fixture(); const ar=a.run(),br=b.run(); await a.conversation.submit({id:"a",content:content("only a")});
    expect(b.conversation.snapshot().queue).toEqual([]); await a.conversation.close(); await ar;
    expect(b.conversation.snapshot().status).toBe("generating"); await b.conversation.close(); await br;
  });
  it("retries submissions idempotently and rejects conflicting ids",async()=>{
    const f=fixture();const completed=f.run(); await f.conversation.submit({id:"same",content:content("once")}); await f.conversation.submit({id:"same",content:content("once")});
    expect(f.conversation.snapshot().queue).toHaveLength(1);
    await expect(f.conversation.submit({id:"same",content:content("twice")})).rejects.toThrow("different content"); await f.conversation.close();await completed;
  });
  it("edits and removes only queued entries",async()=>{
    const f=fixture();const completed=f.run(); await f.conversation.submit({id:"q",content:content("original")});
    f.conversation.editQueued({id:"q",content:content("edited")}); expect(f.conversation.snapshot().queue[0]!.content).toEqual(content("edited"));
    f.conversation.removeQueued("q");expect(()=>f.conversation.editQueued({id:"q",content:content("late")})).toThrow(); await f.conversation.close();await completed;
  });
  it("AC-09/10: media is capability gated before wire submission",async()=>{
    const f=fixture();const completed=f.run(); const image={type:"image" as const,mimeType:"image/png",data:"aGVsbG8="};
    await expect(f.conversation.submit({id:"img",content:[image]})).rejects.toThrow("does not support");expect(f.requests).toHaveLength(1);
    f.driver.capabilities.image=true; await f.conversation.submit({id:"img",content:[image]});expect(f.conversation.snapshot().queue[0]!.content).toEqual([image]); await f.conversation.close();await completed;
  });
  it.each<AcpOptionalAction>(["retry","rewind","checkpoint","resume","load","list","authenticate","elicitation","steer"])("AC-09/14: %s needs declaration and implementation", async action=>{
    const f=fixture();const completed=f.run(); await expect(f.conversation.perform(action,{})).rejects.toThrow("does not support");
    f.driver.capabilities.actions.push(action);await expect(f.conversation.perform(action,{})).rejects.toThrow("does not support");
    f.driver.optional={ [action]:async input=>({ action, input }) };expect(await f.conversation.perform(action,{id:"specific"})).toEqual({action,input:{id:"specific"}}); await f.conversation.close();await completed;
  });
  it("failed turns remain inspectable and pause dispatch",async()=>{
    const f=fixture();const completed=f.run();f.requests[0]!.result.reject(new Error("Connection result unknown"));await flush();
    expect(f.conversation.snapshot()).toMatchObject({status:"idle",queuePaused:true,turns:[{stopReason:"error",error:"Connection result unknown"}]});
    expect(f.saved).toHaveLength(1);await f.conversation.close();await completed;
  });
});

it("a non-responsive Agent cannot prevent explicit close from releasing its owner", async () => {
  const conversation = new AcpConversation({ onChange() {}, cancellationTimeoutMs: 10 });
  const driver: AcpConversationDriver = { sessionId: "stuck", capabilities: { image: false, audio: false, embeddedContext: false, actions: [] }, setConfigOption: async () => ({}), setMode: async () => ({}), cancel: async () => {}, prompt: () => new Promise(() => {}) };
  const running = conversation.run(driver, { id: "first", content: content("hello") }, content("hello"));
  await expect(conversation.stop()).rejects.toThrow("did not acknowledge");
  await conversation.close(); await running;
  expect(conversation.snapshot()).toMatchObject({ status: "closed", turns: [{ stopReason: "error", error: "Session closed before the Agent acknowledged cancellation." }] });
});


it("rejects malformed, empty and oversized submissions without changing the queue", async () => {
  const f = fixture(); const running = f.run();
  for (const invalid of [[], [null], [{ type: "text", text: "   " }], [{ type: "text", text: 4 }], [{ type: "resource", resource: { uri: "attachment:///bad", text: 4 } }], [{ type: "text", text: "x".repeat(4 * 1024 * 1024 + 1) }]]) {
    await expect(f.conversation.submit({ id: "invalid", content: invalid as never })).rejects.toThrow();
    expect(f.conversation.snapshot().queue).toEqual([]);
  }
  await f.conversation.close(); await running;
});
