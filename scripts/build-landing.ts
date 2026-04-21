import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { landingPageHtml } from '../src/landing';

const outDir = resolve(process.cwd(), 'dist', 'landing');
const outFile = resolve(outDir, 'index.html');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, landingPageHtml(), 'utf8');

console.log(`Wrote ${outFile}`);
