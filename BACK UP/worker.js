/**
 * Cloudflare Worker: Call Center Status API
 *
 * Endpoints:
 *   OPTIONS /statuses   → CORS preflight
 *   GET     /statuses   → Đọc status.json từ GitHub, trả về mảng
 *                         [{ "CC NUMBER", "Current status", "Priority", "Open day" }, ...]
 *   POST    /statuses   → Nhận { "CC NUMBER", "Current status"?, "Priority"?, "Open day"? }
 *                         Merge (partial update) vào record hiện có rồi ghi lại status.json
 *
 * Biến môi trường cần thiết (Cloudflare Worker → Settings → Variables):
 *   - ALLOWED_ORIGIN  : "https://nguyentan-design.github.io"
 *   - GITHUB_TOKEN    : Personal Access Token (Secret), scope repo / contents:write
 *
 * Các biến GitHub đã hard-code:
 *   OWNER  = "NguyenTan-design"
 *   REPO   = "Call-center-data"
 *   BRANCH = "main"
 *   FILE   = "status.json"
 */

const OWNER  = "NguyenTan-design";
const REPO   = "Call-center-data";
const BRANCH = "main";
const FILE   = "status.json";

export default {
  async fetch(request, env, ctx) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const corsHeaders = buildCorsHeaders(origin);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/statuses" || path === "/status") {
        if (request.method === "GET") {
          return await handleGet(env, corsHeaders);
        }
        if (request.method === "POST") {
          return await handlePost(request, env, corsHeaders);
        }
        return jsonResponse(
          { error: "Method not allowed. Use GET or POST." },
          405,
          corsHeaders
        );
      }

      if (path === "/" || path === "/health") {
        return jsonResponse(
          { ok: true, message: "Call Center Status API is running." },
          200,
          corsHeaders
        );
      }

      return jsonResponse({ error: "Not found" }, 404, corsHeaders);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse(
        { error: err.message || "Internal server error" },
        500,
        corsHeaders
      );
    }
  }
};

// ============================================================
// CORS
// ============================================================
function buildCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

// ============================================================
// GitHub helpers
// ============================================================
function githubHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "call-center-status-worker"
  };
}

function getToken(env) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN environment variable.");
  return token;
}

