import crypto from 'crypto';
import { Participant } from '../types.ts';

export interface CryptoDrawResult {
  selectedIndex: number;
  selectedParticipant: Participant;
  entropyProof: {
    algorithm: string;
    timestamp: string;
    pool_size: number;
    csprng_nonce: string;
    merkle_pool_hash: string;
    hmac_digest_prefix: string;
    full_verification_hash: string;
    zero_modulo_bias_rejected_count: number;
  };
}

/**
 * Computes deterministic SHA-256 hash of the entire snapshot candidate pool.
 * Candidates are sorted canonically by ID/Name so independent auditors can
 * verify the fingerprint against the database snapshot.
 */
export function computePoolFingerprint(pool: Participant[]): string {
  const canonicalPool = [...pool].sort((a, b) => {
    const keyA = String(a.id || a.name || '').toLowerCase();
    const keyB = String(b.id || b.name || '').toLowerCase();
    return keyA.localeCompare(keyB);
  });

  const poolJson = JSON.stringify(
    canonicalPool.map((p) => ({
      id: p.id ? String(p.id).trim().toLowerCase() : '',
      name: p.name.trim().toLowerCase(),
      type: p.type.toLowerCase(),
      eligible: p.eligible,
    }))
  );
  return crypto.createHash('sha256').update(poolJson).digest('hex');
}

/**
 * Executes zero-modulo-bias rejection sampling over HMAC-SHA512 stream.
 * Selects exactly one candidate with uniform 1/N probability.
 */
export function selectCandidateCryptographically(
  pool: Participant[],
  secretKey: string,
  lastActionHash: string = ''
): CryptoDrawResult {
  if (!pool || pool.length === 0) {
    throw new Error('EMPTY_POOL: Cannot select candidate from an empty pool.');
  }

  const effectiveKey = secretKey || 'duet-cse-fest-2026-crypto-salt';

  if (pool.length === 1) {
    return {
      selectedIndex: 0,
      selectedParticipant: pool[0],
      entropyProof: {
        algorithm: 'HMAC-SHA512-BIAS-FREE-REJECTION-SAMPLING-V1',
        timestamp: new Date().toISOString(),
        pool_size: 1,
        csprng_nonce: 'singleton_pool',
        merkle_pool_hash: computePoolFingerprint(pool),
        hmac_digest_prefix: 'singleton',
        full_verification_hash: 'singleton',
        zero_modulo_bias_rejected_count: 0,
      },
    };
  }

  const poolSize = BigInt(pool.length);
  const poolFingerprint = computePoolFingerprint(pool);

  // 5 Sources of Entropy
  const csprngBytes = crypto.randomBytes(32);
  const hrtime = process.hrtime.bigint().toString();
  const timestamp = Date.now().toString();
  const sessionSalt = lastActionHash || crypto.randomBytes(16).toString('hex');

  const entropyPayload = Buffer.concat([
    csprngBytes,
    Buffer.from(`::${hrtime}::${timestamp}::${poolFingerprint}::${sessionSalt}`),
  ]);

  // HMAC-SHA512 distillation
  const hmac = crypto.createHmac('sha512', effectiveKey);
  hmac.update(entropyPayload);
  const digestBuffer = hmac.digest(); // 64 bytes

  // 64-bit rejection sampling to completely eliminate modulo bias
  const TWO_POW_64 = 18446744073709551616n; // 2^64
  const remainder = TWO_POW_64 % poolSize;
  const maxUnbiased = TWO_POW_64 - remainder; // Values >= maxUnbiased are rejected

  let selectedIndex = -1;
  let rejectedCount = 0;
  let offset = 0;
  let workingBuffer = digestBuffer;

  while (selectedIndex === -1) {
    // Read 8 bytes as big-endian uint64
    if (offset + 8 > workingBuffer.length) {
      // Re-hash to produce next stream of unbiased entropy
      workingBuffer = crypto
        .createHmac('sha512', effectiveKey)
        .update(Buffer.concat([workingBuffer, Buffer.from(`_iter_${rejectedCount}`)]))
        .digest();
      offset = 0;
    }

    const value = workingBuffer.readBigUInt64BE(offset);
    offset += 8;

    if (value < maxUnbiased) {
      selectedIndex = Number(value % poolSize);
    } else {
      rejectedCount++;
    }
  }

  const fullProofHash = crypto
    .createHash('sha256')
    .update(
      `${digestBuffer.toString('hex')}::idx=${selectedIndex}::candidate=${pool[selectedIndex].name}::roll=${pool[selectedIndex].id}`
    )
    .digest('hex');

  return {
    selectedIndex,
    selectedParticipant: pool[selectedIndex],
    entropyProof: {
      algorithm: 'HMAC-SHA512-BIAS-FREE-REJECTION-SAMPLING-V1',
      timestamp: new Date().toISOString(),
      pool_size: pool.length,
      csprng_nonce: csprngBytes.toString('hex'),
      merkle_pool_hash: poolFingerprint,
      hmac_digest_prefix: digestBuffer.slice(0, 16).toString('hex'),
      full_verification_hash: fullProofHash,
      zero_modulo_bias_rejected_count: rejectedCount,
    },
  };
}
