import { CloudJob, StreamProgressEvent } from '../types';

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
    step: job.step ?? undefined,
    maxSteps: job.maxSteps ?? undefined,
    node: job.node ?? undefined,
    nodeTitle: job.nodeTitle ?? (job.status === 'queued' ? 'Waiting for your PC to pick this up...' : undefined),
    etaSeconds: job.etaSeconds ?? undefined,
    elapsedMs: job.elapsedMs ?? undefined,
    vramCurrentMb: job.vramCurrentMb ?? undefined,
    vramPeakMb: job.vramPeakMb ?? undefined,
    mediaUrl: job.mediaUrl ?? undefined,
    durationMs: job.durationMs || undefined,
    error: job.error ?? undefined,
  };
}
