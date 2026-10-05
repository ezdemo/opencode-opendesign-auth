// OpenDesign's AMR prod keys, imported read-only from its local sign-in.
// Control-plane keys never go to the inference API. No secrets or upstream
// error bodies are logged. Only actual Coding Plan limits become quota windows.
import { readFile, access } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const ID = "opendesign"
// Official website artwork: https://open-design.ai/apple-touch-icon.png
const ICON = "data:image/png;base64,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"
const API = "https://amr-api.open-design.ai/api/v1"
const BASE = "https://amr-link.open-design.ai/v1"
const NPM = "@ai-sdk/openai-compatible"
const exec = promisify(execFile)
const firstString = (...vs) => vs.find((v) => typeof v === "string" && v.trim())?.trim() ?? ""
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

// Number(null), Number("") and Number(false) must never turn unknown into zero.
function number(v) {
  if (typeof v !== "number" && !(typeof v === "string" && v.trim())) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false,
})
const usd = (n) => usdFormat.format(n)

function time(v) {
  const n = number(v)
  const t = n === undefined ? (typeof v === "string" ? Date.parse(v) : NaN) : n * (n < 1e12 ? 1000 : 1)
  return Number.isFinite(t) && Math.abs(t) <= 8.64e15 ? new Date(t).toISOString() : undefined
}

async function readProfile(path = join(homedir(), ".amr", "config.json")) {
  let cfg
  try { cfg = JSON.parse(await readFile(path, "utf8")) }
  catch { throw new Error("OpenDesign: cannot read ~/.amr/config.json; sign in to OpenDesign first (or set configPath)") }
  const p = cfg?.profiles?.prod
  if (!firstString(p?.controlKey) || !firstString(p?.runtimeKey))
    throw new Error("OpenDesign: profiles.prod must contain controlKey and runtimeKey")
  return {
    controlKey: p.controlKey.trim(), runtimeKey: p.runtimeKey.trim(),
    email: firstString(p.user?.email), uid: firstString(p.user?.id),
  }
}

function credentials(a) {
  if (a?.type !== "api" || !firstString(a.key) || !firstString(a.metadata?.controlKey))
    throw new Error("OpenDesign: import the local prod sign-in again")
  return { runtimeKey: a.key, controlKey: a.metadata.controlKey }
}

async function json(url, key, label, fetchImpl = fetch, runtime = false) {
  let res
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    })
  } catch { throw new Error(`OpenDesign: ${label} request failed`) }
  if (!res.ok) {
    const e = new Error(`OpenDesign: ${label} request failed (HTTP ${res.status})`)
    if (runtime && res.status === 401) e.signIn = "expired"
    throw e
  }
  let b
  try { b = await res.json() } catch { throw new Error(`OpenDesign: invalid ${label} JSON`) }
  if (!object(b) || b.error || b.success === false) throw new Error(`OpenDesign: invalid ${label} response`)
  // Account endpoints currently return direct objects; also accept a data envelope.
  return object(b.data) ? b.data : b
}

function runtimeModel(m) {
  const inputs = m.architecture?.input_modalities ?? m.modalities?.input
  const input = { text: true, audio: false, video: false, pdf: false }
  if (Array.isArray(inputs)) {
    input.image = inputs.includes("image")
    input.audio = inputs.includes("audio")
    input.video = inputs.includes("video")
    input.pdf = inputs.includes("pdf")
  }
  return {
    id: m.id, providerID: ID, name: firstString(m.name, m.display_name, m.id),
    api: { id: m.id, url: BASE, npm: NPM }, status: "active",
    headers: {}, options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: Math.max(0, number(m.metadata?.context_limit ?? m.context_length) ?? 0), output: 0 },
    capabilities: {
      temperature: true, reasoning: false, toolcall: true,
      attachment: !!(input.image || input.audio || input.video || input.pdf), input,
      output: { text: true, image: false, audio: false, video: false, pdf: false }, interleaved: false,
    }, release_date: "", variants: {},
  }
}

async function models(a, fetchImpl = fetch) {
  const { runtimeKey } = credentials(a)
  const b = await json(BASE + "/models", runtimeKey, "models", fetchImpl, true)
  if (!Array.isArray(b.data)) throw new Error("OpenDesign: invalid model list")
  const rows = b.data.filter((m) => firstString(m?.id) && m.enabled !== false)
  if (!rows.length) throw new Error("OpenDesign: no enabled models listed")
  return Object.fromEntries(rows.map((m) => [m.id, runtimeModel(m)]))
}

