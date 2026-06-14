import { useEffect, useState } from 'react';
import { version } from '../../package.json';

export type InstallMode = 'git' | 'npm';

/**
 * PURPOSE: Expose local version metadata without performing any remote release checks.
 */
export const useVersionCheck = () => {
  const [installMode, setInstallMode] = useState<InstallMode>('git');

  useEffect(() => {
    const fetchInstallMode = async () => {
      try {
        const response = await fetch('/health');
        const data = await response.json();
        if (data.installMode === 'npm' || data.installMode === 'git') {
          setInstallMode(data.installMode);
        }
      } catch {
        // Default to git on error
      }
    };
    fetchInstallMode();
  }, []);

  return { currentVersion: version, installMode };
};