function fileApiUrl() {
  return (
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/` +
    `${encodeURIComponent(FILE)}?ref=${encodeURIComponent(BRANCH)}`
  );
}

// ============================================================
// GET /statuses
// ============================================================
async function handleGet(env, corsHeaders) {
  const token = getToken(env);

  const res = await fetch(fileApiUrl(), {
    method: "GET",
    headers: githubHeaders(token)
  });

  // File chưa tồn tại → trả về mảng rỗng
  if (res.status === 404) {
    return jsonResponse([], 200, corsHeaders);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return jsonResponse(
      { error: `GitHub GET failed: HTTP ${res.status}`, detail: text },
      502,
      corsHeaders
    );
  }

  const meta = await res.json();
  const raw = atob((meta.content || "").replace(/\n/g, ""));
  const decoded = decodeUtf8(raw);

  let data;
  try {
    data = decoded.trim() ? JSON.parse(decoded) : [];
  } catch (e) {
    return jsonResponse(
      { error: "status.json không phải JSON hợp lệ.", detail: e.message },
      500,
      corsHeaders
    );
  }

  const normalized = normalizeStatusData(data);
  return jsonResponse(normalized, 200, corsHeaders);
}

// ============================================================
// POST /statuses
// Partial update: chỉ merge các field có mặt trong payload.
// ============================================================
async function handlePost(request, env, corsHeaders) {
  const token = getToken(env);

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse(
      { error: "Body không phải JSON hợp lệ." },
      400,
      corsHeaders
    );
  }

  const cc = normalizeCc(payload["CC NUMBER"] ?? payload.ccNumber ?? payload.cc);
  if (!cc) {
    return jsonResponse({ error: "Thiếu CC NUMBER." }, 400, corsHeaders);
  }

  // Chuẩn bị các field có mặt trong payload (partial update).
  const incoming = {};
  let hasAnyField = false;

  if (Object.prototype.hasOwnProperty.call(payload, "Current status")) {
    incoming["Current status"] = String(payload["Current status"] ?? "").trim();
    hasAnyField = true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "Priority")) {
    incoming["Priority"] = String(payload["Priority"] ?? "").trim();
    hasAnyField = true;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "Open day")) {
    const v = payload["Open day"];
    incoming["Open day"] = (v === null || v === "" || isNaN(Number(v)))
      ? null
      : Number(v);
    hasAnyField = true;
  }

  if (!hasAnyField) {
    return jsonResponse(
      { error: "Cần ít nhất 1 field: Current status / Priority / Open day." },
      400,
      corsHeaders
    );
  }

  // 1. Lấy nội dung hiện tại + sha
  const apiUrl = fileApiUrl();

  const getRes = await fetch(apiUrl, {
    method: "GET",
    headers: githubHeaders(token)
  });

  let existingArray = [];
  let sha = null;

  if (getRes.status === 200) {
    const meta = await getRes.json();
    sha = meta.sha;
    const raw = atob((meta.content || "").replace(/\n/g, ""));
    const decoded = decodeUtf8(raw);
    try {
      existingArray = decoded.trim() ? JSON.parse(decoded) : [];
      if (!Array.isArray(existingArray)) existingArray = [];
    } catch (e) {
      existingArray = [];
    }
  } else if (getRes.status !== 404) {
    const text = await getRes.text().catch(() => "");
    return jsonResponse(
      { error: `GitHub GET failed: HTTP ${getRes.status}`, detail: text },
      502,
      corsHeaders
    );
  }

  // 2. Merge partial vào record tương ứng
  const list = existingArray.map(normalizeEntry).filter(Boolean);
  const idx = list.findIndex(e => normalizeCc(e["CC NUMBER"]) === cc);

  if (idx >= 0) {
    Object.assign(list[idx], incoming);
  } else {
    list.push({
      "CC NUMBER": cc,
      "Current status": "",
      "Priority": "",
      "Open day": null,
      ...incoming
    });
  }

  // Sắp xếp theo CC NUMBER (numeric) để dễ đọc
  list.sort((a, b) =>
    String(a["CC NUMBER"]).localeCompare(String(b["CC NUMBER"]), undefined, {
      numeric: true
    })
  );

  // 3. Ghi lại file qua GitHub Contents API (PUT)
  const newContent = JSON.stringify(list, null, 2);
  const contentB64 = encodeBase64Utf8(newContent);

  const putBody = {
    message: `Update status for CC ${cc}`,
    content: contentB64,
    branch: BRANCH
  };
  if (sha) putBody.sha = sha;

  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      ...githubHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(putBody)
  });

  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    return jsonResponse(
      { error: `GitHub PUT failed: HTTP ${putRes.status}`, detail: text },
      502,
      corsHeaders
    );
  }

  // Trả về record đã merge
  const updatedRecord = list.find(e => normalizeCc(e["CC NUMBER"]) === cc);
  return jsonResponse(
    {
      ok: true,
      record: updatedRecord,
      total: list.length
    },
    200,
    corsHeaders
  );
}

// ============================================================
// Helpers
// ============================================================
function normalizeCc(cc) {
  return String(cc ?? "").trim();
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const ccKey = Object.keys(entry).find(k => /cc\s*number/i.test(k));
  if (!ccKey) return null;
  const cc = normalizeCc(entry[ccKey]);
  if (!cc) return null;

  const curKey = Object.keys(entry).find(k => /^current\s*status$/i.test(k));
  const priKey = Object.keys(entry).find(k => /^priority$/i.test(k));
  const opeKey = Object.keys(entry).find(k => /^open\s*day$/i.test(k));

  const openDayRaw = opeKey ? entry[opeKey] : null;
  const openDay =
    openDayRaw === null || openDayRaw === "" || isNaN(Number(openDayRaw))
      ? null
      : Number(openDayRaw);

  return {
    "CC NUMBER": cc,
    "Current status": curKey ? String(entry[curKey] ?? "").trim() : "",
    "Priority":       priKey ? String(entry[priKey] ?? "").trim() : "",
    "Open day":       openDay
  };
}

/**
 * Chuẩn hoá dữ liệu status đọc về:
 *   - Array → giữ nguyên các entry hợp lệ (mỗi entry có đủ 3 field)
 *   - Object map { "<cc>": "<status>" } → chuyển thành mảng (chỉ có Current status)
 */
function normalizeStatusData(data) {
  if (Array.isArray(data)) {
    return data.map(normalizeEntry).filter(Boolean);
  }
  if (data && typeof data === "object") {
    return Object.entries(data)
      .map(([cc, st]) => {
        const key = normalizeCc(cc);
        const val = String(st ?? "").trim();
        if (!key) return null;
        return {
          "CC NUMBER": key,
          "Current status": val,
          "Priority": "",
          "Open day": null
        };
      })
      .filter(Boolean);
  }
  return [];
}

// UTF-8 <-> base64 helpers (Worker không có Buffer, dùng TextEncoder/Decoder)
function decodeUtf8(binaryString) {
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}