function planWindows(b, creditsPerUsd) {
  const cp = b?.codingPlan
  if (!object(cp) || !Array.isArray(cp.windows)) throw new Error("OpenDesign: invalid Coding Plan response")
  if (!cp.windows.length) {
    if (cp.eligible === false) return []
    throw new Error("OpenDesign: Coding Plan windows unavailable")
  }
  const rate = number(creditsPerUsd)
  if (!(rate > 0)) throw new Error("OpenDesign: Coding Plan USD conversion unavailable (creditsPerUsd missing or invalid)")
  return cp.windows.map((w) => {
    const used = number(w.usedCredits), limit = number(w.limitCredits), remaining = number(w.remainingCredits)
    const duration = number(w.durationSeconds), resetsAt = time(w.resetsAt)
    if (used === undefined || used < 0 || limit === undefined || limit <= 0 || remaining === undefined || remaining < 0 || !resetsAt || !(duration > 0))
      throw new Error("OpenDesign: incomplete Coding Plan window")
    const name = duration % 86400 === 0 ? `${duration / 86400} days` : duration % 3600 === 0 ? `${duration / 3600} hours` : `${duration} seconds`
    return {
      name, used: used / limit * 100, span: duration, resetsAt,
      display: `${usd(used / rate)} / ${usd(limit / rate)} · ${usd(remaining / rate)} remaining`,
    }
  })
}

async function velaPath(options) {
  if (firstString(options.velaPath)) return options.velaPath
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const bundled = join(process.env.LOCALAPPDATA, "Programs", "Open Design", "resources", "open-design", "bin", "vela.exe")
    try { await access(bundled); return bundled } catch {}
  }
  return process.platform === "win32" ? "vela.exe" : "vela"
}

async function preflight(workspaceId, options = {}, execImpl = exec) {
  const bin = await velaPath(options)
  let stdout
  try {
    ;({ stdout } = await execImpl(bin, ["billing", "preflight", "--workspace-id", workspaceId, "--format", "json"], {
      timeout: 20_000, maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true,
    }))
  } catch {
    // child_process errors embed stdout/stderr and command arguments. Never
    // propagate them: a CLI failure may include its authentication material.
    throw new Error("OpenDesign: Coding Plan query failed; check workspaceId and the signed-in Vela CLI (or set velaPath)")
  }
  let b
  try { b = JSON.parse(stdout) } catch { throw new Error("OpenDesign: invalid Vela preflight JSON") }
  if (b?.workspaceId !== workspaceId) throw new Error("OpenDesign: Vela returned a different workspace")
  if (!object(b.codingPlan) || !Array.isArray(b.codingPlan.windows)) throw new Error("OpenDesign: invalid Coding Plan response")
  return b
}

async function usage(a, options = {}, { fetchImpl = fetch, preflightImpl = preflight, readProfileImpl = readProfile } = {}) {
  const { controlKey, runtimeKey } = credentials(a)
  const out = { signIn: "kept" }, errors = [], windows = []
  const workspaceId = firstString(a.metadata?.workspaceId, options.workspaceId, process.env.OPENDESIGN_WORKSPACE_ID)
  const tasks = [
    json(API + "/wallet/balance", controlKey, "wallet", fetchImpl),
    json(API + "/billing/summary", controlKey, "billing", fetchImpl),
  ]
  if (workspaceId) tasks.push((async () => {
    // Vela uses the current local sign-in, not Magpie's saved account. Verify
    // it still matches before attributing its windows to that saved account.
    const local = await readProfileImpl(options.configPath)
    if (local.controlKey !== controlKey || local.runtimeKey !== runtimeKey)
      throw new Error("OpenDesign: local prod account changed; import it again before querying Coding Plan")
    return preflightImpl(workspaceId, options)
  })())
  const results = await Promise.allSettled(tasks)
  const [wallet, billing, coding] = results
  if (wallet.status === "fulfilled") {
    const n = number(wallet.value.balanceUsd)
    if (n === undefined) errors.push("OpenDesign: wallet balance unavailable")
    else out.balance = usd(n)
  } else errors.push(wallet.reason.message)
  if (billing.status === "fulfilled") {
    const b = billing.value, tier = firstString(b.membershipTier), status = firstString(b.subscriptionStatus)
    if (tier) out.plan = status ? `${tier} (${status})` : tier
    else errors.push("OpenDesign: membership tier unavailable")
    if (!status) errors.push("OpenDesign: subscription status unavailable")
    const until = time(b.subscriptionCurrentPeriodEnd)
    if (until) out.until = until
    if (typeof b.subscriptionCancelAtPeriodEnd === "boolean") out.renew = b.subscriptionCancelAtPeriodEnd ? "off" : "auto"
  } else errors.push(billing.reason.message)
  if (coding?.status === "fulfilled") {
    try { windows.push(...planWindows(coding.value, billing.status === "fulfilled" ? billing.value.creditsPerUsd : undefined)) }
    catch (e) { errors.push(e.message) }
  }
  else if (coding) errors.push(coding.reason.message)
  else errors.push("OpenDesign: Coding Plan not queried; set workspaceId in plugin options or import the sign-in with a workspace ID")
  if (windows.length) out.windows = windows
  if (errors.length) out.error = errors.join("; ")
  return out
}

