import { EventEmitter } from 'events'

export declare enum TransportState {
    /** The connection is not yet open. */
    CONNECTING = 0,
    /** The connection is open and ready to communicate. */
    OPEN = 1,
    /** The connection is in the process of closing. */
    CLOSING = 2,
    /** The connection is closed. */
    CLOSED = 3
}

export interface Transport extends EventEmitter {
    readonly readyState: TransportState

    close(code?: number, data?: string | Buffer): void
    send(data: string, options: {
        binary?: boolean | undefined
        fin?: boolean | undefined
    },): void
}