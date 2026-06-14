/**
 * PURPOSE: Resolve Codex sandbox and approval policy consistently across every
 * backend Codex runtime path.
 */
import {
  CODEX_APPROVAL_POLICY,
  CODEX_SANDBOX_MODE,
} from './constants/config.js';

export type CodexPermissionPolicy = {
  sandboxMode: string;
  approvalPolicy: string;
};

export type CodexPermissionPolicyInput = {
  permissionMode: string;
  highPermissionApproved?: boolean;
};

export function normalizeCodexSandboxMode(value: string): string {
  /**
   * PURPOSE: Normalize configured Codex sandbox mode while preserving the
   * product default of unrestricted local execution.
   */
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') {
    return value;
  }
  return 'danger-full-access';
}

export function normalizeCodexApprovalPolicy(value: string): string {
  /**
   * PURPOSE: Convert configured approval policy into a concrete Codex runtime
   * policy enum.
   */
  if (value === 'untrusted' || value === 'on-request' || value === 'on-failure' || value === 'granular' || value === 'never') {
    return value;
  }
  return 'never';
}

export function resolveCodexPermissionPolicy(input: string | CodexPermissionPolicyInput): CodexPermissionPolicy {
  /**
   * PURPOSE: Map UI permission intent through server-side configuration while
   * keeping ozw's default Codex behavior in full-auto local YOLO mode.
   */
  const permissionMode = typeof input === 'string' ? input : input.permissionMode;
  const configuredSandbox = normalizeCodexSandboxMode(CODEX_SANDBOX_MODE);
  const configuredApprovalPolicy = normalizeCodexApprovalPolicy(CODEX_APPROVAL_POLICY);

  if (permissionMode === 'bypassPermissions') {
    return {
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    };
  }

  return {
    sandboxMode: configuredSandbox,
    approvalPolicy: configuredApprovalPolicy,
  };
}