function redact(text, keys) {
  for (const key of keys.filter(Boolean)) text = text.split(key).join("[REDACTED]")
  return text.replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [REDACTED]")
}

async function inference(getAuth, input, init, fetchImpl = fetch) {
  const { runtimeKey, controlKey } = credentials(await getAuth())
  let request
  try { request = new Request(input, init) } catch { throw new Error("OpenDesign: invalid inference request") }
  const url = new URL(request.url)
  if (url.origin !== new URL(BASE).origin || !["/v1/chat/completions", "/v1/models"].includes(url.pathname))
    throw new Error("OpenDesign: unsupported inference endpoint")
  const headers = new Headers(request.headers)
  headers.set("Authorization", `Bearer ${runtimeKey}`)
  headers.delete("x-api-key")
  let res
  try { res = await fetchImpl(new Request(request, { headers, redirect: "error" })) }
  catch { throw new Error("OpenDesign: inference request failed") }
  if (res.ok) return res // includes SSE; leave the stream and cancellation intact
  const text = await res.text().catch(() => "")
  const clean = new Headers(res.headers)
  clean.delete("content-length"); clean.delete("content-encoding")
  for (const [name, value] of clean) clean.set(name, redact(value, [runtimeKey, controlKey]))
  return new Response(redact(text, [runtimeKey, controlKey]), { status: res.status, statusText: redact(res.statusText, [runtimeKey, controlKey]), headers: clean })
}

export async function OpenDesignAuthPlugin(_input, options = {}) {
  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[ID] ??= {
        name: "OpenDesign", npm: NPM, api: BASE,
        // A model observed on /models; the authenticated list replaces this.
        models: { "deepseek-v4-flash": { name: "DeepSeek V4 Flash", limit: { context: 1048000, output: 0 }, tool_call: true } },
      }
    },
    auth: {
      provider: ID,
      icon: ICON,
      methods: [{
        type: "oauth", label: "Import OpenDesign local prod sign-in",
        prompts: [{ type: "text", key: "workspaceId", message: "Workspace ID for Coding Plan (optional; leave empty to skip)", placeholder: "workspace ID" }],
        async authorize(inputs) {
          return {
            url: "", method: "auto", instructions: "Read profiles.prod in ~/.amr/config.json; the file is not changed.",
            async callback() {
              try {
                const p = await readProfile(options.configPath)
                return {
                  type: "success", key: p.runtimeKey,
                  metadata: {
                    controlKey: p.controlKey, email: p.email, uid: p.uid,
                    workspaceId: firstString(inputs?.workspaceId, options.workspaceId, process.env.OPENDESIGN_WORKSPACE_ID),
                  },
                }
              } catch (e) { return { type: "failed", error: e.message } }
            },
          }
        },
      }],
      async loader(getAuth) {
        const { runtimeKey } = credentials(await getAuth())
        return { baseURL: BASE, apiKey: runtimeKey, fetch: (input, init) => inference(getAuth, input, init) }
      },
      async usage(getAuth) {
        try { return await usage(await getAuth(), options) }
        catch { return { error: "OpenDesign: account unavailable; import the local prod sign-in again", signIn: "kept" } }
      },
    },
    provider: { id: ID, async models(_provider, { auth }) { return models(auth) } },
  }
}

export const _internal = { number, usd, time, readProfile, credentials, json, runtimeModel, models, planWindows, preflight, usage, inference, redact }
