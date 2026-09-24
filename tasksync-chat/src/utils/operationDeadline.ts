export class OperationTimeoutError extends Error {
    constructor(operation: string, timeoutMs: number) {
        super(`${operation} timed out after ${Math.ceil(timeoutMs / 1000)} seconds`);
        this.name = 'OperationTimeoutError';
    }
}

export function withTimeout<T>(operation: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return operation;
    }

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new OperationTimeoutError(operationName, timeoutMs)), timeoutMs);
        operation.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}