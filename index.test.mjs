import { afterEach, expect, test } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenDesignAuthPlugin, _internal as i } from "./index.mjs"

const a = { type: "api", key: "runtime-test-secret", metadata: { controlKey: "control-test-secret" } }
const cfg = { profiles: { prod: { controlKey: a.metadata.controlKey, runtimeKey: a.key, user: { email: "test@example.com", id: "test-user" } } } }
const summary = {
  membershipTier: "go", subscriptionStatus: "active", subscriptionCancelAtPeriodEnd: false,
  subscriptionCurrentPeriodEnd: "2026-11-01T00:00:00Z",
  creditsPerUsd: 10000,
  balances: { subscriptionCredits: "25000", rechargeCredits: "0" },
}
const fixture = {
  schemaVersion: 1, workspaceId: "workspace-test",
  codingPlan: { eligible: true, tier: "go", windows: [
    { durationSeconds: 18000, usedCredits: "0", limitCredits: "50000", remainingCredits: "50000", resetsAt: "2026-10-05T15:36:43Z" },
    { durationSeconds: 604800, usedCredits: "150445", limitCredits: "150000", remainingCredits: "0", resetsAt: "2026-10-07T10:36:43Z" },
  ] },
}
const temps = []
const realFetch = globalThis.fetch
afterEach(async () => {
  globalThis.fetch = realFetch
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})
const response = (b, status = 200) => new Response(JSON.stringify(b), { status })
const accountFetch = async (url) => response(url.endsWith("/wallet/balance") ? { balanceUsd: "0.0000" } : summary)
async function configPath(value = cfg) {
  const dir = await mkdtemp(join(tmpdir(), "magpie-opendesign-")); temps.push(dir)
  const path = join(dir, "config.json")
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value))
  return path
}

test("one exported plugin supplies all Magpie hooks and preserves user configuration", async () => {
  const hooks = await OpenDesignAuthPlugin({})
  expect(hooks.auth.provider).toBe("opendesign")
  const cfg = {}; await hooks.config(cfg)
  expect(cfg.provider.opendesign.npm).toBe("@ai-sdk/openai-compatible")
  cfg.provider.opendesign = { name: "custom" }; await hooks.config(cfg)
  expect(cfg.provider.opendesign).toEqual({ name: "custom" })
})

test("imports prod keys without mutating the local file or making a request", async () => {
  const path = await configPath()
  globalThis.fetch = () => { throw new Error("must not call network") }
  const hooks = await OpenDesignAuthPlugin({}, { configPath: path })
  const flow = await hooks.auth.methods[0].authorize({ workspaceId: "workspace-test" })
  expect(flow.url).toBe("")
  const saved = await flow.callback()
  expect(saved).toEqual({ type: "success", key: a.key, metadata: { ...a.metadata, email: "test@example.com", uid: "test-user", workspaceId: "workspace-test" } })
  expect(await i.readProfile(path)).toEqual({ controlKey: a.metadata.controlKey, runtimeKey: a.key, email: "test@example.com", uid: "test-user" })
})

test("missing, malformed and incomplete local sign-ins fail without leaking content", async () => {
  for (const path of [join(tmpdir(), "missing-opendesign-config"), await configPath('bad ' + a.key), await configPath({ profiles: { prod: { runtimeKey: a.key } } })]) {
    const hooks = await OpenDesignAuthPlugin({}, { configPath: path })
    const result = await (await hooks.auth.methods[0].authorize()).callback()
    expect(result.type).toBe("failed")
    expect(result.error).not.toContain(a.key)
  }
})

test("model discovery uses only runtimeKey and maps the live AMR metadata", async () => {
  const seen = []
  const list = await i.models(a, async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization, redirect: init.redirect })
    return response({ data: [
      { id: "vision-model", enabled: true, metadata: { context_limit: 1048000, context_budget: 232000 }, architecture: { input_modalities: ["text", "image", "video"] } },
      { id: "disabled", enabled: false }, { id: null },
    ] })
  })
  expect(seen).toEqual([{ url: "https://amr-link.open-design.ai/v1/models", auth: `Bearer ${a.key}`, redirect: "error" }])
  expect(Object.keys(list)).toEqual(["vision-model"])
  expect(list["vision-model"].limit).toEqual({ context: 1048000, output: 0 })
  expect(list["vision-model"].api.npm).toBe("@ai-sdk/openai-compatible")
  expect(list["vision-model"].capabilities.input).toMatchObject({ image: true, video: true })
})

test("model list failure throws for Magpie to preserve its cached list; only runtime 401 expires the sign-in", async () => {
  for (const body of [{ data: [] }, {}, { data: [{ enabled: false, id: "none" }] }, { error: a.key }])
    await expect(i.models(a, async () => response(body))).rejects.toThrow()
  try { await i.models(a, async () => response({ error: a.key }, 401)) }
  catch (e) { expect(e.signIn).toBe("expired"); expect(e.message).not.toContain(a.key) }
})

