/**
 * Cloudflare Worker for PDF Dashboard
 */

const DEFAULT_USERS = {
  "master": { password: "master123", role: "MASTER" },
  "nao":  { password: "nao",   role: "user" },
  "user2":  { password: "user123",   role: "user" }
};

const GITHUB_DEFAULTS = {
  repo: "nguyentan-design/pdf-dashboard",
  branch: "main",
  path: "data.json"
};

function ghRepo(env)   { return env.GITHUB_REPO || GITHUB_DEFAULTS.repo; }
function ghBranch(env) { return env.GITHUB_BRANCH || GITHUB_DEFAULTS.branch; }
function ghPath(env)   { return env.GITHUB_DATA_PATH || GITHUB_DEFAULTS.path; }

function isGithubConfigured(env) {
  return !!env.GITHUB_TOKEN && ghRepo(env).indexOf("YOUR_REPO_NAME") === -1;
}

const GITHUB_CONFIG_MESSAGE =
  "Server chưa cấu hình GitHub (thiếu GITHUB_TOKEN hoặc chưa sửa repo trong GITHUB_DEFAULTS của worker.js).";

const MAX_DELETE_BATCH = 200;

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function parseAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || "")
    .split(",")
    .map(o => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function isOriginAllowed(request, env) {
  const allowed = parseAllowedOrigins(env);
  if (allowed.length === 0) return true;
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return allowed.indexOf(origin) !== -1;
}

function applyCors(response, request, env) {
  const allowed = parseAllowedOrigins(env);
  const origin = request.headers.get("Origin");

  const headers = new Headers(response.headers);

  if (allowed.length === 0) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (origin && allowed.indexOf(origin) !== -1) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

async function handleOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/* ================= STATUSES (API MỚI BỔ SUNG) ================= */
async function handleGetStatuses(request, env) {
  try {
    const list = await env.DOC_KV.list({ prefix: "status:" });
    const statuses = [];
    
    for (const key of list.keys) {
      const val = await env.DOC_KV.get(key.name, "json");
      if (val) statuses.push(val);
    }
    
    return jsonResponse({ success: true, statuses });
  } catch (err) {
    console.error("handleGetStatuses error:", err);
    return jsonResponse({ success: false, message: err.message }, 500);
  }
}

async function handlePostStatuses(request, env) {
  try {
    const body = await request.json();
    const ccNumber = String(body["CC NUMBER"] || "").trim();
    
    if (!ccNumber) {
      return jsonResponse({ success: false, message: "Thiếu CC NUMBER." }, 400);
    }

    const key = "status:" + ccNumber;
    let record = await env.DOC_KV.get(key, "json") || { "CC NUMBER": ccNumber };

    // Cập nhật các trường nếu có gửi lên
    if (body["Current status"] !== undefined) record["Current status"] = String(body["Current status"]).trim();
    if (body["Priority"] !== undefined) record["Priority"] = String(body["Priority"]).trim();
    if (body["Open day"] !== undefined) record["Open day"] = body["Open day"];

    await env.DOC_KV.put(key, JSON.stringify(record));

    return jsonResponse({ success: true, record });
  } catch (err) {
    console.error("handlePostStatuses error:", err);
    return jsonResponse({ success: false, message: err.message }, 500);
  }
}

/* ================= LOGIN ================= */
async function handleLogin(request, env) {
  try {
    const { username, password } = await request.json();

    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "Unknown";
    const country = request.headers.get("CF-IPCountry") || "Unknown";
    const userAgent = request.headers.get("User-Agent") || "Unknown";

    if (!username || !password) {
      return jsonResponse({ success: false, message: "Thiếu username hoặc password." }, 400);
    }

    let users = DEFAULT_USERS;
    try {
      const kvUsers = await env.DOC_KV.get("users", "json");
      if (kvUsers) users = kvUsers;
    } catch (e) {}

    const searchUsername = String(username).trim().toLowerCase();
    const userKey = Object.keys(users).find(k => k.toLowerCase() === searchUsername);
    const user = userKey ? users[userKey] : null;

    if (!user || String(user.password) !== String(password)) {
      await writeLog(env, {
        username: username, role: "guest", action: "LOGIN_FAIL",
        detail: "Sai thông tin đăng nhập",
        ip, country, userAgent,
        timestamp: new Date().toISOString()
      });
      return jsonResponse({ success: false, message: "Sai tên đăng nhập hoặc mật khẩu." }, 401);
    }

    const token = btoa(userKey + ":" + Date.now());

    await writeLog(env, {
      username: userKey, role: user.role, action: "LOGIN_SUCCESS",
      detail: "Đăng nhập thành công",
      ip, country, userAgent,
      timestamp: new Date().toISOString()
    });

    return jsonResponse({ success: true, username: userKey, role: user.role, token });

  } catch (err) {
    return jsonResponse({ success: false, message: "Lỗi server: " + err.message }, 500);
  }
}

/* ================= LOG ================= */
async function writeLog(env, logEntry) {
  try {
    const key = "log:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
    await env.DOC_KV.put(key, JSON.stringify(logEntry), {
      expirationTtl: 60 * 60 * 24 * 90
    });
  } catch (err) {
    console.error("Write log failed:", err);
  }
}

async function handleLog(request, env) {
  try {
    const body = await request.json();
    const ip = request.headers.get("CF-Connecting-IP") || "Unknown";
    const country = request.headers.get("CF-IPCountry") || "Unknown";
    const userAgent = request.headers.get("User-Agent") || "Unknown";
    
    await writeLog(env, {
      username: body.username || "anonymous",
      role: body.role || "guest",
      action: body.action || "UNKNOWN",
      detail: body.detail || "",
      ip, country, userAgent,
      timestamp: body.timestamp || new Date().toISOString()
    });
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message }, 500);
  }
}

