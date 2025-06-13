import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, TransportState, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeQueue } from '@only-chat/in-memory-queue';
import { initialize as initializeUserStore } from '@only-chat/in-memory-user-store';
import { MockTransport } from '../mocks/mockTransport.js';

import type { Log } from '@only-chat/types/log.js';
import type { Message } from '@only-chat/types/queue.js';

const logger: Log | undefined = undefined;

const currentTime = new Date('2024-08-01T00:00:00.000Z');
jest.useFakeTimers().setSystemTime(currentTime);

describe('client', () => {
    it('successfull watch workflow', async () => {
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

        const conversation1 = {
            id: '1',
            participants: [userName, '1', '2'],
            createdBy: userName,
            createdAt: new Date('2024-01-01'),
        };

        let result1 = await store.saveConversation(conversation1);
        expect(result1._id).toBe('1');
        expect(result1.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId }, logger);

        const mockTransport = new MockTransport();

        const client = new WsClient(mockTransport);

        expect(client.state).toBe(WsClientState.None);

        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

        let msg = await Promise.any(mockTransport.sendToClient(data));

        let msgCount = 1;

        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount - 1]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
        expect(msg[msgCount++]).toBe(`{"type":"connection","connectionId":"1","id":"${userName}","conversations":{"conversations":[${JSON.stringify({ ...conversation1, connected: [] })}],"from":0,"size":100,"total":1}}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            instanceId: instanceId,
            connectionId: '1',
            fromId: userName,
            type: 'connected',
            createdAt: currentTime,
            data: null,
        });

        expect(WsClient.connectedClients.size).toBe(1);
        expect(WsClient.connectedClients.has(userName)).toBeTruthy();

        data = JSON.stringify({
            type: 'watch',
        });

        msg = await Promise.any(mockTransport.sendToClient(data));

        expect(client.state).toBe(WsClientState.WatchSession);
        expect(msg).toHaveLength(msgCount + 1);

        const connectionId = '1';

        expect(msg[msgCount++]).toBe(`{"type":"watching","conversations":{"conversations":[],"from":0,"size":0,"total":1}}`);

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.watchers.size).toBe(1);
        expect(WsClient.conversations.size).toBe(0);

        const disconnectedPromise = new Promise(resolve => {
            disconnectedResolve = resolve;
        });

        const closeData = await mockTransport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
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