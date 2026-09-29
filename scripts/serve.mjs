// Static server for previewing the UI in a browser (demo mode): node scripts/serve.mjs
import { createServer } from "node:http";
import { readFile, copyFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../ui/", import.meta.url));
const port = Number(process.env.PORT) || 5178;
// ?live mode: the debug binary prints one scan as JSON with --dump.
const exe = fileURLToPath(new URL("../src-tauri/target/debug/agent-tally" + (process.platform === "win32" ? ".exe" : ""), import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png" };

createServer(async (req, res) => {
  if (req.url === "/api/snapshot") {
    // Run a copy so the real binary is never locked while cargo rebuilds it.
    const copy = join(tmpdir(), "agent-tally-dump" + extname(exe));
    const [src, dst] = await Promise.all([stat(exe).catch(() => null), stat(copy).catch(() => null)]);
    if (src && (!dst || dst.mtimeMs < src.mtimeMs)) await copyFile(exe, copy).catch(() => {});
    execFile(copy, ["--dump"], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) return res.writeHead(500).end(String(err));
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(stdout);
    });
    return;
  }
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[/\\]+/, "");
  const file = join(root, path || "index.html");
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`AgentTally preview on http://localhost:${port}`));
