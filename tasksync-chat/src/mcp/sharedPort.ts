import * as http from 'http';

/** Serves `handler` on `port` as soon as another process releases it; returns a stop function. */
export function listenWhenFree(port: number, handler: http.RequestListener, onListening: (server: http.Server) => void, retryMs: number = 3000): () => void {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    let server: http.Server | undefined;
    const attempt = () => {
        if (stopped) { return; }
        const candidate = http.createServer(handler);
        candidate.once('error', () => {
            candidate.close();
            if (!stopped) { timer = setTimeout(attempt, retryMs); }
        });
        candidate.listen(port, '127.0.0.1', () => {
            if (stopped) { candidate.close(); return; }
            server = candidate;
            onListening(candidate);
        });
    };
    attempt();
    return () => {
        stopped = true;
        if (timer) { clearTimeout(timer); }
        server?.close();
    };
}
