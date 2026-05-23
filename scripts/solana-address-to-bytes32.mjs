const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const alphabetMap = new Map([...alphabet].map((char, index) => [char, BigInt(index)]));

function decodeBase58(input) {
  let value = 0n;
  for (const char of input) {
    const digit = alphabetMap.get(char);
    if (digit === undefined) {
      throw new Error(`invalid base58 character: ${char}`);
    }
    value = value * 58n + digit;
  }

  const bytes = [];
  while (value > 0n) {
    bytes.push(Number(value & 0xffn));
    value >>= 8n;
  }
  bytes.reverse();

  let leadingZeros = 0;
  for (const char of input) {
    if (char !== "1") break;
    leadingZeros++;
  }

  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}

const address = process.argv[2];
if (!address) {
  console.error("Usage: node scripts/solana-address-to-bytes32.mjs <SOLANA_PUBLIC_KEY>");
  process.exit(1);
}

const bytes = decodeBase58(address);
if (bytes.length !== 32) {
  console.error(`Expected 32 bytes, got ${bytes.length}`);
  process.exit(1);
}

console.log(`0x${Buffer.from(bytes).toString("hex")}`);
