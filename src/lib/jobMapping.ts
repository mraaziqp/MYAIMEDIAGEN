import { CloudJob, StreamProgressEvent } from '../types';

/**
 * "Waiting for your PC to pick this up..." was shown for every queued job, which reads the
 * same whether the worker is seconds away or switched off - the single most common reason a
 * render appears to hang. GET /api/jobs/:id now returns queue depth and worker liveness for
 * queued rows, so the wait can be described honestly.
 */
function queuedLabel(job: CloudJob): string {
  if (job.workerOnline === false) {
    return 'Your PC is offline - this will start as soon as the worker is running';
  }
  if (typeof job.queuePosition === 'number' && job.queuePosition > 0) {
    return `Queued behind ${job.queuePosition} other job${job.queuePosition === 1 ? '' : 's'}`;
  }
  return 'Next up - waiting for your PC to claim this';
}

/**
 * ProgressViewer.tsx's rendering logic was built against StreamProgressEvent (the old SSE
 * payload shape) and that shape survives almost field-for-field in CloudJob - this just
 * bridges the one real difference (`id` vs `promptId`) so the component didn't need a
 * rewrite, only its data source (poll GET /api/jobs/:id instead of an EventSource) did.
 */
export function jobToProgressEvent(job: CloudJob): StreamProgressEvent {
  return {
    promptId: job.id,
    status: job.status === 'queued' || job.status === 'claimed' ? 'processing' : job.status,
    percentage: job.percentage,
    phase: job.phase ?? undefined,
    queuePosition: job.queuePosition,
    workerOnline: job.workerOnline,
    step: job.step ?? undefined,
    maxSteps: job.maxSteps ?? undefined,
    node: job.node ?? undefined,
    nodeTitle: job.nodeTitle ?? (job.status === 'queued' ? queuedLabel(job) : undefined),
    etaSeconds: job.etaSeconds ?? undefined,
    elapsedMs: job.elapsedMs ?? undefined,
    vramCurrentMb: job.vramCurrentMb ?? undefined,
    vramPeakMb: job.vramPeakMb ?? undefined,
    mediaUrl: job.mediaUrl ?? undefined,
    durationMs: job.durationMs || undefined,
    error: job.error ?? undefined,
  };
}
