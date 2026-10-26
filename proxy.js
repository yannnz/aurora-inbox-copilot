/*
 * Aurora local server + API proxy.
 *
 * GET  /*           → static files (open http://localhost:8787/ for Google OAuth)
 * POST /            → DeepSeek Anthropic-compatible (direct, then VPN fallback)
 * POST /openai      → OpenAI via Shadowsocks HTTP proxy (default 127.0.0.1:10808)
 * POST /typesafe    → TypeSafe Jev System One (always via the local VPN proxy)
 *
 * Optional Laminar tracing (https://github.com/lmnr-ai/lmnr):
 *   Set LMNR_PROJECT_API_KEY when starting this process, and/or paste a project
 *   key in the app Settings. Defaults to Laminar Cloud (https://api.lmnr.ai,
 *   http 443 / grpc 8443) so a plain `node proxy.js` keeps tracing. For
 *   self-hosted Laminar set LMNR_BASE_URL=http://localhost LMNR_HTTP_PORT=8000
 *   LMNR_GRPC_PORT=8001. DeepSeek/OpenAI keys are never written into this file.
 *
 * Optional local Phoenix tracing (https://github.com/Arize-ai/phoenix):
 *   Enabled by default and does not need an API key. Start Phoenix first with
 *   `uvx --from arize-phoenix phoenix serve --host 127.0.0.1 --port 6006`.
 *   Override with PHOENIX_URL / PHOENIX_PROJECT_NAME, or disable with
 *   PHOENIX_ENABLED=0. Phoenix receives one OpenInference LLM span per Jev,
 *   DeepSeek, and OpenAI request. API keys are never exported.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const net = require("net");
const tls = require("tls");

const ROOT = __dirname;
const DEEPSEEK_URL = "https://api.deepseek.com/anthropic/v1/messages";
const TYPESAFE_URL = process.env.TYPESAFE_URL || "https://api.typesafe.ai/v1/systemone";
const OPENAI_URL =
  process.env.OPENAI_URL ||
  "https://api.openai.com/v1/chat/completions";
const PORT = 8787;

const OPENAI_HTTP_PROXY =
  process.env.OPENAI_HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  "http://127.0.0.1:10808";

const PHOENIX_ENABLED = process.env.PHOENIX_ENABLED !== "0";
const PHOENIX_BASE_URL =
  String(process.env.PHOENIX_URL || "http://127.0.0.1:6006").replace(/\/+$/, "");
const PHOENIX_TRACE_URL =
  process.env.PHOENIX_TRACE_URL || PHOENIX_BASE_URL + "/v1/traces";
const PHOENIX_PROJECT_NAME =
  process.env.PHOENIX_PROJECT_NAME || process.env.PHOENIX_PROJECT || "aurora-inbox";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};

var Laminar = null;
var observe = null;
var laminarReady = false;
var laminarInitKey = "";
var laminarInitEndpoint = "";
var laminarIgnoredKey = "";
var phoenixProvider = null;
var phoenixTracer = null;
var phoenixReady = false;

function laminarConfig() {
  var baseUrl = String(process.env.LMNR_BASE_URL || "https://api.lmnr.ai").trim();
  var isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);
  var httpPort = Number(process.env.LMNR_HTTP_PORT || (isLocal ? 8000 : 443));
  var grpcPort = Number(process.env.LMNR_GRPC_PORT || (isLocal ? 8001 : 8443));
  return {
    baseUrl: baseUrl,
    httpPort: httpPort,
    grpcPort: grpcPort,
    endpointLabel: baseUrl + " (http " + httpPort + ", grpc " + grpcPort + ")"
  };
}

function laminarUiUrl(cfg) {
  return /localhost|127\.0\.0\.1/.test(cfg.baseUrl) ? "http://localhost:5667/" : "https://www.laminar.sh/";
}

function ensureLaminar(apiKeyFromHeader) {
  var key = String(apiKeyFromHeader || process.env.LMNR_PROJECT_API_KEY || "").trim();
  if (!key) return false;
  var cfg = laminarConfig();
  if (laminarReady && laminarInitKey === key && laminarInitEndpoint === cfg.endpointLabel) {
    return true;
  }
  // The Laminar SDK only honours its first initialize() per process; later keys are ignored.
  if (laminarReady) {
    if (laminarIgnoredKey !== key) {
      laminarIgnoredKey = key;
      console.warn("Laminar key changed in Settings, but tracing still uses the key this server started with.");
      console.warn("Restart the Aurora server (Ctrl+C, then node proxy.js) to send traces with the new key.");
    }
    return true;
  }
  try {
    var lmnr = require("@lmnr-ai/lmnr");
    Laminar = lmnr.Laminar;
    observe = lmnr.observe;
    Laminar.initialize({
      projectApiKey: key,
      baseUrl: cfg.baseUrl,
      httpPort: cfg.httpPort,
      grpcPort: cfg.grpcPort,
      forceHttp: true
    });
    laminarReady = true;
    laminarInitKey = key;
    laminarInitEndpoint = cfg.endpointLabel;
    console.log("Laminar tracing enabled → " + cfg.endpointLabel + " | UI " + laminarUiUrl(cfg));
    return true;
  } catch (e) {
    console.warn("Laminar unavailable:", e && e.message ? e.message : e);
    console.warn("Run npm install, then restart with LMNR_PROJECT_API_KEY or Settings key.");
    return false;
  }
}

function initPhoenix() {
  if (!PHOENIX_ENABLED || phoenixReady) return phoenixReady;
  try {
    var BasicTracerProvider = require("@opentelemetry/sdk-trace-base").BasicTracerProvider;
    var SimpleSpanProcessor = require("@opentelemetry/sdk-trace-base").SimpleSpanProcessor;
    var Resource = require("@opentelemetry/resources").Resource;
    var OTLPTraceExporter = require("@opentelemetry/exporter-trace-otlp-proto").OTLPTraceExporter;

    phoenixProvider = new BasicTracerProvider({
      resource: new Resource({
        "service.name": "aurora-inbox-copilot",
        "openinference.project.name": PHOENIX_PROJECT_NAME
      })
    });
    phoenixProvider.addSpanProcessor(
      new SimpleSpanProcessor(
        new OTLPTraceExporter({
          url: PHOENIX_TRACE_URL,
          headers: { "x-project-name": PHOENIX_PROJECT_NAME },
          timeoutMillis: 2000
        })
      )
    );
    phoenixTracer = phoenixProvider.getTracer("aurora-inbox-proxy");
    phoenixReady = true;
    console.log(
      "Phoenix tracing enabled → " + PHOENIX_TRACE_URL +
      " | project " + PHOENIX_PROJECT_NAME + " | UI " + PHOENIX_BASE_URL + "/"
    );
    return true;
  } catch (e) {
    console.warn("Phoenix unavailable:", e && e.message ? e.message : e);
    console.warn("Run npm install to restore OpenTelemetry packages, or set PHOENIX_ENABLED=0.");
    return false;
  }
}

function phoenixJson(value, limit) {
  try {
    var text = JSON.stringify(value === undefined ? null : value);
    var max = limit || 65536;
    return text.length > max ? text.slice(0, max) + "…[truncated]" : text;
  } catch (e) {
    return JSON.stringify({ note: "unserializable value" });
  }
}

async function withPhoenixSpan(options, operation) {
  if (!phoenixReady || !phoenixTracer) return await operation();

  var span = phoenixTracer.startSpan(options.name || "aurora.llm");
  span.setAttribute("openinference.span.kind", "LLM");
  Object.keys(options.attributes || {}).forEach(function (key) {
    var value = options.attributes[key];
    if (value !== undefined && value !== null && value !== "") span.setAttribute(key, value);
  });
  if (options.input !== undefined) span.setAttribute("input.value", phoenixJson(options.input));

  try {
    var result = await operation();
    var recorded = options.recordResult ? options.recordResult(result) : {};
    if (recorded.status) {
      span.setAttribute("http.status_code", Number(recorded.status) || 0);
      span.setStatus({
        code: Number(recorded.status) >= 200 && Number(recorded.status) < 400 ? 1 : 2,
        message: Number(recorded.status) >= 400 ? "Upstream HTTP " + recorded.status : undefined
      });
    } else {
      span.setStatus({ code: 1 });
    }
    if (recorded.via) span.setAttribute("aurora.transport", String(recorded.via));
    if (recorded.output !== undefined) span.setAttribute("output.value", phoenixJson(recorded.output));
    span.end();
    return result;
  } catch (e) {
    span.recordException(e);
    span.setStatus({ code: 2, message: String(e && e.message ? e.message : e) });
    span.end();
    throw e;
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, x-api-key, anthropic-version, content-type, x-lmnr-project-api-key, x-aurora-email-id, x-aurora-role, x-aurora-session-id"
  );
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function targetFor(urlPath) {
  var p = (urlPath || "/").split("?")[0];
  if (p === "/openai" || p === "/openai/") return OPENAI_URL;
  return DEEPSEEK_URL;
}

function isOpenAiTarget(target) {
  return target === OPENAI_URL || /\/chat\/completions/.test(target);
}

function postJson(targetUrl, headers, body, viaProxyUrl) {
  return new Promise(function (resolve, reject) {
    var u = new URL(targetUrl);
    var payload = Buffer.isBuffer(body) ? body : Buffer.from(body || "");

    function onResponse(upstream) {
      var chunks = [];
      upstream.on("data", function (c) { chunks.push(c); });
      upstream.on("end", function () {
        resolve({
          status: upstream.statusCode || 502,
          text: Buffer.concat(chunks).toString("utf8")
        });
      });
    }

    if (!viaProxyUrl) {
      var req = https.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: "POST",
          headers: Object.assign({}, headers, {
            "content-length": payload.length,
            host: u.host
          })
        },
        onResponse
      );
      req.on("error", reject);
      req.setTimeout(60000, function () {
        req.destroy(new Error("Upstream timeout"));
      });
      req.write(payload);
      req.end();
      return;
    }

    var proxy = new URL(viaProxyUrl);
    var proxyPort = Number(proxy.port || 80);
    var connectReq =
      "CONNECT " + u.hostname + ":443 HTTP/1.1\r\n" +
      "Host: " + u.hostname + ":443\r\n\r\n";

    var socket = net.connect(proxyPort, proxy.hostname, function () {
      socket.write(connectReq);
    });

    var connectBuf = "";
    var connected = false;

    socket.setTimeout(20000, function () {
      if (!connected) {
        socket.destroy();
        reject(new Error("CONNECT timeout via " + viaProxyUrl));
      }
    });

    socket.on("data", function (chunk) {
      if (connected) return;
      connectBuf += chunk.toString("utf8");
      if (connectBuf.indexOf("\r\n\r\n") === -1) return;
      if (!/^HTTP\/1\.[01] 200/i.test(connectBuf)) {
        socket.destroy();
        reject(new Error("Proxy CONNECT failed: " + connectBuf.split("\r\n")[0]));
        return;
      }
      connected = true;
      var tlsSock = tls.connect(
        { socket: socket, servername: u.hostname },
        function () {
          var reqLines =
            "POST " + u.pathname + u.search + " HTTP/1.1\r\n" +
            "Host: " + u.host + "\r\n" +
            "Connection: close\r\n";
          Object.keys(headers).forEach(function (k) {
            reqLines += k + ": " + headers[k] + "\r\n";
          });
          reqLines += "Content-Length: " + payload.length + "\r\n\r\n";
          tlsSock.write(reqLines);
          tlsSock.write(payload);
        }
      );

      var respBuf = Buffer.alloc(0);
      tlsSock.on("data", function (c) {
        respBuf = Buffer.concat([respBuf, c]);
      });
      tlsSock.on("end", function () {
        var raw = respBuf.toString("utf8");
        var sep = raw.indexOf("\r\n\r\n");
        if (sep === -1) {
          reject(new Error("Bad HTTPS response through proxy"));
          return;
        }
        var head = raw.slice(0, sep);
        var bodyText = raw.slice(sep + 4);
        var statusMatch = head.match(/^HTTP\/1\.[01] (\d+)/);
        var status = statusMatch ? Number(statusMatch[1]) : 502;
        if (/transfer-encoding:\s*chunked/i.test(head)) {
          bodyText = decodeChunked(bodyText);
        }
        resolve({ status: status, text: bodyText });
      });
      tlsSock.on("error", reject);
    });

    socket.on("error", reject);
  });
}

function decodeChunked(text) {
  var out = "";
  var i = 0;
  while (i < text.length) {
    var nl = text.indexOf("\r\n", i);
    if (nl === -1) break;
    var size = parseInt(text.slice(i, nl), 16);
    if (!size) break;
    out += text.slice(nl + 2, nl + 2 + size);
    i = nl + 2 + size + 2;
  }
  return out || text;
}

function networkHint(err, kind) {
  var msg = String(err && err.message ? err.message : err);
  if (/timeout|ENOTFOUND|ECONNREFUSED|CONNECT|fetch failed|Bad HTTPS/i.test(msg)) {
    if (kind === "openai") {
      return (
        "Could not reach OpenAI via VPN proxy (" + OPENAI_HTTP_PROXY + "). " +
        "Keep ShadowsocksX Enable + Global Mode on, then restart this proxy."
      );
    }
    return (
      "Could not reach DeepSeek (tried direct, then via " + OPENAI_HTTP_PROXY + "). " +
      "If api.deepseek.com is blocked, keep Shadowsocks Global Mode on and retry."
    );
  }
  return msg;
}

async function postDeepSeek(headers, body) {
  try {
    var direct = await postJson(DEEPSEEK_URL, headers, body, null);
    return { upstream: direct, via: "direct" };
  } catch (e1) {
    try {
      var proxied = await postJson(DEEPSEEK_URL, headers, body, OPENAI_HTTP_PROXY);
      return { upstream: proxied, via: OPENAI_HTTP_PROXY + " (fallback)" };
    } catch (e2) {
      throw new Error(String(e1.message || e1) + " | fallback: " + String(e2.message || e2));
    }
  }
}

async function postTypeSafe(headers, body) {
  try {
    // TypeSafe's API geoblocks the local direct egress as CN even when the
    // browser can open platform.typesafe.ai. Node does not inherit the Windows
    // system proxy, so Jev must always use the explicit local VPN proxy.
    var upstream = await postJson(TYPESAFE_URL, headers, body, OPENAI_HTTP_PROXY);
    return { upstream: upstream, via: OPENAI_HTTP_PROXY };
  } catch (e1) {
    throw new Error(
      String(e1 && e1.message ? e1.message : e1) +
      " — TypeSafe/Jev is routed through " + OPENAI_HTTP_PROXY +
      ". Keep the VPN HTTP proxy running and reachable, then retry."
    );
  }
}

function handleTypeSafePost(req, res) {
  const chunks = [];
  req.on("data", function (c) { chunks.push(c); });
  req.on("end", async function () {
    const body = Buffer.concat(chunks);
    const headers = { "content-type": "application/json" };
    var auth = String(req.headers["authorization"] || "").trim();
    if (auth) headers["authorization"] = auth;
    var emailId = String(req.headers["x-aurora-email-id"] || "").trim();
    var sessionId = String(req.headers["x-aurora-session-id"] || "").trim();
    var tracing = ensureLaminar(String(req.headers["x-lmnr-project-api-key"] || "").trim());
    var phoenix = initPhoenix();
    var spanInput = { note: "unparseable request body" };
    try {
      var parsedReq = JSON.parse(body.toString("utf8"));
      spanInput = { provider: "typesafe", model: parsedReq.model || "", state: parsedReq.state, questions: parsedReq.questions };
    } catch (e) { /* keep note */ }
    try {
      async function runTypeSafe() {
        if (tracing && observe) {
          return await observe(
            {
              name: "aurora.jev",
              sessionId: sessionId || undefined,
              spanType: "LLM",
              tags: ["aurora-inbox", "jev"].concat(emailId ? [emailId] : []),
              metadata: { email_id: emailId || null, role: "jev", provider: "typesafe", model: spanInput.model || null },
              input: spanInput
            },
            async function () {
              var r = await postTypeSafe(headers, body);
              var answers = null;
              try { answers = JSON.parse(r.upstream.text || "").answers || null; } catch (e) { /* raw */ }
              return { upstream: r.upstream, via: r.via, response: answers || String(r.upstream.text || "").slice(0, 2000) };
            }
          );
        }
        return await postTypeSafe(headers, body);
      }

      var out = phoenix
        ? await withPhoenixSpan(
            {
              name: "aurora.jev",
              input: spanInput,
              attributes: {
                "email.id": emailId || null,
                "session.id": sessionId || null,
                "aurora.role": "jev",
                "llm.model_name": spanInput.model || null,
                "llm.provider": "typesafe"
              },
              recordResult: function (result) {
                var upstream = result && result.upstream ? result.upstream : { status: 0, text: "" };
                var answers = null;
                try { answers = JSON.parse(upstream.text || "").answers || null; } catch (e) { /* raw */ }
                return {
                  status: upstream.status,
                  via: result && result.via,
                  output: answers || { preview: String(upstream.text || "").slice(0, 2000) }
                };
              }
            },
            runTypeSafe
          )
        : await runTypeSafe();
      setCors(res);
      res.setHeader("Content-Type", "application/json");
      res.writeHead(out.upstream.status || 502);
      res.end(out.upstream.text || "");
    } catch (e) {
      var msg = String(e && e.message ? e.message : e);
      setCors(res);
      res.setHeader("Content-Type", "application/json");
      res.writeHead(502);
      res.end(JSON.stringify({
        error: {
          message: /timeout|ENOTFOUND|ECONNREFUSED|CONNECT|Bad HTTPS/i.test(msg)
            ? "Could not reach TypeSafe via the required VPN proxy (" + OPENAI_HTTP_PROXY + "). " +
              "Keep Shadowsocks Global Mode / the local HTTP proxy running, then retry."
            : msg,
          upstream: TYPESAFE_URL,
          via: OPENAI_HTTP_PROXY
        }
      }));
    }
  });
}

