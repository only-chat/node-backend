import { EventEmitter } from 'events';
import { TransportState } from '../index.js';

import type { Transport } from '@only-chat/types/transport.js';

export class MockTransport implements Transport {
    private sentMessages: string[] = [];
    private messageListeners: ((...args: any[]) => void)[] = [];
    private closeListeners: ((...args: any[]) => void)[] = [];
    public readyState:
        | typeof TransportState.CONNECTING
        | typeof TransportState.OPEN
        | typeof TransportState.CLOSING
        | typeof TransportState.CLOSED = TransportState.CLOSED;

    public closedByClient?: boolean;

    public closeResolve: ((data: { code?: number, data?: string | Buffer }) => void) | undefined;
    public closeReject: () => void = () => { };

    public resolve1: ((msg: string[]) => void) | undefined;
    public reject1: () => void = () => { };

    public resolve2: ((msg: string[]) => void) | undefined;
    public reject2: () => void = () => { };

    constructor() {
        this.readyState = TransportState.OPEN
    }

    private getMessages(): Promise<string[]>[] {
        return [new Promise<string[]>((resolve, reject) => {
            this.resolve1 = resolve;
            this.reject1 = reject;
        }), new Promise<string[]>((resolve, reject) => {
            this.resolve2 = resolve;
            this.reject2 = reject;
        })];
    }

    sendToClient(data: string): Promise<string[]>[] {
        if (this.closedByClient || this.readyState !== TransportState.OPEN) {
            throw new Error('Method not implemented.');
        }

        const p = this.getMessages();
        this.messageListeners.forEach(l => l(Buffer.from(data), false));
        return p;
    }

    closeToClient(data?: string): Promise<{ code?: number, data?: string | Buffer }> {
        const p = new Promise<{ code?: number, data?: string | Buffer }>((resolve, reject) => {
            this.closeResolve = resolve;
            this.closeReject = reject;
        });

        this.closeListeners.forEach(l => l(data, false));
        this.closeListeners = [];
        this.readyState = TransportState.CLOSED;
        return p;
    };

    close(code?: number, data?: string | Buffer): void {
        this.closedByClient = true;
        if (this.closeResolve) {
            this.closeResolve({ code, data });
            this.closeResolve = undefined;
        }
    };

    send(data: string, options: { binary?: boolean | undefined; fin?: boolean | undefined; }): void {
        if (this.readyState !== TransportState.OPEN) {
            throw new Error('Method not implemented.');
        }

        this.sentMessages.push(data);
        if (this.resolve1) {
            this.resolve1(this.sentMessages);
            this.resolve1 = undefined;
        } else if (this.resolve2) {
            this.resolve2(this.sentMessages);
            this.resolve2 = undefined;
        }
    };

    [EventEmitter.captureRejectionSymbol]?<K>(error: Error, event: string | symbol, ...args: any[]): void {
        throw new Error('Method not implemented.');
    }
    addListener<K>(eventName: string | symbol, listener: (...args: any[]) => void): this {
        throw new Error('Method not implemented.');
    }
    on<K>(eventName: string | symbol, listener: (...args: any[]) => void): this {

        switch (eventName) {
            case 'message':
                this.messageListeners.push(listener);
                return this;
        }

        throw new Error('Method not implemented.');
    }
    once<K>(eventName: string | symbol, listener: (...args: any[]) => void): this {
        switch (eventName) {
            case 'close':
                this.closeListeners.push(listener);
                return this;
        }
        throw new Error('Method not implemented.');
    }
    removeListener<K>(eventName: string | symbol, listener: (...args: any[]) => void): this {
        throw new Error('Method not implemented.');
    }
    off<K>(eventName: string | symbol, listener: (...args: any[]) => void): this {
        throw new Error('Method not implemented.');
    }
    removeAllListeners(eventName?: string | symbol | undefined): this {
        this.messageListeners = [];
        this.closeListeners = [];
        return this;
    }
    setMaxListeners(n: number): this {
        throw new Error('Method not implemented.');
    }
    getMaxListeners(): number {
        throw new Error('Method not implemented.');
    }
    listeners<K>(eventName: string | symbol): Array<Function> {
        throw new Error('Method not implemented.');
    }
    rawListeners<K>(eventName: string | symbol): Array<Function> {
        throw new Error('Method not implemented.');
    }
    emit<K>(eventName: string | symbol, ...args: any[]): boolean {
        throw new Error('Method not implemented.');
    }
    listenerCount<K>(eventName: string | symbol, listener?: Function | undefined): number {
        throw new Error('Method not implemented.');
    }
    prependListener<K>(eventName: string | symbol, listener: (...args: any[]) => void): this {
        throw new Error('Method not implemented.');
    }
    prependOnceListener<K>(eventName: string | symbol, listener: (...args: any[]) => void): this {
        throw new Error('Method not implemented.');
    }
    eventNames(): Array<(string | symbol) & (string | symbol)> {
        throw new Error('Method not implemented.');
    }
};
