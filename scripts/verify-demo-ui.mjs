import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-chromium";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(rootDir, "demo-dist");
const port = Number(process.env.VERIFY_DEMO_UI_PORT ?? 4184);

if (!existsSync(join(publicDir, "index.html"))) {
  throw new Error("demo-dist/index.html is missing. Run npm run build first.");
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const absolute = normalize(join(publicDir, requested));
  if (!absolute.startsWith(publicDir) || !existsSync(absolute)) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  response.writeHead(200, { "content-type": contentType(absolute) });
  createReadStream(absolute).pipe(response);
});

await listen(server, port);

try {
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyViewport(browser, "desktop", { width: 1440, height: 1600 });
    await verifyViewport(browser, "mobile", { width: 390, height: 1200, isMobile: true });
  } finally {
    await browser.close();
  }
  console.log("demo UI verification passed");
} finally {
  server.close();
}

async function verifyViewport(browser, label, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://localhost:${port}`, { waitUntil: "networkidle" });
  const text = (await page.locator("body").innerText()).toLowerCase();
  const required = [
    "Approve",
    "Buy",
    "Claim",
    "Redeem",
    "NAV",
    "Base",
    "CCTP",
    "Solana",
    "Messages",
    "Basket",
    "Vault",
    "Session tx",
  ];
  const missing = required.filter((phrase) => !text.includes(phrase.toLowerCase()));
  if (missing.length) {
    throw new Error(`${label} missing required text: ${missing.join(", ")}`);
  }
  const buttons = await page.locator("button:visible").count();
  const links = await page.locator("a[href^='https://']:visible").count();
  if (buttons !== 6) throw new Error(`${label} expected wallet, clear, plus four user actions, found ${buttons}`);
  if (links < 5) throw new Error(`${label} expected deployed contract/program/state links, found ${links}`);
  await page.screenshot({ path: join(rootDir, "demo-ui", `${label}-verify.png`), fullPage: true });
  await page.close();
}

function listen(server, listenPort) {
  return new Promise((resolveListen) => {
    server.listen(listenPort, resolveListen);
  });
}

function contentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
  }[extname(path)] ?? "application/octet-stream";
}
