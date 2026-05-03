/**
 * Cross-platform first-run environment setup script.
 *
 * Copies .env.example → .env.local and .dev.vars.example → .dev.vars
 * if those files do not already exist. Works on all platforms (macOS,
 * Linux, Windows) without relying on POSIX shell built-ins.
 *
 * Called by `deno task setup`.
 */

import { copy, exists } from 'jsr:@std/fs@^1.0.0';

async function copyIfMissing(src: string, dest: string): Promise<void> {
    if (await exists(dest)) {
        console.log(`  ✔  ${dest} already exists — skipping`);
        return;
    }
    if (!(await exists(src))) {
        console.warn(`  ⚠  Template not found: ${src} — skipping`);
        return;
    }
    await copy(src, dest);
    console.log(`  ✔  Created ${dest} from ${src}`);
}

console.log('🚀 Setting up bloqr-backend...');
await copyIfMissing('.env.example', '.env.local');
await copyIfMissing('.dev.vars.example', '.dev.vars');
console.log('✅ Env files ready. Edit .env.local and .dev.vars with your credentials.');
