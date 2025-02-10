import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeQueue } from '@only-chat/in-memory-queue';
import { MockTransport } from '../mocks/mockTransport.js';

import type { UserStore } from '@only-chat/types';

const currentTime = new Date('2024-08-01T00:00:00.000Z');
jest.useFakeTimers().setSystemTime(currentTime);

async function wrongConnectionRequest(itConnectionRequest: (t: MockTransport) => Promise<void>) {
    const queue = await initializeQueue();

    const store = await initializeStore();

    const userStore = {
        async authenticate(_: UserStore.AuthenticationInfo) {
            throw Error();
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
    });
});