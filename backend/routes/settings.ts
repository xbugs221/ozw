import express from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';

const router = express.Router();
const execFileAsync = promisify(execFile);

/**
 * Build a consistent host-timezone payload for frontend timestamp rendering.
 * The UTC offset is sourced from the host `date` command so remote browsers
 * follow the machine running CCUI instead of the viewer's local timezone.
 */
async function resolveHostTimeContext() {
  const fallbackDate = new Date();
  const fallbackTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  const fallbackOffsetMinutes = -fallbackDate.getTimezoneOffset();

  const toOffsetLabel = (offsetMinutes: number): string => {
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
    const minutes = String(absoluteMinutes % 60).padStart(2, '0');
    return `${sign}${hours}:${minutes}`;
  };

  try {
    const { stdout } = await execFileAsync('date', ['+%Z|%z']);
    const [abbreviationRaw, utcOffsetRaw] = String(stdout || '').trim().split('|');
    const utcOffset = typeof utcOffsetRaw === 'string' && /^[+-]\d{4}$/.test(utcOffsetRaw)
      ? `${utcOffsetRaw.slice(0, 3)}:${utcOffsetRaw.slice(3)}`
      : toOffsetLabel(fallbackOffsetMinutes);

    return {
      timeZone: fallbackTimeZone,
      timezoneAbbreviation: abbreviationRaw || null,
      utcOffset,
      source: 'date-command',
    };
  } catch {
    return {
      timeZone: fallbackTimeZone,
      timezoneAbbreviation: null,
      utcOffset: toOffsetLabel(fallbackOffsetMinutes),
      source: 'node-runtime',
    };
  }
}

router.get('/time-context', async (_req, res) => {
  try {
    const context = await resolveHostTimeContext();
    res.json(context);
  } catch (error) {
    console.error('Error resolving host time context:', error);
    res.status(500).json({ error: 'Failed to resolve host time context' });
  }
});

export default router;