async function handleGetLogs(request, env) {
  try {
    const url = new URL(request.url);
    let requester = url.searchParams.get("username");

    if (!requester) {
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
          const decoded = atob(token);
          requester = decoded.split(":")[0];
        } catch(e) {}
      }
    }

    if (!requester) return jsonResponse({ success: false, message: "Thiếu username." }, 400);

    let users = DEFAULT_USERS;
    try {
      const kvUsers = await env.DOC_KV.get("users", "json");
      if (kvUsers && typeof kvUsers === 'object') users = kvUsers;
    } catch (e) {}

    const searchReq = String(requester).trim().toLowerCase();
    const userKey = Object.keys(users).find(k => k.toLowerCase() === searchReq);
    const userRole = userKey && users[userKey] ? users[userKey].role : null;

    if (userRole !== "MASTER") {
      return jsonResponse({ success: false, message: "Không có quyền." }, 403);
    }

    const list = await env.DOC_KV.list({ prefix: "log:" });
    const sortedKeys = (list.keys || []).map(k => k.name).sort().reverse().slice(0, 100);
    const logs = [];
    
    for (const key of sortedKeys) {
      try {
        const val = await env.DOC_KV.get(key, "json");
        if (val) logs.push(val);
      } catch(e) {}
    }

    return jsonResponse({ success: true, logs });
  } catch (err) {
    console.error("handleGetLogs fatal error:", err);
    return jsonResponse({ success: false, message: "Lỗi máy chủ: " + err.message }, 500);
  }
}

/* ================= GET LINKS (per user) ================= */
async function handleGetLinks(request, env) {
  try {
    const url = new URL(request.url);
    const username = url.searchParams.get("username");
    if (!username) return jsonResponse({ success: false, message: "Thiếu username." }, 400);

    const key = "links:" + username;
    const data = await env.DOC_KV.get(key, "json");
    return jsonResponse(data || {});
  } catch (err) {
    return jsonResponse({});
  }
}

/* ================= SAVE LINKS (per user) ================= */
async function handleSaveLinks(request, env) {
  try {
    const body = await request.json();
    const { username, role, docKey, data } = body;
    if (!username || !docKey || !data) {
      return jsonResponse({ success: false, message: "Thiếu username/docKey/data." }, 400);
    }

    const key = "links:" + username;
    let linkStore = {};
    try {
      const existing = await env.DOC_KV.get(key, "json");
      if (existing) linkStore = existing;
    } catch (e) {}

    linkStore[docKey] = { ...(linkStore[docKey] || {}), ...data };
    await env.DOC_KV.put(key, JSON.stringify(linkStore));

    await writeLog(env, {
      username: username, role: role || "guest",
      action: "SAVE_LINKS", detail: "Cập nhật link cho: " + docKey,
      timestamp: new Date().toISOString()
    });

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message }, 500);
  }
}

