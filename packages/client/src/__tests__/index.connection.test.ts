import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, TransportState, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeQueue } from '@only-chat/in-memory-queue';
import { Log } from '@only-chat/types/log.js';
import { MockTransport } from '../mocks/mockTransport.js';

import type { Message } from '@only-chat/types/queue.js';
import type { StoreAuthenticationInfo } from '@only-chat/in-memory-user-store';

const logger: Log | undefined = {
    debug: function (message?: any, ...optionalParams: any[]): void {
    },
    error: function (message?: any, ...optionalParams: any[]): void {
    },
    info: function (message?: any, ...optionalParams: any[]): void {
    },
    log: function (message?: any, ...optionalParams: any[]): void {
    },
    trace: function (message?: any, ...optionalParams: any[]): void {
    },
    warn: function (message?: any, ...optionalParams: any[]): void {
    }
};

const currentTime = new Date('2024-08-01T00:00:00.000Z');
jest.useFakeTimers().setSystemTime(currentTime);

async function wrongConnectionRequest(itConnectionRequest: (t: MockTransport) => Promise<void>) {
    const queue = await initializeQueue();

    const store = await initializeStore();

    store.saveConnection = async (userId, instanceId) => ({ _id: '', result: 'failed' });

    const userStore = {
        async authenticate(a: StoreAuthenticationInfo) {
            if (a.name !== 'test') {
                throw Error();
            }

            return a.name;
        }
    };

    const response = await saveInstance();

    const instanceId = response._id;

    initializeClient({ queue, store, userStore, instanceId }, logger);

    const mockTransport = new MockTransport();

    const client = new WsClient(mockTransport);

    expect(client.state).toBe(WsClientState.None);
    expect(WsClient.connectedClients.size).toBe(0);

    await itConnectionRequest(mockTransport);

    expect(mockTransport.closedByClient).toBeTruthy();
    expect(client.state).toBe(WsClientState.Disconnected);
    expect(WsClient.connectedClients.size).toBe(0);
}

describe('client', () => {
    it('wrong connection', async () => {
        await wrongConnectionRequest(async (t) => {
            const data = JSON.stringify(null);

            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1000,
                data: 'Failed connect',
            });
        });

        await wrongConnectionRequest(async (t) => {
            const data = JSON.stringify({ authInfo: {} });
            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1011,
                data: 'Failed connect',
            });
        });

        await wrongConnectionRequest(async (t) => {
            const data = '{}';

            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1000,
                data: 'Failed connect. Authentication failed',
            });
        });

        await wrongConnectionRequest(async (t) => {
            const data = '[';

            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1011,
                data: 'Failed processing message. Unexpected end of JSON input',
            });
        });

        await wrongConnectionRequest(async (t) => {
            const userName = 'test';
            const data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1000,
                data: 'Failed connect',
            });
        });
    });

    it('wrong transport state', async () => {
        const queue = await initializeQueue();

        let disconnectedResolve: ((value: Message) => void) | undefined;

        const queueMessages: Message[] = [];
        async function queueCallback(msg: Message) {
            queueMessages.push(msg);

            if (disconnectedResolve && 'disconnected' === msg.type) {
                disconnectedResolve(msg);
            }
        }

        queue.subscribe(queueCallback);

        const store = await initializeStore();

        const userStore = {
            async authenticate(a: StoreAuthenticationInfo) {
                if (a.name !== 'test') {
                    throw Error();
                }

                return a.name;
            }
        };

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId });

        const mockTransport = new MockTransport();

        const client = new WsClient(mockTransport);

        expect(client.state).toBe(WsClientState.None);
        expect(WsClient.connectedClients.size).toBe(0);

        const userName = 'test';
        const data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

        mockTransport.readyState = TransportState.CLOSING;

        const disconnectedPromise = new Promise(resolve => {
            disconnectedResolve = resolve;
        });

        const result = await mockTransport.sendToClientToClose(data);

        expect(result).toEqual({
            code: -1,
            data: 'Wrong transport state',
        });

        expect(mockTransport.closedByClient).toBeUndefined();

        const disconnectedMessage = await disconnectedPromise;

        const connectionId = '1';

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(client.state).toBe(WsClientState.Disconnected);
        expect(WsClient.connectedClients.size).toBe(0);
    });

    it('failed session', async () => {
        const queue = await initializeQueue();

        let disconnectedResolve: ((value: Message) => void) | undefined;

        let queueMessagesCount = 0;
        const queueMessages: Message[] = [];
        async function queueCallback(msg: Message) {
            queueMessages.push(msg);

            if (disconnectedResolve && 'disconnected' === msg.type) {
                disconnectedResolve(msg);
            }
        }

        queue.subscribe(queueCallback);

        const store = await initializeStore();

        const userName = 'test';

        const userStore = {
            async authenticate(a: StoreAuthenticationInfo) {
                if (a.name !== 'test') {
                    throw Error();
                }

                return a.name;
            }
        };

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId });

        const mockTransport = new MockTransport();

        const client = new WsClient(mockTransport);

        expect(client.state).toBe(WsClientState.None);

        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

        let msg = await Promise.any(mockTransport.sendToClient(data));

        let msgCount = 1;

        const connectionId = '1';

        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount - 1]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
        expect(msg[msgCount++]).toBe(`{"type":"connection","connectionId":"${connectionId}","id":"${userName}","conversations":{"conversations":[],"from":0,"size":100,"total":0}}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'connected',
            createdAt: currentTime,
            data: null,
        });

        expect(WsClient.connectedClients.size).toBe(1);
        expect(WsClient.connectedClients.has(userName)).toBeTruthy();

        data = JSON.stringify({
            type: 'wrong',
        });

        const disconnectedPromise = new Promise(resolve => {
            disconnectedResolve = resolve;
        });

        const result = await mockTransport.sendToClientToClose(data);

        expect(result).toEqual({
            code: 1011,
            data: 'Failed processing message. Wrong request type',
        });

        expect(mockTransport.closedByClient).toBeTruthy();
        expect(mockTransport.readyState).toBe(TransportState.CLOSED);

        const disconnectedMessage = await disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(client.state).toBe(WsClientState.Disconnected);

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        queue.unsubscribe?.(queueCallback);
    });
});