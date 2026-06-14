/**
 * PURPOSE: Store one-time clone progress jobs so credential-bearing data never
 * has to travel through an SSE URL.
 */
import { randomUUID } from 'crypto';

const CLONE_JOB_TTL_MS = 5 * 60 * 1000;

interface CloneProgressJobPayload {
  path: string;
  githubUrl: string;
  githubTokenId?: string | number | null;
  newGithubToken?: string | null;
}

interface CloneProgressJob extends CloneProgressJobPayload {
  userId: number;
  expiresAt: number;
}

const cloneProgressJobs = new Map<string, CloneProgressJob>();

function createCloneProgressJob(userId: number, payload: CloneProgressJobPayload): string {
  /**
   * PURPOSE: Keep one-time clone credentials server-side behind an opaque id.
   */
  const jobId = randomUUID();
  cloneProgressJobs.set(jobId, {
    ...payload,
    userId,
    expiresAt: Date.now() + CLONE_JOB_TTL_MS,
  });

  const cleanupTimer = setTimeout(() => {
    cloneProgressJobs.delete(jobId);
  }, CLONE_JOB_TTL_MS);
  cleanupTimer.unref?.();

  return jobId;
}

function consumeCloneProgressJob(jobId: string, userId: number): CloneProgressJob | null {
  /**
   * PURPOSE: Return a pending job only for its owner, then remove it.
   */
  const job = cloneProgressJobs.get(jobId);
  cloneProgressJobs.delete(jobId);

  if (!job || job.userId !== userId || job.expiresAt < Date.now()) {
    return null;
  }

  return job;
}

export {
  type CloneProgressJob,
  type CloneProgressJobPayload,
  createCloneProgressJob,
  consumeCloneProgressJob,
};