/* ================= EDIT / DELETE (MASTER) ================= */
async function isMaster(env, username) {
  let users = DEFAULT_USERS;
  try {
    const kvUsers = await env.DOC_KV.get("users", "json");
    if (kvUsers) users = kvUsers;
  } catch (e) {}
  const searchReq = String(username).trim().toLowerCase();
  const userKey = Object.keys(users).find(k => k.toLowerCase() === searchReq);
  return userKey && users[userKey].role === "MASTER";
}

async function handleEdit(request, env) {
  try {
    const { username, role, docKey, newTitle, newDocNo, newCategory, newType, newDate } = await request.json();

    if (!(await isMaster(env, username))) {
      return jsonResponse({ success: false, message: "Không có quyền." }, 403);
    }

    const oldKey = String(docKey || "").trim();
    const newKey = String(newDocNo === undefined || newDocNo === null ? oldKey : newDocNo).trim();

    if (!oldKey) return jsonResponse({ success: false, message: "Thiếu docKey." }, 400);
    if (!newKey) return jsonResponse({ success: false, message: "Document No không được để trống." }, 400);

    if (!isGithubConfigured(env)) {
      return jsonResponse({ success: false, message: GITHUB_CONFIG_MESSAGE }, 500);
    }

    const fields = { "Document No": newKey };
    if (typeof newTitle === "string")    fields["Title"] = newTitle;
    if (typeof newCategory === "string") fields["Category"] = newCategory;
    if (typeof newType === "string")     fields["TYPE"] = newType;
    if (typeof newDate === "string")     fields["Release date"] = newDate;

    let result;
    try {
      result = await commitEditInData(env, oldKey, fields, username);
    } catch (err) {
      return jsonResponse({ success: false, message: err.message }, 502);
    }

    if (result.status === "notfound") return jsonResponse({ success: false, message: "Không tìm thấy record " + oldKey }, 404);
    if (result.status === "duplicate") return jsonResponse({ success: false, message: "Document No \"" + newKey + "\" đã tồn tại." }, 409);

    let kvUsersTouched = 0;
    let kvError = null;
    if (result.status === "ok" && newKey !== oldKey) {
      try {
        kvUsersTouched = await renameDocInKV(env, oldKey, newKey);
      } catch (err) {
        kvError = err.message;
      }
    }

    return jsonResponse({ success: true, unchanged: result.status === "unchanged", commit: result.commit, kvUsersTouched, kvError });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message }, 500);
  }
}

/* ================= GITHUB: data.json ================= */
function ghHeaders(env, extra) {
  return Object.assign({
    "Authorization": "Bearer " + env.GITHUB_TOKEN,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pdf-dashboard-worker"
  }, extra || {});
}

function ghContentsUrl(env) {
  const path = ghPath(env).split("/").map(encodeURIComponent).join("/");
  return "https://api.github.com/repos/" + ghRepo(env) + "/contents/" + path;
}

function b64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function ghError(res, prefix) {
  let detail = "";
  try {
    const j = await res.json();
    detail = j && j.message ? j.message : "";
  } catch (e) {}
  return new Error(prefix + " (HTTP " + res.status + (detail ? ": " + detail : "") + ")");
}

async function fetchDataFile(env) {
  const url = ghContentsUrl(env) + "?ref=" + encodeURIComponent(ghBranch(env));
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) throw await ghError(res, "Không đọc được data.json từ GitHub");

  const meta = await res.json();
  let text;
  if (meta.content && meta.encoding === "base64") {
    text = b64ToUtf8(meta.content);
  } else {
    const blobRes = await fetch("https://api.github.com/repos/" + ghRepo(env) + "/git/blobs/" + meta.sha, { headers: ghHeaders(env) });
    if (!blobRes.ok) throw await ghError(blobRes, "Không đọc được blob data.json");
    const blob = await blobRes.json();
    text = b64ToUtf8(blob.content);
  }
  return { text, sha: meta.sha };
}

function serializeLike(text, arr) {
  const usesCRLF = text.indexOf("\r\n") !== -1;
  const endsWithNewline = /\n$/.test(text);
  const indentMatch = text.match(/\n([ \t]+)\S/);

  let out;
  if (arr.length === 0) {
    out = "[]";
  } else if (indentMatch) {
    out = JSON.stringify(arr, null, indentMatch[1]);
  } else if (text.indexOf("\n") !== -1) {
    out = "[\n" + arr.map(o => JSON.stringify(o)).join(",\n") + "\n]";
  } else {
    out = JSON.stringify(arr);
  }

  if (usesCRLF) out = out.replace(/\r?\n/g, "\r\n");
  if (endsWithNewline) out += usesCRLF ? "\r\n" : "\n";
  return out;
}

