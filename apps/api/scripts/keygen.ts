// Prints a new Ed25519 key pair for INDEX_SIGNING_KEY. Keep the private key secret; publish nothing:
// the API serves the public key at /v1/keys.json.
import { generateKeyPairSync } from 'node:crypto';
import { signerFromPem } from '../src/signing.ts';

const { privateKey } = generateKeyPairSync('ed25519');
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const signer = signerFromPem(pem);
console.log('# Add to .env (one line):');
console.log(`INDEX_SIGNING_KEY="${pem.trim().replace(/\n/g, '\\n')}"`);
console.log(`\n# Key id ${signer.keyId}, public key (base64): ${signer.publicKey}`);
