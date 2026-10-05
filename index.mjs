// OpenDesign's AMR prod keys, imported read-only from its local sign-in.
// Control-plane keys never go to the inference API. No secrets or upstream
// error bodies are logged. Only actual Coding Plan limits become quota windows.
import { readFile, access } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const ID = "opendesign"
const ICON = "https://open-design.ai/apple-touch-icon.png"
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
const amount = (v) => number(v) === undefined ? undefined : String(number(v))

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

function planWindows(b) {
  const cp = b?.codingPlan
  if (!object(cp) || !Array.isArray(cp.windows)) throw new Error("OpenDesign: invalid Coding Plan response")
  if (!cp.windows.length) {
    if (cp.eligible === false) return []
    throw new Error("OpenDesign: Coding Plan windows unavailable")
  }
  return cp.windows.map((w) => {
    const used = number(w.usedCredits), limit = number(w.limitCredits), remaining = number(w.remainingCredits)
    const duration = number(w.durationSeconds), resetsAt = time(w.resetsAt)
    if (used === undefined || used < 0 || limit === undefined || limit <= 0 || remaining === undefined || remaining < 0 || !resetsAt || !(duration > 0))
      throw new Error("OpenDesign: incomplete Coding Plan window")
    const name = duration % 86400 === 0 ? `${duration / 86400} days` : duration % 3600 === 0 ? `${duration / 3600} hours` : `${duration} seconds`
    return {
      name, used: used / limit * 100, span: duration, resetsAt,
      display: `${used} / ${limit} credits · ${remaining} remaining`,
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
  return planWindows(b)
}

async function usage(a, options = {}, { fetchImpl = fetch, preflightImpl = preflight, readProfileImpl = readProfile } = {}) {
  const { controlKey, runtimeKey } = credentials(a)
  const out = { signIn: "kept" }, errors = [], windows = [], balance = []
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
    else balance.push(`$${n.toFixed(4)}`)
  } else errors.push(wallet.reason.message)
  if (billing.status === "fulfilled") {
    const b = billing.value, tier = firstString(b.membershipTier), status = firstString(b.subscriptionStatus)
    if (tier) out.plan = status ? `${tier} (${status})` : tier
    else errors.push("OpenDesign: membership tier unavailable")
    if (!status) errors.push("OpenDesign: subscription status unavailable")
    for (const [field, name] of [["subscriptionCredits", "Subscription credits"], ["rechargeCredits", "Recharge credits"]]) {
      const value = amount(b.balances?.[field])
      if (value === undefined) errors.push(`OpenDesign: ${name.toLowerCase()} unavailable`)
      // Magpie treats a window without `used` as 0% used. A credit balance
      // has no known total, so it must not be displayed as a quota window.
      else balance.push(`${name}: ${value}`)
    }
    const until = time(b.subscriptionCurrentPeriodEnd)
    if (until) out.until = until
    if (typeof b.subscriptionCancelAtPeriodEnd === "boolean") out.renew = b.subscriptionCancelAtPeriodEnd ? "off" : "auto"
  } else errors.push(billing.reason.message)
  if (coding?.status === "fulfilled") windows.push(...coding.value)
  else if (coding) errors.push(coding.reason.message)
  else errors.push("OpenDesign: Coding Plan not queried; set workspaceId in plugin options or import the sign-in with a workspace ID")
  if (balance.length) out.balance = balance.join(" · ")
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

export const _internal = { number, time, readProfile, credentials, json, runtimeModel, models, planWindows, preflight, usage, inference, redact }