function removeFromDataText(text, docKeys) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("data.json không phải là mảng JSON.");

  const wanted = new Set(docKeys);
  const found = new Set();

  const kept = data.filter(item => {
    const k = String((item && item["Document No"]) || "").trim();
    if (wanted.has(k)) { found.add(k); return false; }
    return true;
  });

  if (found.size === 0) return { newText: null, found: [] };
  return { newText: serializeLike(text, kept), found: Array.from(found) };
}

function applyEditToDataText(text, docKey, fields) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("data.json không phải là mảng JSON.");

  const keyOf = item => String((item && item["Document No"]) || "").trim();
  const targets = data.filter(item => keyOf(item) === docKey);
  if (targets.length === 0) return { status: "notfound", newText: null };

  const newDocNo = String(fields["Document No"]).trim();
  if (newDocNo !== docKey && data.some(item => keyOf(item) === newDocNo)) {
    return { status: "duplicate", newText: null };
  }

  let changed = false;
  for (const item of targets) {
    for (const f of Object.keys(fields)) {
      const val = f === "Document No" ? newDocNo : String(fields[f]);
      if (String(item[f] === undefined || item[f] === null ? "" : item[f]) !== val) {
        item[f] = val;
        changed = true;
      }
    }
  }

  if (!changed) return { status: "unchanged", newText: null };
  return { status: "ok", newText: serializeLike(text, data) };
}

async function commitDataChange(env, message, transform) {
  const url = ghContentsUrl(env);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text, sha } = await fetchDataFile(env);
    const t = transform(text);

    if (t.newText === null) return Object.assign({}, t, { commit: null });

    const body = {
      message,
      content: utf8ToB64(t.newText),
      sha,
      branch: ghBranch(env)
    };

    const putRes = await fetch(url, {
      method: "PUT",
      headers: ghHeaders(env, { "Content-Type": "application/json" }),
      body: JSON.stringify(body)
    });

    if (putRes.ok) {
      const j = await putRes.json();
      return Object.assign({}, t, { commit: j.commit ? { sha: j.commit.sha, url: j.commit.html_url } : null });
    }

    if ((putRes.status === 409 || putRes.status === 422) && attempt < 2) continue;
    throw await ghError(putRes, "Commit data.json thất bại");
  }
  throw new Error("Commit data.json thất bại sau nhiều lần thử.");
}

async function commitRemoveFromData(env, docKeys, who) {
  const shown = docKeys.slice(0, 5).join(", ") + (docKeys.length > 5 ? ", …" : "");
  const message = "Delete " + docKeys.length + " record(s) from data.json: " + shown + " (by " + who + ")";
  const r = await commitDataChange(env, message, text => {
    const { newText, found } = removeFromDataText(text, docKeys);
    return { newText, found };
  });

  const found = r.found || [];
  return { deleted: found, notFound: docKeys.filter(k => found.indexOf(k) === -1), commit: r.commit };
}

async function commitEditInData(env, docKey, fields, who) {
  const message = "Edit record " + docKey + (String(fields["Document No"]).trim() !== docKey ? " → " + String(fields["Document No"]).trim() : "") + " (by " + who + ")";
  return await commitDataChange(env, message, text => {
    const { status, newText } = applyEditToDataText(text, docKey, fields);
    return { status, newText };
  });
}

