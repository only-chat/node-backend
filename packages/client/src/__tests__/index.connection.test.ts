import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeQueue } from '@only-chat/in-memory-queue';
import { MockTransport } from '../mocks/mockTransport.js';

import type { StoreAuthenticationInfo } from '@only-chat/in-memory-user-store';

const currentTime = new Date('2024-08-01T00:00:00.000Z');
jest.useFakeTimers().setSystemTime(currentTime);

async function wrongConnectionRequest(itConnectionRequest: (t: MockTransport) => Promise<void>) {
    const queue = await initializeQueue();

    const store = await initializeStore();

    store.saveConnection = async m => ({ _id: '', result: 'failed' });

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
                data: 'Failed message processing. Unexpected end of JSON input',
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
});