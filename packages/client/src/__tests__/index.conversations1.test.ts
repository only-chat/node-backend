import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, TransportState, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeQueue } from '@only-chat/in-memory-queue';
import { initialize as initializeUserStore } from '@only-chat/in-memory-user-store';
import { MockTransport } from '../mocks/mockTransport.js';

import type { Log } from '@only-chat/types/log.js';
import type { Message } from '@only-chat/types/queue.js';
import type { Conversation, MessageStore } from '@only-chat/types/store.js';

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

        const conversation3 = {
            id: '3',
            participants: [userName, '1', '2'],
            createdBy: '2',
            createdAt: new Date('2024-01-01'),
            deletedAt: new Date('2024-01-02'),
        };

        let result1 = await store.saveConversation(conversation1);
        expect(result1._id).toBe('1');
        expect(result1.result).toBe('created');

        let result2 = await store.saveConversation(conversation2);
        expect(result2._id).toBe('2');
        expect(result2.result).toBe('created');

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

        let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

        let msg = await Promise.any(mockTransport.sendToClient(data));

        let msgCount = 1;

        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount - 1]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
        expect(msg[msgCount++]).toBe(`{"type":"connection","connectionId":"1","id":"${userName}","conversations":{"conversations":${JSON.stringify([{ ...conversation2, connected: [] }, { ...conversation1, connected: [] }])},"from":0,"size":100,"total":2}}`);
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

        const loadConversationsRequest = {
            type: 'load',
            data: {}
        };

        data = JSON.stringify(loadConversationsRequest);

        msg = await Promise.any(mockTransport.sendToClient(data));

        msgCount++;

        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(msgCount);

        const loadedConversationsData = { type: 'loaded', conversations: [{ ...conversation2, connected: [] }, { ...conversation1, connected: [] }], count: 2 };

        expect(msg[msgCount - 1]).toBe(JSON.stringify(loadedConversationsData));

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
            closedAt: currentTime as Date | undefined,
            deletedAt: currentTime as Date | undefined,
            updatedAt: undefined as Date | undefined,
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

        deletedConversationData = { ...deleteConversationRequest.data, participants: ['1', '2'], closedAt: undefined, deletedAt: undefined, updatedAt: currentTime };

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

    async function wrongConversationRequest(conversation: Conversation | null, itWrongConversationRequest: (t: MockTransport, s: MessageStore) => Promise<void>) {
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

        if (conversation) {
            const result = await store.saveConversation(conversation);
            expect(result._id).toBe(conversation.id);
            expect(result.result).toBe('created');
        }

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

        let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

        let msg = await Promise.any(mockTransport.sendToClient(data));

        let msgCount = 1;

        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount - 1]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
        if (conversation?.participants.includes(userName)) {
            expect(msg[msgCount++]).toBe(`{"type":"connection","connectionId":"1","id":"${userName}","conversations":{"conversations":[${JSON.stringify(conversation)}],"from":0,"size":100,"total":1}}`);
        } else {
            expect(msg[msgCount++]).toBe(`{"type":"connection","connectionId":"1","id":"${userName}","conversations":{"conversations":[],"from":0,"size":100,"total":0}}`);
        }

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

        await itWrongConversationRequest(mockTransport, store);

        expect(mockTransport.closedByClient).toBeTruthy();
        expect(mockTransport.readyState).toBe(TransportState.CLOSED);

        expect(client.state).toBe(WsClientState.Disconnected);

        expect(queueMessages[queueMessages.length - 1]).toEqual({
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
    }

    it('failed processRequest with an exception', async () => {
        const userName = 'test';

        const conversation = {
            id: '1',
            participants: [userName, '1', '2', '3'],
            createdBy: userName,
            createdAt: new Date('2024-01-03'),
            connected: [],
        };

        await wrongConversationRequest(conversation, async (t, s) => {
            const conversationId = conversation.id;

            const deleteConversationRequest = {
                type: 'delete',
                data: { conversationId }
            };

            const data = JSON.stringify(deleteConversationRequest);

            s.saveConversation = async () => {
                throw new Error('Test exception');
            };

            const result = await t.sendToClientToClose(data);

            expect(result.data).toEqual('Failed processRequest. Test exception');
        });
    });

    it('failed deleting conversation workflow', async () => {
        await wrongConversationRequest(null, async (t) => {
            const deleteConversationRequest = {
                type: 'delete',
                data: { conversationId: '4' }
            };

            const data = JSON.stringify(deleteConversationRequest);

            const result = await t.sendToClientToClose(data);

            expect(result.data).toEqual('Failed processRequest. Conversation not found');
        });
    });

    it('failed deleting conversation workflow (null id)', async () => {
        await wrongConversationRequest(null, async (t) => {
            const deleteConversationRequest = {
                type: 'delete',
                data: { conversationId: null }
            };

            const data = JSON.stringify(deleteConversationRequest);

            const result = await t.sendToClientToClose(data);

            expect(result.data).toEqual('Failed processRequest. Wrong conversation identifier');
        });
    });

    it('leaving after deleting conversation workflow (non creator)', async () => {
        const userName = 'test';

        const participants = ['1', '2', '3'];

        const conversation = {
            id: '1',
            participants: [userName, ...participants],
            createdBy: '1',
            createdAt: new Date('2024-01-03'),
            connected: [],
        };

        await wrongConversationRequest(conversation, async (t, s) => {

            const conversationId = conversation.id;

            const deleteConversationRequest = {
                type: 'delete',
                data: { conversationId }
            };

            const data = JSON.stringify(deleteConversationRequest);

            const msg = await Promise.any(t.sendToClient(data));

            expect(msg).toHaveLength(3);

            expect(msg[2]).toBe(`{"type":"updated","data":{"conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"updatedAt":"${currentTime.toJSON()}"}}`);

            const closeData = await t.closeToClient('stop test');

            expect(closeData).toEqual({
                code: 1000,
                data: 'Stopped',
            });

            const storedMessages = await s.findMessages({});
            expect(storedMessages.total).toEqual(1);
            expect(storedMessages.messages).toHaveLength(1);
            expect(storedMessages.messages[storedMessages.messages.length - 1]).toEqual({
                id: '1',
                connectionId: '1',
                fromId: userName,
                type: 'updated',
                createdAt: currentTime,
                data: {
                    conversationId,
                    participants,
                    updatedAt: currentTime,
                },
            });
        });
    });

    it('failed closing conversation workflow', async () => {
        const userName = 'test';

        const conversation = {
            id: '1',
            participants: [userName, '1', '2', '3'],
            createdBy: userName,
            createdAt: new Date('2024-01-03'),
            connected: [],
        };

        await wrongConversationRequest(conversation, async (t, s) => {

            const conversationId = conversation.id;

            const closeConversationRequest = {
                type: 'close',
                data: { conversationId }
            };

            const saveConversation = s.saveConversation;

            s.saveConversation = async c => {
                c.updatedAt = undefined;

                const r = saveConversation(c);

                if (c.id === conversationId) {
                    return { _id: '', result: 'failed' };
                }

                return r;
            };

            const data = JSON.stringify(closeConversationRequest);

            const result = await t.sendToClientToClose(data);

            expect(result.data).toEqual('Failed processRequest. Close conversation failed');
        });
    });

    it('failed closing conversation workflow (already closed)', async () => {
        const userName = 'test';

        const conversation = {
            id: '1',
            participants: [userName, '1', '2', '3'],
            createdBy: '1',
            createdAt: new Date('2024-01-03'),
            closedAt: new Date('2024-01-04'),
            connected: [],
        };

        await wrongConversationRequest(conversation, async (t) => {

            const conversationId = conversation.id;

            const closeConversationRequest = {
                type: 'close',
                data: { conversationId }
            };

            const data = JSON.stringify(closeConversationRequest);

            const result = await t.sendToClientToClose(data);

            expect(result.data).toEqual('Failed processRequest. Conversation already closed');
        });
    });

    it('failed closing conversation workflow (no rights)', async () => {
        const userName = 'test';

        const conversation = {
            id: '1',
            participants: [userName, '1', '2', '3'],
            createdBy: '1',
            createdAt: new Date('2024-01-03'),
            connected: [],
        };

        await wrongConversationRequest(conversation, async (t) => {

            const conversationId = conversation.id;

            const closeConversationRequest = {
                type: 'close',
                data: { conversationId }
            };

            const data = JSON.stringify(closeConversationRequest);

            const result = await t.sendToClientToClose(data);

            expect(result.data).toEqual('Failed processRequest. User is not allowed to close conversation');
        });
    });

    it('failed updating conversation workflow', async () => {
        const userName = 'test';

        const conversation = {
            id: '1',
            participants: [userName, '1', '2', '3'],
            createdBy: userName,
            createdAt: new Date('2024-01-03'),
            connected: [],
        };

        await wrongConversationRequest(conversation, async (t, s) => {

            const conversationId = conversation.id;

            const saveConversation = s.saveConversation;

            s.saveConversation = async c => {
                c.updatedAt = undefined;

                const r = saveConversation(c);

                if (c.id === conversationId) {
                    return { _id: '', result: 'failed' };
                }

                return r;
            };

            const data = JSON.stringify({
                type: 'update',
                data: {
                    conversationId,
                    title: 'new title',
                    updatedAt: currentTime,
                },
            });

            const result = await t.sendToClientToClose(data);

            expect(result.data).toEqual('Failed processRequest. Update conversation failed');
        });
    });

    it('failed updating conversation workflow (non creator)', async () => {
        const userName = 'test';

        const conversation = {
            id: '1',
            participants: [userName, '1', '2', '3'],
            createdBy: '1',
            createdAt: new Date('2024-01-03'),
            connected: [],
        };

        await wrongConversationRequest(conversation, async (t, s) => {

            const data = JSON.stringify({
                type: 'update',
                data: {
                    conversationId: conversation.id,
                    title: 'new title',
                    updatedAt: currentTime,
                },
            });

            const result = await t.sendToClientToClose(data);

            expect(result.data).toEqual('Failed processRequest. User is not allowed to update conversation');
        });
    });
});