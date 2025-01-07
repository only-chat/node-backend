import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, WsClient, WsClientState } from '../index.js';
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
    it('successfull conversations workflow', async () => {
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

        const conversation2 = {
            id: '2',
            participants: [userName, '1', '2'],
            createdBy: '2',
            createdAt: new Date('2024-01-01'),
        };

        let result1 = await store.saveConversation(conversation1);
        expect(result1._id).toBe('1');
        expect(result1.result).toBe('created');

        let result2 = await store.saveConversation(conversation2);
        expect(result2._id).toBe('2');
        expect(result2.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId }, logger);

        const mockTransport = new MockTransport();

        const client = new WsClient(mockTransport);

        expect(client.state).toBe(WsClientState.None);
        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

        let msg = await Promise.any(mockTransport.sendToClient(data));

        let msgCount = 1;

        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount - 1]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
        expect(msg[msgCount++]).toBe(`{"type":"connection","connectionId":"1","id":"${userName}","conversations":{"conversations":${JSON.stringify([{...conversation2, connected:[]}, {...conversation1, connected:[]}])},"from":0,"size":100,"total":2}}`);
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

        const closeConversationRequest = {
            type: 'close',
            data: {
                conversationId: result1._id,
            }
        };

        data = JSON.stringify(closeConversationRequest);

        msg = await Promise.any(mockTransport.sendToClient(data));

        msgCount++;

        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(msgCount);

        let id = '1';
        const conversationId = '1';
        const connectionId = '1';

        const closedConversationData = { ...closeConversationRequest.data, closedAt: currentTime };

        expect(msg[msgCount - 1]).toBe(`{"type":"closed","data":${JSON.stringify(closedConversationData)}}`);
        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'closed',
            createdAt: currentTime,
            data: closedConversationData,
        });

        let storedConversation = await store.getParticipantConversationById(userName, conversationId);
        expect(storedConversation).toEqual({
            id: conversationId,
            participants: conversation1.participants,
            createdBy: userName,
            createdAt: conversation1.createdAt,
            closedAt: currentTime,
        });

        let storedMessagesCount = 0;
        let storedMessages = await store.findMessages({});
        expect(storedMessages.total).toEqual(storedMessagesCount + 1);
        expect(storedMessages.messages).toHaveLength(storedMessagesCount + 1);
        expect(storedMessages.messages[storedMessagesCount++]).toEqual({
            id,
            connectionId,
            fromId: userName,
            type: 'closed',
            createdAt: currentTime,
            data: closedConversationData,
        });

        const deleteConversationRequest = {
            type: 'delete',
            data: {
                conversationId: result1._id,
            }
        };

        data = JSON.stringify(deleteConversationRequest);

        msg = await Promise.any(mockTransport.sendToClient(data));

        msgCount++;

        expect(msg).toHaveLength(msgCount);

        let deletedConversationData = {
            ...deleteConversationRequest.data,
            closedAt: currentTime,
            deletedAt: currentTime,
            participants: undefined as string[] | undefined
        };

        expect(msg[msgCount - 1]).toBe(`{"type":"deleted","data":${JSON.stringify(deletedConversationData)}}`);
        expect(queueMessages).toHaveLength(queueMessagesCount + 1);

        id = '2'

        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'deleted',
            createdAt: currentTime,
            data: deletedConversationData,
        });

        storedConversation = await store.getParticipantConversationById(userName, conversationId);
        expect(storedConversation).toBeUndefined();

        storedMessagesCount++;
        storedMessages = await store.findMessages({});
        expect(storedMessages.total).toEqual(storedMessagesCount);
        expect(storedMessages.messages).toHaveLength(storedMessagesCount);
        expect(storedMessages.messages[storedMessagesCount - 1]).toEqual({
            id,
            connectionId,
            fromId: userName,
            type: 'deleted',
            createdAt: currentTime,
            data: deletedConversationData,
        });

        deleteConversationRequest.data.conversationId = result2._id;

        data = JSON.stringify(deleteConversationRequest);

        msg = await Promise.any(mockTransport.sendToClient(data));

        msgCount++;

        expect(msg).toHaveLength(msgCount);

        deletedConversationData = { ...deleteConversationRequest.data, closedAt: currentTime, deletedAt: currentTime, participants: ['1', '2'] };

        expect(msg[msgCount - 1]).toBe(`{"type":"updated","data":${JSON.stringify(deletedConversationData)}}`);
        expect(queueMessages).toHaveLength(queueMessagesCount + 1);

        id = '3'

        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'updated',
            createdAt: currentTime,
            data: deletedConversationData,
        });

        storedConversation = await store.getParticipantConversationById(undefined, conversationId);
        expect(storedConversation).toBeUndefined();

        storedMessagesCount++;
        storedMessages = await store.findMessages({});
        expect(storedMessages.total).toEqual(storedMessagesCount);
        expect(storedMessages.messages).toHaveLength(storedMessagesCount);
        expect(storedMessages.messages[storedMessagesCount - 1]).toEqual({
            id,
            connectionId,
            fromId: userName,
            type: 'updated',
            createdAt: currentTime,
            data: deletedConversationData,
        });

        closeConversationRequest.data.conversationId = result2._id;

        data = JSON.stringify(closeConversationRequest);

        const result = await mockTransport.sendToClientToClose(data);

        expect(result.data).toEqual('Failed processRequest. Conversation not found');
        expect(mockTransport.closedByClient).toBeTruthy();
        expect(client.state).toBe(WsClientState.Disconnected);
        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount]).toEqual({
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });
        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        queue.unsubscribe?.(queueCallback);
    });

    it('failed delete conversation workflow', async () => {
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

        const conversation3 = {
            id: '3',
            participants: ['1', '2', '3'],
            createdBy: '2',
            createdAt: new Date('2024-01-03')
        };

        let result3 = await store.saveConversation(conversation3);
        expect(result3._id).toBe('3');
        expect(result3.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId }, logger);

        const mockTransport = new MockTransport();

        const client = new WsClient(mockTransport);

        expect(client.state).toBe(WsClientState.None);
        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        const connectionId = '1';
        const userName = 'test';

        let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

        let msg = await Promise.any(mockTransport.sendToClient(data));

        let msgCount = 1;

        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount - 1]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
        expect(msg[msgCount++]).toBe(`{"type":"connection","connectionId":"1","id":"${userName}","conversations":{"conversations":[],"from":0,"size":100,"total":0}}`);
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

        const deleteConversationRequest = {
            type: 'delete',
            data: {
                conversationId: result3._id,
            }
        };

        data = JSON.stringify(deleteConversationRequest);

        const result = await mockTransport.sendToClientToClose(data);

        expect(result.data).toEqual('Failed processRequest. Conversation not found');
        expect(mockTransport.closedByClient).toBeTruthy();
        expect(client.state).toBe(WsClientState.Disconnected);
        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount]).toEqual({
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });
        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        queue.unsubscribe?.(queueCallback);
    });
});