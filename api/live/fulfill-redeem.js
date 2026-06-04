import { spawn } from "node:child_process";
import "ethers";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const body = parseBody(request.body);
  const txHash = body?.txHash;
  if (!txHash || typeof txHash !== "string") {
    return response.status(400).json({ error: "Missing txHash" });
  }

  try {
    const result = await runRelayer("fulfill-redeem", txHash);
    return response.status(200).json({
      ok: true,
      command: "fulfill-redeem",
      result,
    });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}

function parseBody(body) {
  if (!body || typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function runRelayer(command, txHash) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/omnietf-live-relayer.mjs", command, "--tx", txHash], {
      cwd: process.cwd(),
      env: process.env,
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, 285_000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(output.slice(-2_000) || `${command} failed`));
      try {
        resolve(JSON.parse(output.slice(output.indexOf("{"))));
      } catch {
        reject(new Error(output.slice(-2_000) || `Could not parse ${command} output`));
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
