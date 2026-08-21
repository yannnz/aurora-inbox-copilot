/*
 * Aurora local server + API proxy.
 *
 * GET  /*           → static files (open http://localhost:8787/ for Google OAuth)
 * POST /            → Kimi (direct, then VPN fallback)
 * POST /openai      → OpenAI via Shadowsocks HTTP proxy (default 127.0.0.1:10808)
 *
 * Optional Laminar tracing (https://github.com/lmnr-ai/lmnr):
 *   Set LMNR_PROJECT_API_KEY when starting this process, and/or paste a project
 *   key in the app Settings. Defaults to self-hosted Laminar on localhost
 *   (UI :5667, API :8000/:8001). Override with LMNR_BASE_URL / LMNR_HTTP_PORT /
 *   LMNR_GRPC_PORT. Kimi/OpenAI keys are never written into this file.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const net = require("net");
const tls = require("tls");

const ROOT = __dirname;
const KIMI_URL = "https://api.moonshot.cn/anthropic/v1/messages";
const OPENAI_URL =
  process.env.OPENAI_URL ||
  "https://api.openai.com/v1/chat/completions";
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

const OPENAI_HTTP_PROXY =
  process.env.OPENAI_HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  "http://127.0.0.1:10808";

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

function laminarConfig() {
  var baseUrl = String(process.env.LMNR_BASE_URL || "http://localhost").trim();
  var httpPort = Number(process.env.LMNR_HTTP_PORT || 8000);
  var grpcPort = Number(process.env.LMNR_GRPC_PORT || 8001);
  return {
    baseUrl: baseUrl,
    httpPort: httpPort,
    grpcPort: grpcPort,
    endpointLabel: baseUrl + " (http " + httpPort + ", grpc " + grpcPort + ")"
  };
}

function ensureLaminar(apiKeyFromHeader) {
  var key = String(apiKeyFromHeader || process.env.LMNR_PROJECT_API_KEY || "").trim();
  if (!key) return false;
  var cfg = laminarConfig();
  if (laminarReady && laminarInitKey === key && laminarInitEndpoint === cfg.endpointLabel) {
    return true;
  }
  try {
    var lmnr = require("@lmnr-ai/lmnr");
    Laminar = lmnr.Laminar;
    observe = lmnr.observe;
    if (laminarReady && Laminar.shutdown) {
      try { Laminar.shutdown(); } catch (e) { /* ignore */ }
      laminarReady = false;
    }
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
    console.log("Laminar tracing enabled → " + cfg.endpointLabel + " | UI http://localhost:5667/");
    return true;
  } catch (e) {
    console.warn("Laminar unavailable:", e && e.message ? e.message : e);
    console.warn("Run npm install, then restart with LMNR_PROJECT_API_KEY or Settings key.");
    return false;
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, anthropic-version, content-type, x-lmnr-project-api-key, x-aurora-email-id, x-aurora-role, x-aurora-session-id"
  );
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function targetFor(urlPath) {
  var p = (urlPath || "/").split("?")[0];
  if (p === "/openai" || p === "/openai/") return OPENAI_URL;
  return KIMI_URL;
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
      "Could not reach Kimi (tried direct, then via " + OPENAI_HTTP_PROXY + "). " +
      "If Global Mode is on, keep Shadowsocks enabled; or switch to Auto Mode so China APIs go direct."
    );
  }
  return msg;
}

async function postKimi(headers, body) {
  try {
    var direct = await postJson(KIMI_URL, headers, body, null);
    return { upstream: direct, via: "direct" };
  } catch (e1) {
    try {
      var proxied = await postJson(KIMI_URL, headers, body, OPENAI_HTTP_PROXY);
      return { upstream: proxied, via: OPENAI_HTTP_PROXY + " (fallback)" };
    } catch (e2) {
      throw new Error(String(e1.message || e1) + " | fallback: " + String(e2.message || e2));
    }
  }
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
    provider: "kimi",
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
      "content-type": "application/json",
      "authorization": auth
    };
    if (!useVpn) {
      headers["anthropic-version"] = "2023-06-01";
    }

    var emailId = String(req.headers["x-aurora-email-id"] || "").trim();
    var role = String(req.headers["x-aurora-role"] || (useVpn ? "reviewer" : "worker")).trim();
    var sessionId = String(req.headers["x-aurora-session-id"] || "").trim();
    var lmnrKey = String(req.headers["x-lmnr-project-api-key"] || "").trim();
    var tracing = ensureLaminar(lmnrKey);
    var spanInput = redactLlmPayload(body, useVpn);

    async function runUpstream() {
      if (useVpn) {
        return {
          upstream: await postJson(target, headers, body, OPENAI_HTTP_PROXY),
          via: OPENAI_HTTP_PROXY
        };
      }
      return await postKimi(headers, body);
    }

    try {
      var packed;
      if (tracing && observe) {
        packed = await observe(
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
      } else {
        var plain = await runUpstream();
        packed = {
          status: plain.upstream.status,
          via: plain.via,
          text: plain.upstream.text
        };
      }

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

server.listen(PORT, HOST, function () {
  console.log("Aurora server at http://localhost:" + PORT + "/ (bound to " + HOST + ")");
  console.log("  Open the app here (required for Google Calendar OAuth).");
  console.log("  POST /       → Kimi direct, then via " + OPENAI_HTTP_PROXY + " if needed");
  console.log("  POST /openai → OpenAI via " + OPENAI_HTTP_PROXY);
  console.log("  Laminar: local " + laminarConfig().endpointLabel + " | UI http://localhost:5667/");
  if (process.env.LMNR_PROJECT_API_KEY) {
    ensureLaminar(process.env.LMNR_PROJECT_API_KEY);
  } else {
    console.log("  Laminar key: paste project API key in app Settings (or set LMNR_PROJECT_API_KEY)");
  }
  console.log("Leave this window open. Press Ctrl+C to stop.");
});
