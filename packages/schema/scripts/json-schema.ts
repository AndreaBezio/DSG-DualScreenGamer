// Writes JSON Schemas for editors (yaml-language-server) and external tools.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { GameManifest, ModManifest } from '../src/index.ts';

const out = fileURLToPath(new URL('../../../registry/schema/', import.meta.url));
mkdirSync(out, { recursive: true });
for (const [name, schema] of [['mod', ModManifest], ['game', GameManifest]] as const) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  writeFileSync(`${out}${name}.schema.json`, JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote registry/schema/${name}.schema.json`);
}