function redactLlmPayload(rawBody, useVpn) {
  var parsed = null;
  try {
    parsed = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || ""));
  } catch (e) {
    return { note: "unparseable request body" };
  }
  if (!parsed || typeof parsed !== "object") return { note: "empty body" };
  if (useVpn) {
    return {
      provider: "openai",
      model: parsed.model || "",
      messages: parsed.messages || [],
      max_tokens: parsed.max_tokens
    };
  }
  return {
    provider: "deepseek",
    model: parsed.model || "",
    system: parsed.system || "",
    messages: parsed.messages || [],
    max_tokens: parsed.max_tokens
  };
}

function summarizeUpstream(text) {
  try {
    var data = JSON.parse(text || "");
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return {
        kind: "openai",
        content: data.choices[0].message.content || "",
        usage: data.usage || null
      };
    }
    if (Array.isArray(data.content)) {
      var block = data.content.find(function (b) { return b.type === "text" && b.text; });
      return {
        kind: "anthropic-compatible",
        content: block ? block.text : "",
        usage: data.usage || null
      };
    }
    if (data.error) return { kind: "error", error: data.error };
  } catch (e) { /* ignore */ }
  return { kind: "raw", preview: String(text || "").slice(0, 2000) };
}

function safeStaticPath(urlPath) {
  var decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  if (decoded === "/") decoded = "/index.html";
  if (decoded.indexOf("..") !== -1) return null;
  var full = path.normalize(path.join(ROOT, decoded.replace(/^\//, "")));
  if (!full.startsWith(ROOT)) return null;
  return full;
}

function serveStatic(req, res) {
  var filePath = safeStaticPath(req.url);
  if (!filePath) {
    setCors(res);
    res.writeHead(400);
    res.end("Bad path");
    return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      setCors(res);
      res.writeHead(404);
      res.end("Not found: " + req.url);
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    setCors(res);
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    // Always revalidate so a normal reload never runs an outdated index.html.
    res.setHeader("Cache-Control", "no-cache");
    res.writeHead(200);
    res.end(data);
  });
}

function handleApiPost(req, res) {
  const chunks = [];
  req.on("data", function (c) { chunks.push(c); });
  req.on("end", async function () {
    const body = Buffer.concat(chunks);
    const auth = req.headers["authorization"] || "";
    const target = targetFor(req.url);
    const useVpn = isOpenAiTarget(target);
    const headers = {
      "content-type": "application/json"
    };
    if (useVpn) {
      headers["authorization"] = auth;
    } else {
      // DeepSeek Anthropic-compatible API prefers x-api-key.
      var bearer = "";
      var m = String(auth).match(/^Bearer\s+(.+)$/i);
      if (m) bearer = m[1].trim();
      var xKey = String(req.headers["x-api-key"] || "").trim() || bearer;
      if (xKey) headers["x-api-key"] = xKey;
      if (auth) headers["authorization"] = auth;
      headers["anthropic-version"] = "2023-06-01";
    }

    var emailId = String(req.headers["x-aurora-email-id"] || "").trim();
    var role = String(req.headers["x-aurora-role"] || (useVpn ? "reviewer" : "worker")).trim();
    var sessionId = String(req.headers["x-aurora-session-id"] || "").trim();
    var lmnrKey = String(req.headers["x-lmnr-project-api-key"] || "").trim();
    var tracing = ensureLaminar(lmnrKey);
    var phoenix = initPhoenix();
    var spanInput = redactLlmPayload(body, useVpn);

    async function runUpstream() {
      if (useVpn) {
        return {
          upstream: await postJson(target, headers, body, OPENAI_HTTP_PROXY),
          via: OPENAI_HTTP_PROXY
        };
      }
      return await postDeepSeek(headers, body);
    }

    try {
      async function runLlmRequest() {
        if (tracing && observe) {
          return await observe(
            {
              name: role === "reviewer" ? "aurora.reviewer" : "aurora.worker",
              sessionId: sessionId || undefined,
              spanType: "LLM",
              tags: ["aurora-inbox", role].concat(emailId ? [emailId] : []),
              metadata: {
                email_id: emailId || null,
                role: role,
                provider: useVpn ? "openai" : "kimi",
                model: spanInput.model || null
              },
              input: spanInput
            },
            async function () {
              var out = await runUpstream();
              return {
                status: out.upstream.status,
                via: out.via,
                text: out.upstream.text,
                response: summarizeUpstream(out.upstream.text)
              };
            }
          );
        }
        var plain = await runUpstream();
        return {
          status: plain.upstream.status,
          via: plain.via,
          text: plain.upstream.text,
          upstream: plain.upstream
        };
      }

      var packed = phoenix
        ? await withPhoenixSpan(
            {
              name: role === "reviewer" ? "aurora.reviewer" : "aurora.worker",
              input: spanInput,
              attributes: {
                "email.id": emailId || null,
                "session.id": sessionId || null,
                "aurora.role": role,
                "llm.model_name": spanInput.model || null,
                "llm.provider": useVpn ? "openai" : "deepseek"
              },
              recordResult: function (result) {
                var raw = result && result.upstream ? result.upstream : { status: result && result.status, text: result && result.text };
                return {
                  status: raw.status,
                  via: result && result.via,
                  output: summarizeUpstream(raw.text)
                };
              }
            },
            runLlmRequest
          )
        : await runLlmRequest();

      setCors(res);
      res.setHeader("Content-Type", "application/json");
      res.writeHead(packed.status || 502);
      res.end(packed.text || "");
    } catch (e) {
      setCors(res);
      res.setHeader("Content-Type", "application/json");
      res.writeHead(502);
      res.end(JSON.stringify({
        error: {
          message: networkHint(e, useVpn ? "openai" : "kimi"),
          upstream: target,
          via: useVpn ? OPENAI_HTTP_PROXY : "direct+fallback"
        }
      }));
    }
  });
}

const server = http.createServer(function (req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  var urlPath = (req.url || "/").split("?")[0];
  if (req.method === "POST" && (urlPath === "/typesafe" || urlPath === "/typesafe/")) {
    handleTypeSafePost(req, res);
    return;
  }
  var isApiPost =
    req.method === "POST" &&
    (urlPath === "/" || urlPath === "/openai" || urlPath === "/openai/");

  if (isApiPost) {
    handleApiPost(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }

  setCors(res);
  res.writeHead(405);
  res.end();
});

server.listen(PORT, "127.0.0.1", function () {
  console.log("Aurora server at http://localhost:" + PORT + "/");
  console.log("  Open the app here (required for Google Calendar OAuth).");
  console.log("  POST /       → DeepSeek direct, then via " + OPENAI_HTTP_PROXY + " if needed");
  console.log("  POST /openai → OpenAI via " + OPENAI_HTTP_PROXY);
  console.log("  POST /typesafe → TypeSafe Jev always via " + OPENAI_HTTP_PROXY);
  if (PHOENIX_ENABLED) {
    initPhoenix();
  } else {
    console.log("  Phoenix tracing: disabled (PHOENIX_ENABLED=0)");
  }
  console.log("  Laminar: " + laminarConfig().endpointLabel + " | UI " + laminarUiUrl(laminarConfig()));
  if (process.env.LMNR_PROJECT_API_KEY) {
    ensureLaminar(process.env.LMNR_PROJECT_API_KEY);
  } else {
    console.log("  Laminar key: paste project API key in app Settings (or set LMNR_PROJECT_API_KEY)");
  }
  console.log("Leave this window open. Press Ctrl+C to stop.");
});