test("balances never become fake 100%-remaining windows; a missing workspace is explicit", async () => {
  const seen = []
  const result = await i.usage(a, {}, { fetchImpl: async (url, init) => {
    seen.push(init.headers.Authorization); return accountFetch(url)
  } })
  expect(seen).toEqual([`Bearer ${a.metadata.controlKey}`, `Bearer ${a.metadata.controlKey}`])
  expect(result.balance).toBe("$0.00")
  expect(result.plan).toBe("go (active)")
  expect(result.renew).toBe("auto")
  expect(result.until).toBe("2026-11-01T00:00:00.000Z")
  expect(result.windows).toBeUndefined()
  expect(result.error).toContain("Coding Plan not queried")
})

test("Coding Plan fixture from the live CLI preserves overspending, remaining and reset times", () => {
  const ws = i.planWindows(fixture, summary.creditsPerUsd)
  expect(ws[0]).toEqual({ name: "5 hours", used: 0, span: 18000, resetsAt: "2026-10-05T15:36:43.000Z", display: "$0.00 / $5.00 · $5.00 remaining" })
  expect(ws[1].name).toBe("7 days")
  expect(ws[1].used).toBeGreaterThan(100)
  expect(ws[1].display).toBe("$15.0445 / $15.00 · $0.00 remaining")
})

test("USD conversion uses the vendor's current rate, including fractional credit amounts", () => {
  const ws = i.planWindows(fixture, "20000")
  expect(ws[0].display).toBe("$0.00 / $2.50 · $2.50 remaining")
  expect(ws[1].display).toBe("$7.5223 / $7.50 · $0.00 remaining")
  expect(ws[1].used).toBe(i.planWindows(fixture, 10000)[1].used)
  expect(i.usd(0.0001)).toBe("$0.0001")
})

test("missing or invalid exchange rates never produce invented dollar windows", async () => {
  for (const rate of [undefined, null, "", false, 0, -1, "invalid"]) {
    const result = await i.usage(a, { workspaceId: "workspace-test" }, {
      fetchImpl: async (url) => response(url.endsWith("/wallet/balance") ? { balanceUsd: "1.2345" } : { ...summary, creditsPerUsd: rate }),
      readProfileImpl: async () => ({ controlKey: a.metadata.controlKey, runtimeKey: a.key }),
      preflightImpl: async () => fixture,
    })
    expect(result.balance).toBe("$1.2345")
    expect(result.windows).toBeUndefined()
    expect(result.error).toContain("USD conversion unavailable")
  }
})

test("preflight runs the CLI with separate arguments and a timeout, never a shell", async () => {
  const id = "workspace;$(literal)"
  const result = await i.preflight(id, { velaPath: "custom vela.exe" }, async (bin, args, options) => {
    expect(bin).toBe("custom vela.exe")
    expect(args).toEqual(["billing", "preflight", "--workspace-id", id, "--format", "json"])
    expect(options.timeout).toBe(20000)
    expect(options.windowsHide).toBe(true)
    expect(options.shell).toBeUndefined()
    return { stdout: JSON.stringify({ ...fixture, workspaceId: id }) }
  })
  expect(result.codingPlan.windows).toHaveLength(2)
})

test("CLI failure, invalid JSON, wrong workspace and missing fields never yield zero windows", async () => {
  const execute = (out) => i.preflight("workspace-test", { velaPath: "mock" }, async () => ({ stdout: out }))
  await expect(execute(a.key)).rejects.toThrow("invalid Vela")
  await expect(execute(JSON.stringify({ ...fixture, workspaceId: "other" }))).rejects.toThrow("different workspace")
  await expect(execute(JSON.stringify({ codingPlan: {} , workspaceId: "workspace-test" }))).rejects.toThrow("invalid Coding Plan")
  try { await i.preflight("workspace-test", { velaPath: "mock" }, async () => { throw new Error(a.key + a.metadata.controlKey) }) }
  catch (e) { expect(e.message).not.toContain(a.key); expect(e.message).not.toContain(a.metadata.controlKey) }
  for (const value of [null, "", false, "bad", -1]) {
    const b = structuredClone(fixture); b.codingPlan.windows[0].usedCredits = value
    expect(() => i.planWindows(b, summary.creditsPerUsd)).toThrow("incomplete")
  }
})

test("account scope must still match local prod before invoking the CLI", async () => {
  let calls = 0
  const options = { workspaceId: "workspace-test" }
  const deps = { fetchImpl: accountFetch, readProfileImpl: async () => ({ controlKey: a.metadata.controlKey, runtimeKey: a.key }), preflightImpl: async () => { calls++; return fixture } }
  const result = await i.usage(a, options, deps)
  expect(calls).toBe(1); expect(result.windows).toHaveLength(2)
  expect(result.error).toBeUndefined()
  expect(result.windows.map(w => Math.max(0, 100 - w.used))).toEqual([100, 0])
  expect(result.windows.every(w => Number.isFinite(w.used) && !w.aside)).toBe(true)
  const changed = await i.usage(a, options, { ...deps, readProfileImpl: async () => ({ controlKey: "different", runtimeKey: a.key }) })
  expect(calls).toBe(1); expect(changed.error).toContain("local prod account changed")
  expect(changed.balance).toBe("$0.00")
})