async function renameDocInKV(env, oldKey, newKey) {
  let cursor;
  let touchedUsers = 0;
  do {
    const list = await env.DOC_KV.list({ prefix: "links:", cursor });
    for (const k of list.keys) {
      const store = await env.DOC_KV.get(k.name, "json");
      if (!store || !Object.prototype.hasOwnProperty.call(store, oldKey)) continue;
      store[newKey] = store[oldKey];
      delete store[oldKey];
      await env.DOC_KV.put(k.name, JSON.stringify(store));
      touchedUsers++;
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return touchedUsers;
}

async function purgeDocsFromKV(env, docKeys) {
  let cursor;
  let touchedUsers = 0;
  do {
    const list = await env.DOC_KV.list({ prefix: "links:", cursor });
    for (const k of list.keys) {
      const store = await env.DOC_KV.get(k.name, "json");
      if (!store) continue;
      let changed = false;
      for (const dk of docKeys) {
        if (Object.prototype.hasOwnProperty.call(store, dk)) {
          delete store[dk];
          changed = true;
        }
      }
      if (changed) {
        await env.DOC_KV.put(k.name, JSON.stringify(store));
        touchedUsers++;
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return touchedUsers;
}

async function handleDelete(request, env) {
  try {
    const body = await request.json();
    const { username, role, password, verifyOnly } = body;

    let rawKeys = [];
    if (Array.isArray(body.docKeys)) rawKeys = body.docKeys;
    else if (body.docKey) rawKeys = [body.docKey];

    const docKeys = Array.from(new Set(rawKeys.map(k => String(k || "").trim()).filter(Boolean)));
    const keysLabel = docKeys.join(", ");

    if (!(await isMaster(env, username))) {
      await writeLog(env, { username, role, action: "DELETE_DENIED", detail: "Không phải MASTER: " + keysLabel, timestamp: new Date().toISOString() });
      return jsonResponse({ success: false, message: "Không có quyền." }, 403);
    }

    const expectedPassword = env.DELETE_PASSWORD;
    if (!expectedPassword) {
      return jsonResponse({ success: false, message: "Server chưa cấu hình env.DELETE_PASSWORD." }, 500);
    }

    if (password !== expectedPassword) {
      await writeLog(env, { username, role, action: "DELETE_WRONG_PASSWORD", detail: "Sai mật khẩu xóa cho: " + keysLabel, timestamp: new Date().toISOString() });
      return jsonResponse({ success: false, message: "Sai mật khẩu xóa." }, 401);
    }

    if (verifyOnly === true) return jsonResponse({ success: true, message: "Mật khẩu đúng." });
    if (docKeys.length === 0) return jsonResponse({ success: false, message: "Thiếu docKey/docKeys." }, 400);
    if (docKeys.length > MAX_DELETE_BATCH) return jsonResponse({ success: false, message: "Chỉ được xóa tối đa " + MAX_DELETE_BATCH + " record mỗi lần." }, 400);

    if (!isGithubConfigured(env)) {
      return jsonResponse({ success: false, message: GITHUB_CONFIG_MESSAGE }, 500);
    }

    let result;
    try {
      result = await commitRemoveFromData(env, docKeys, username);
    } catch (err) {
      return jsonResponse({ success: false, message: err.message }, 502);
    }

    let kvUsersTouched = 0;
    let kvError = null;
    try {
      kvUsersTouched = await purgeDocsFromKV(env, docKeys);
    } catch (err) {
      kvError = err.message;
    }

    return jsonResponse({
      success: true,
      deleted: result.deleted,
      notFound: result.notFound,
      commit: result.commit,
      kvUsersTouched,
      kvError
    });

  } catch (err) {
    return jsonResponse({ success: false, message: err.message }, 500);
  }
}

/* ================= MAIN ================= */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!isOriginAllowed(request, env)) {
      return new Response(JSON.stringify({ success: false, message: "Origin không được phép." }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    if (method === "OPTIONS") {
      return applyCors(await handleOptions(), request, env);
    }

    let response;
    try {
      if (path === "/login"  && method === "POST") response = await handleLogin(request, env);
      else if (path === "/log"    && method === "POST") response = await handleLog(request, env);
      else if (path === "/logs"   && method === "GET")  response = await handleGetLogs(request, env);
      else if (path === "/history" && method === "GET") response = await handleGetLogs(request, env);
      else if (path === "/statuses" && method === "GET") response = await handleGetStatuses(request, env);
      else if (path === "/statuses" && method === "POST") response = await handlePostStatuses(request, env);
      else if (path === "/links"  && method === "GET")  response = await handleGetLinks(request, env);
      else if (path === "/links"  && method === "POST") response = await handleSaveLinks(request, env);
      else if (path === "/edit"   && method === "POST") response = await handleEdit(request, env);
      else if (path === "/delete" && method === "POST") response = await handleDelete(request, env);
      else if (path === "/" || path === "/health") {
        response = jsonResponse({ success: true, message: "PDF Dashboard API is running.", timestamp: new Date().toISOString() });
      } else {
        response = jsonResponse({ success: false, message: "Endpoint không tồn tại." }, 404);
      }
    } catch (err) {
      response = jsonResponse({ success: false, message: "Lỗi server: " + err.message }, 500);
    }

    return applyCors(response, request, env);
  }
};