import type { WorkerOperation, WorkerRuntime } from './mcpServer';

export type WorkerOperationFacade = {
    [Operation in WorkerOperation]: WorkerRuntime[Operation];
};

export function createWorkerOperationFacade(runtime: WorkerRuntime): WorkerOperationFacade {
    return {
        worker_start: (input) => runtime.worker_start(input),
        worker_submit: (input) => runtime.worker_submit(input),
        worker_list: (input) => runtime.worker_list(input),
        worker_status: (input) => runtime.worker_status(input),
        worker_wait: (input) => runtime.worker_wait(input),
        worker_cancel: (input) => runtime.worker_cancel(input),
        worker_resume: (input) => runtime.worker_resume(input),
        worker_logs: (input) => runtime.worker_logs(input),
    };
}