test("wallet failure preserves successful billing and CLI data and does not expire inference auth", async () => {
  const result = await i.usage(a, { workspaceId: "workspace-test" }, {
    fetchImpl: async (url) => url.endsWith("/wallet/balance") ? response({ error: a.metadata.controlKey }, 401) : response(summary),
    readProfileImpl: async () => ({ controlKey: a.metadata.controlKey, runtimeKey: a.key }),
    preflightImpl: async () => fixture,
  })
  expect(result.balance).toBeUndefined(); expect(result.plan).toBe("go (active)")
  expect(result.windows).toHaveLength(2)
  expect(result.error).toContain("HTTP 401"); expect(result.signIn).toBe("kept")
  expect(JSON.stringify(result)).not.toContain(a.metadata.controlKey)
})

test("billing, network and malformed data failures have no fabricated balances or credit windows", async () => {
  for (const f of [async () => response({}, 503), async () => new Response("bad JSON " + a.key), async () => { throw new Error(a.key) }, async () => response({ balanceUsd: null, balances: { subscriptionCredits: false, rechargeCredits: "" } })]) {
    const result = await i.usage(a, {}, { fetchImpl: f })
    expect(result.error).toBeTruthy(); expect(result.balance).toBeUndefined()
    expect(result.windows).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain(a.key)
  }
})

test("numeric and timestamp conversion handles strings and keeps missing values unknown", () => {
  for (const v of [null, undefined, "", " ", false, {}, "bad", Infinity]) expect(i.number(v)).toBeUndefined()
  expect(i.number("0.0000")).toBe(0)
  expect(i.time(1791200000)).toBe(i.time(1791200000000))
  expect(i.time(null)).toBeUndefined(); expect(i.time(1e100)).toBeUndefined()
})

test("inference preserves body, tools and stream, replaces authorization and uses the current account", async () => {
  const body = JSON.stringify({ model: "vision-model", messages: [{ role: "user", content: "Hi" }], stream: true, tools: [{ type: "function", function: { name: "ping", parameters: { type: "object" } } }] })
  const aborted = new AbortController()
  const sse = new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })
  const res = await i.inference(async () => ({ ...a, key: "rotated-runtime" }), "https://amr-link.open-design.ai/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer wrong", "x-api-key": a.metadata.controlKey, "content-type": "application/json" }, body, signal: aborted.signal }, async (request) => {
    expect(request.headers.get("authorization")).toBe("Bearer rotated-runtime")
    expect(request.headers.has("x-api-key")).toBe(false)
    expect(request.redirect).toBe("error")
    expect(await request.text()).toBe(body)
    aborted.abort(); expect(request.signal.aborted).toBe(true)
    return sse
  })
  expect(res).toBe(sse); expect(await res.text()).toContain("[DONE]")
})

test("nonstream inference also accepts Request inputs", async () => {
  const req = new Request("https://amr-link.open-design.ai/v1/chat/completions", { method: "POST", body: '{"stream":false}' })
  const res = await i.inference(async () => a, req, undefined, async (r) => {
    expect(await r.text()).toBe('{"stream":false}'); return response({ choices: [{ message: { content: "ok" } }] })
  })
  expect((await res.json()).choices[0].message.content).toBe("ok")
})

test("inference refuses other origins and protocols before sending credentials", async () => {
  for (const url of ["https://example.com/v1/chat/completions", "https://amr-link.open-design.ai/v1/responses", "https://amr-api.open-design.ai/api/v1/wallet/balance"])
    await expect(i.inference(async () => a, url, {}, async () => { throw new Error("must never fetch") })).rejects.toThrow("unsupported")
})

test("upstream failures preserve HTTP status but redact reflected keys from errors and headers", async () => {
  const result = await i.inference(async () => a, "https://amr-link.open-design.ai/v1/chat/completions", {}, async () => new Response(JSON.stringify({ error: { message: `${a.key} ${a.metadata.controlKey} Bearer other-token` } }), { status: 401, headers: { "x-debug": a.key, "content-length": "999" } }))
  expect(result.status).toBe(401); expect(result.headers.has("content-length")).toBe(false)
  expect(result.headers.get("x-debug")).toBe("[REDACTED]")
  const text = await result.text(); expect(text).not.toContain(a.key); expect(text).not.toContain(a.metadata.controlKey)
  await expect(i.inference(async () => a, "https://amr-link.open-design.ai/v1/chat/completions", {}, async () => { throw new Error(a.key) })).rejects.toThrow("inference request failed")
})

test("an upstream funding refusal is preserved without declaring the runtime sign-in expired", async () => {
  const res = await i.inference(async () => a, "https://amr-link.open-design.ai/v1/chat/completions", {}, async () => response({ error: { message: "Insufficient funding", type: "billing_error" } }, 402))
  expect(res.status).toBe(402)
  expect(res.headers.get("x-magpie-sign-in")).toBeNull()
  expect((await res.json()).error.message).toBe("Insufficient funding")
})
