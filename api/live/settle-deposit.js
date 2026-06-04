import { spawn } from "node:child_process";
import "ethers";
import "@solana/kit";
import "@solana-program/system";
import "@solana-program/token";

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
    const circle = await circleStatus(txHash);
    if (circle.status !== "complete") {
      return response.status(200).json({
        ok: false,
        pending: true,
        status: circle.status ?? "unknown",
        delayReason: circle.delayReason,
      });
    }

    const result = await runRelayer("settle-deposit", txHash);
    return response.status(200).json({
      ok: true,
      command: "settle-deposit",
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

async function circleStatus(txHash) {
  const url = `https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=${txHash}`;
  const response = await fetch(url);
  const data = await response.json();
  return data.messages?.[0] ?? data;
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
