// Ed25519 signatures for the offline indexes, so clients can trust a cached or mirrored copy.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

export type Signer = {
  keyId: string;
  /** base64 signature of the exact UTF-8 bytes of body */
  sign(body: string): string;
  publicKeyPem: string;
  /** Raw 32-byte public key, base64 */
  publicKey: string;
};

/** Accepts a PEM private key, also with literal "\n" (as env files often hold it). */
export function signerFromPem(pem: string): Signer {
  const key = createPrivateKey(pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('INDEX_SIGNING_KEY must be an Ed25519 private key');
  const pub = createPublicKey(key);
  const raw = (pub.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);
  return {
    keyId: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    sign: (body) => sign(null, Buffer.from(body, 'utf8'), key).toString('base64'),
    publicKeyPem: pub.export({ format: 'pem', type: 'spki' }).toString(),
    publicKey: raw.toString('base64'),
  };
}
