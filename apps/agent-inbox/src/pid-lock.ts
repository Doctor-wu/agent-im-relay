import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquirePidLock(pidsDir: string, platform: string): Promise<boolean> {
  await mkdir(pidsDir, { recursive: true });
  const pidFile = join(pidsDir, `${platform}.pid`);

  try {
    const existingPid = Number.parseInt(await readFile(pidFile, 'utf-8'), 10);
    if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
      return false;
    }
  } catch {
    // PID file doesn't exist or can't be read — fine, proceed
  }

  await writeFile(pidFile, String(process.pid), 'utf-8');
  return true;
}

export function registerPidCleanup(pidsDir: string, platform: string): void {
  const pidFile = join(pidsDir, `${platform}.pid`);

  const cleanup = () => {
    try {
      const { unlinkSync } = require('node:fs');
      unlinkSync(pidFile);
    } catch {
      // best-effort cleanup
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}

export async function releasePidLock(pidsDir: string, platform: string): Promise<void> {
  const pidFile = join(pidsDir, `${platform}.pid`);
  try {
    await unlink(pidFile);
  } catch {
    // already gone
  }
}
