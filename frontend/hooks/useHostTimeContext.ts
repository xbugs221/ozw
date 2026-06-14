/**
 * PURPOSE: Resolve and cache the server-host timezone context so remote
 * browsers render CCUI timestamps with the same timezone as the machine
 * running the app.
 */
import { useEffect, useState } from 'react';
import { api } from '../utils/api';

export type HostTimeContext = {
  timeZone: string | null;
  timezoneAbbreviation: string | null;
  utcOffset: string | null;
  source?: string | null;
};

const DEFAULT_HOST_TIME_CONTEXT: HostTimeContext = {
  timeZone: null,
  timezoneAbbreviation: null,
  utcOffset: null,
  source: null,
};

let cachedHostTimeContext: HostTimeContext | null = null;
let hostTimeContextPromise: Promise<HostTimeContext> | null = null;

async function loadHostTimeContext(): Promise<HostTimeContext> {
  if (cachedHostTimeContext) {
    return cachedHostTimeContext;
  }

  if (!hostTimeContextPromise) {
    hostTimeContextPromise = (async () => {
      const response = await api.settings.timeContext();
      if (!response.ok) {
        throw new Error(`Failed to load host time context: ${response.status}`);
      }

      const payload = await response.json();
      cachedHostTimeContext = {
        timeZone: typeof payload?.timeZone === 'string' && payload.timeZone ? payload.timeZone : null,
        timezoneAbbreviation: typeof payload?.timezoneAbbreviation === 'string' && payload.timezoneAbbreviation
          ? payload.timezoneAbbreviation
          : null,
        utcOffset: typeof payload?.utcOffset === 'string' && payload.utcOffset ? payload.utcOffset : null,
        source: typeof payload?.source === 'string' ? payload.source : null,
      };
      return cachedHostTimeContext;
    })().finally(() => {
      hostTimeContextPromise = null;
    });
  }

  return hostTimeContextPromise;
}

export function useHostTimeContext() {
  /**
   * Keep timestamp formatting deterministic without refetching on every row.
   */
  const [hostTimeContext, setHostTimeContext] = useState<HostTimeContext>(
    cachedHostTimeContext || DEFAULT_HOST_TIME_CONTEXT,
  );

  useEffect(() => {
    let disposed = false;

    loadHostTimeContext()
      .then((payload) => {
        if (!disposed) {
          setHostTimeContext(payload);
        }
      })
      .catch(() => {
        if (!disposed) {
          setHostTimeContext(DEFAULT_HOST_TIME_CONTEXT);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  return hostTimeContext;
}
