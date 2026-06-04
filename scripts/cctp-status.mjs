const env = await loadEnv();

const sourceDomain = env.SOURCE_DOMAIN ?? "6";
const tx = process.argv[2] ?? env.CCTP_SOURCE_TX;
if (!tx) {
  throw new Error("Set CCTP_SOURCE_TX or pass tx hash as first argument");
}

const url = `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${tx}`;
const response = await fetch(url);
const data = await response.json();
const message = data.messages?.[0];

console.log(JSON.stringify({
  tx,
  sourceDomain,
  error: data.error,
  status: message?.status,
  delayReason: message?.delayReason,
  eventNonce: message?.eventNonce,
  cctpVersion: message?.cctpVersion,
  hasMessage: Boolean(message?.message),
  hasAttestation: Boolean(message?.attestation && message.attestation !== "PENDING"),
  message: message?.message ? `${message.message.slice(0, 18)}...` : null,
  attestation: message?.attestation && message.attestation !== "PENDING"
    ? `${message.attestation.slice(0, 18)}...`
    : message?.attestation ?? null,
}, null, 2));

async function loadEnv() {
  const { readFileSync, existsSync } = await import("node:fs");
  if (existsSync(".env")) {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...parts] = trimmed.split("=");
      process.env[key] ??= parts.join("=");
    }
  }
  return process.env;
}
