import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, TransportState, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeQueue } from '@only-chat/in-memory-queue';
import { initialize as initializeUserStore } from '@only-chat/in-memory-user-store';
import { MockTransport } from '../mocks/mockTransport.js';

import type { Message, MessageQueue } from '@only-chat/types/queue.js';
import type { Conversation } from '@only-chat/types/store.js';

const currentTime = new Date('2024-08-01T00:00:00.000Z');
const jsonCurrentTime = currentTime.toJSON();
jest.useFakeTimers().setSystemTime(currentTime);

async function createConversationClient(instanceId: string, connectionId: string, userName: string, conversation: Conversation, connected: string[], disconnect: string[], joinedId: string, queue: MessageQueue) {

    let disconnectedResolve: ((value: Message) => void) | undefined;

    const disconnectedPromise = new Promise(resolve => {
        disconnectedResolve = resolve;
    });

    const queueMessages: Message[] = [];

    async function queueCallback(msg: Message) {
        if (connectionId !== msg.connectionId) {
            return;
        }

        queueMessages.push(msg);

        if (disconnectedResolve && 'disconnected' === msg.type) {
            disconnectedResolve(msg);
            disconnectedResolve = undefined
        }
    }

    queue.subscribe(queueCallback);

    const mockTransport = new MockTransport();
    const client = new WsClient(mockTransport);

    expect(client.state).toBe(WsClientState.None);

    let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

    let msg = await Promise.any(mockTransport.sendToClient(data));

    expect(client.state).toBe(WsClientState.Connected);
    expect(msg).toHaveLength(2);
    expect(msg[0]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
    expect(msg[1]).toBe(`{"type":"connection","connectionId":"${connectionId}","id":"${userName}","conversations":{"conversations":[${JSON.stringify({ conversation, connected })}],"from":0,"size":100,"total":1}}`);

    expect(queueMessages).toHaveLength(1);
    expect(queueMessages[0]).toEqual({
        instanceId: instanceId,
        connectionId,
        fromId: userName,
        type: 'connected',
        createdAt: currentTime,
        data: null,
    });

    expect(WsClient.connectedClients.size).toBeGreaterThan(0);
    expect(WsClient.connectedClients.has(userName)).toBeTruthy();

    const conversationId = conversation.id!;
    const participants = conversation.participants;

    data = JSON.stringify({
        type: 'join',
        data: {
            conversationId,
        }
    });

    [, msg] = await Promise.all(mockTransport.sendToClient(data));

    expect(client.state).toBe(WsClientState.Session);
    expect(msg).toHaveLength(4 + disconnect?.length);

    const clients = connected.filter(c => !disconnect.includes(c));

    expect(msg[msg.length - 2]).toBe(`{"type":"conversation","conversation":${JSON.stringify(conversation)},"connected":${JSON.stringify([...clients, userName])},"messages":{"messages":[],"from":0,"size":100,"total":0}}`);
    expect(msg[msg.length - 1]).toBe(`{"type":"joined","id":"${joinedId}","instanceId":"${instanceId}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"connectionId":"${connectionId}","fromId":"${userName}","createdAt":"${jsonCurrentTime}","data":null}`);

    expect(queueMessages).toHaveLength(2);
    expect(queueMessages[1]).toEqual({
        id: joinedId,
        conversationId,
        participants,
        instanceId: instanceId,
        connectionId,
        fromId: userName,
        type: 'joined',
        createdAt: currentTime,
        data: null,
    });

    return { client, transport: mockTransport, disconnectedPromise };
}

async function createWatchClient(instanceId: string, connectionId: string, userName: string, conversation: Conversation, connected: string[], queue: MessageQueue) {

    let disconnectedResolve: ((value: Message) => void) | undefined;

    const disconnectedPromise = new Promise(resolve => {
        disconnectedResolve = resolve;
    });

    const queueMessages: Message[] = [];

    async function queueCallback(msg: Message) {
        if (connectionId !== msg.connectionId) {
            return;
        }

        queueMessages.push(msg);

        if (disconnectedResolve && 'disconnected' === msg.type) {
            disconnectedResolve(msg);
            disconnectedResolve = undefined
        }
    }

    queue.subscribe(queueCallback);

    const mockTransport = new MockTransport();
    const client = new WsClient(mockTransport);

    expect(client.state).toBe(WsClientState.None);

    let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

    let msg = await Promise.any(mockTransport.sendToClient(data));

    expect(client.state).toBe(WsClientState.Connected);
    expect(msg).toHaveLength(2);
    expect(msg[0]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
    expect(msg[1]).toBe(`{"type":"connection","connectionId":"${connectionId}","id":"${userName}","conversations":{"conversations":[${JSON.stringify({ conversation, connected })}],"from":0,"size":100,"total":1}}`);

    expect(queueMessages).toHaveLength(1);
    expect(queueMessages[0]).toEqual({
        instanceId: instanceId,
        connectionId,
        fromId: userName,
        type: 'connected',
        createdAt: currentTime,
        data: null,
    });

    expect(WsClient.connectedClients.size).toBeGreaterThan(0);
    expect(WsClient.connectedClients.has(userName)).toBeTruthy();

    data = JSON.stringify({
        type: 'watch',
    });

    msg = await Promise.any(mockTransport.sendToClient(data));

    expect(client.state).toBe(WsClientState.WatchSession);
    expect(msg).toHaveLength(3);

    expect(msg[2]).toBe(`{"type":"watching","conversations":{"conversations":[],"from":0,"size":0,"total":1}}`);

    return { client, transport: mockTransport, disconnectedPromise };
}

describe('clients', () => {
    it('successfull workflow 1', async () => {
        const queue = await initializeQueue();

        let disconnectedResolve1: ((value: Message) => void) | undefined;
        let disconnectedResolve2: ((value: Message) => void) | undefined;

        let queueMessagesCount = 0;
        const queueMessages: Message[] = [];
        async function queueCallback(msg: Message) {
            queueMessages.push(msg);

            if ('disconnected' === msg.type) {
                if (disconnectedResolve1) {
                    disconnectedResolve1(msg);
                    disconnectedResolve1 = undefined
                }

                if (disconnectedResolve2) {
                    disconnectedResolve2(msg);
                    disconnectedResolve2 = undefined
                }
            }
        }

        queue.subscribe(queueCallback);

        const store = await initializeStore();

        const userName = 'test';

        const userStore = await initializeUserStore();

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

        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(2);
        expect(msg[0]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
        expect(msg[1]).toBe(`{"type":"connection","connectionId":"1","id":"${userName}","conversations":{"conversations":[],"from":0,"size":100,"total":0}}`);

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
        expect(msg).toHaveLength(3);

        expect(msg[2]).toBe(`{"type":"watching","conversations":{"conversations":[],"from":0,"size":0,"total":0}}`);

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.watchers.size).toBe(1);
        expect(WsClient.conversations.size).toBe(0);

        const mockTransport2 = new MockTransport();
        const client2 = new WsClient(mockTransport2);

        expect(client2.state).toBe(WsClientState.None);

        const userName2 = 'test2';
        data = JSON.stringify({ authInfo: { name: userName2, password: 'test' }, conversationsSize: 100 });

        msg = await Promise.any(mockTransport2.sendToClient(data));

        expect(client2.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(2);
        expect(msg[0]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
        expect(msg[1]).toBe(`{"type":"connection","connectionId":"2","id":"${userName2}","conversations":{"conversations":[],"from":0,"size":100,"total":0}}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            instanceId: instanceId,
            connectionId: '2',
            fromId: userName2,
            type: 'connected',
            createdAt: currentTime,
            data: null,
        });

        expect(WsClient.connectedClients.size).toBe(2);
        expect(WsClient.connectedClients.has(userName2)).toBeTruthy();

        let participants = [userName, ' test3 '];
        const title = 'conversationTitle';

        data = JSON.stringify({
            type: 'join',
            data: {
                participants,
                title,
            }
        });

        [, msg] = await Promise.all(mockTransport2.sendToClient(data));

        participants = [...participants.map(p => p.trim()), userName2];

        expect(client2.state).toBe(WsClientState.Session);
        expect(msg).toHaveLength(4);

        let id = '1';
        const conversationId = '1';

        expect(msg[2]).toBe(`{"type":"conversation","conversation":{"id":"${conversationId}","participants":${JSON.stringify(participants)},"title":"${title}","createdBy":"${userName2}","createdAt":"${jsonCurrentTime}"},"connected":["${userName2}"]}`);
        expect(msg[3]).toBe(`{"type":"joined","id":"${id}","instanceId":"${instanceId}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"connectionId":"2","fromId":"${userName2}","createdAt":"${jsonCurrentTime}","data":null}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            conversationId,
            participants,
            instanceId: instanceId,
            connectionId: '2',
            fromId: userName2,
            type: 'joined',
            createdAt: currentTime,
            data: null,
        });

        let storedConversation = await store.getParticipantConversationById(userName, conversationId);
        expect(storedConversation).toEqual({
            id: conversationId,
            title,
            participants,
            createdBy: userName2,
            createdAt: currentTime,
        });

        const disconnectedPromise2 = new Promise(resolve => {
            disconnectedResolve2 = resolve;
        });

        let closeData = await mockTransport2.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        expect(mockTransport2.closedByClient).toBeTruthy();
        expect(mockTransport2.readyState).toBe(TransportState.CLOSED);

        let disconnectedMessage = await disconnectedPromise2;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: '2',
            conversationId: '1',
            participants,
            fromId: userName2,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(client2.state).toBe(WsClientState.Disconnected);

        const disconnectedPromise1 = new Promise(resolve => {
            disconnectedResolve1 = resolve;
        });

        closeData = await mockTransport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        expect(mockTransport.closedByClient).toBeTruthy();
        expect(mockTransport.readyState).toBe(TransportState.CLOSED);

        disconnectedMessage = await disconnectedPromise1;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: '1',
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

    it('successfull workflow 2', async () => {
        const queue = await initializeQueue();
        const store = await initializeStore();

        const participants = ['test1', 'test2', 'test3', 'test4'];

        const conversation = {
            id: '1',
            title: 'conversation1',
            participants,
            createdBy: participants[0],
            createdAt: new Date('2024-01-01'),
        };

        let result = await store.saveConversation(conversation);

        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId });

        const c1 = await createConversationClient(instanceId, '1', participants[0], conversation, [], [], '1', queue);

        const c2 = await createConversationClient(instanceId, '2', participants[2], conversation, [participants[0]], [], '2', queue);

        const w1 = await createWatchClient(instanceId, '3', participants[1], conversation, [participants[0], participants[2]], queue);

        const w2 = await createWatchClient(instanceId, '4', participants[3], conversation, [participants[0], participants[2]], queue);

        for (let i = 0; i < 4; i++) {
            const c = [c1, c2, w1, w2][i];

            const closeData = await c.transport.closeToClient('stop test');

            expect(closeData).toEqual({
                code: 1000,
                data: 'Stopped',
            });

            expect(c.transport.closedByClient).toBeTruthy();
            expect(c.transport.readyState).toBe(TransportState.CLOSED);

            const disconnectedMessage = await c.disconnectedPromise;

            expect(disconnectedMessage).toEqual({
                instanceId: instanceId,
                connectionId: c.client.connectionId,
                conversationId: c === w1 || c === w2 ? undefined : conversation.id,
                participants: c === w1 || c === w2 ? undefined : conversation.participants,
                fromId: c.client.id,
                type: 'disconnected',
                createdAt: currentTime,
                data: null,
            });

            expect(c.client.state).toBe(WsClientState.Disconnected);

            if (i == 2) {
                await queue.publish({
                    id: '1',
                    conversationId: conversation.id,
                    participants: participants,
                    instanceId: instanceId,
                    connectionId: '5',
                    fromId: participants[0],
                    type: 'text',
                    createdAt: currentTime,
                    data: { text: 'text' },
                });
            }
        }

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);
    });

    it('successfull workflow 3', async () => {
        const queue = await initializeQueue();
        const store = await initializeStore();

        const participants = ['test1', 'test2', 'test3'];

        const conversation = {
            id: '1',
            title: 'conversation1',
            participants,
            createdBy: participants[0],
            createdAt: new Date('2024-01-01'),
        };

        let result = await store.saveConversation(conversation);

        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId });

        const c1 = await createConversationClient(instanceId, '1', participants[0], conversation, [], [], '1', queue);

        const c2 = await createConversationClient(instanceId, '2', participants[2], conversation, [participants[0]], [], '2', queue);

        const conversationInfo = WsClient.conversations.get(conversation.id)!;

        conversationInfo.clients = [c2.client];

        let closeData = await c1.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        expect(c1.transport.closedByClient).toBeTruthy();
        expect(c1.transport.readyState).toBe(TransportState.CLOSED);

        let disconnectedMessage = await c1.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c1.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c1.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c1.client.state).toBe(WsClientState.Disconnected);

        WsClient.conversations.clear()

        closeData = await c2.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        expect(c2.transport.closedByClient).toBeTruthy();
        expect(c2.transport.readyState).toBe(TransportState.CLOSED);

        disconnectedMessage = await c2.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c2.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c2.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c2.client.state).toBe(WsClientState.Disconnected);

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);
    });

    it('update conversation', async () => {
        const queue = await initializeQueue();
        const store = await initializeStore();

        const participants = ['test1', 'test2'];

        const conversation = {
            id: '1',
            title: 'conversation1',
            participants,
            createdBy: participants[0],
            createdAt: new Date('2024-01-01'),
        };

        let result = await store.saveConversation(conversation);

        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId });

        const w = await createWatchClient(instanceId, '1', participants[0], conversation, [], queue);

        const c1 = await createConversationClient(instanceId, '2', participants[0], conversation, [], [], '1', queue);

        const c2 = await createConversationClient(instanceId, '3', participants[1], conversation, [participants[0]], [], '2', queue);

        const closedPromise = new Promise(resolve => {
            c2.transport.closeResolve = resolve;
        });

        const newParticipants = ['test1', 'test3'];

        const updateConversationRequest = {
            type: 'update',
            data: {
                conversationId: conversation.id,
                title: 'updated title',
                participants: newParticipants,
            }
        };

        const data = JSON.stringify(updateConversationRequest);

        const msg = await Promise.any(c1.transport.sendToClient(data));

        expect(msg).toHaveLength(6);

        const updatedConversationData = {
            ...updateConversationRequest.data,
            updatedAt: currentTime,
            participants: newParticipants
        };

        expect(msg[5]).toBe(`{"type":"updated","data":${JSON.stringify(updatedConversationData)}}`);

        const storedConversation = await store.getParticipantConversationById(participants[0], conversation.id);

        expect(storedConversation).toEqual({
            id: conversation.id,
            title: updatedConversationData.title,
            participants: updatedConversationData.participants,
            createdBy: participants[0],
            createdAt: conversation.createdAt,
            updatedAt: updatedConversationData.updatedAt,
        });

        let closeData = await closedPromise;

        expect(closeData).toEqual({
            code: 1000,
            data: 'Removed',
        });

        expect(c2.transport.closedByClient).toBeTruthy();
        expect(c2.transport.readyState).toBe(TransportState.CLOSED);

        let disconnectedMessage = await c2.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c2.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c2.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c2.client.state).toBe(WsClientState.Disconnected);

        closeData = await w.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        const storedMessages = await store.findMessages({});
        expect(storedMessages.total).toEqual(4);
        expect(storedMessages.messages).toHaveLength(4);
        expect(storedMessages.messages[2]).toEqual({
            id: '3',
            conversationId: conversation.id,
            participants: newParticipants,
            connectionId: c1.client.connectionId,
            fromId: participants[0],
            type: 'updated',
            createdAt: currentTime,
            data: updatedConversationData,
        });

        expect(storedMessages.messages[3]).toEqual({
            id: '4',
            conversationId: conversation.id,
            participants: newParticipants,
            connectionId: c2.client.connectionId,
            fromId: participants[1],
            type: 'left',
            createdAt: currentTime,
            data: null,
        });

        closeData = await c1.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        expect(c1.transport.closedByClient).toBeTruthy();
        expect(c1.transport.readyState).toBe(TransportState.CLOSED);

        disconnectedMessage = await c1.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c1.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c1.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c1.client.state).toBe(WsClientState.Disconnected);

        disconnectedMessage = await w.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: w.client.connectionId,
            fromId: w.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(w.transport.closedByClient).toBeTruthy();
        expect(w.transport.readyState).toBe(TransportState.CLOSED);
        expect(w.transport.sentMessages).toHaveLength(9);

        expect(w.client.state).toBe(WsClientState.Disconnected);

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);
    });

    it('delete conversation', async () => {
        const queue = await initializeQueue();
        const store = await initializeStore();

        const participants = ['test1', 'test2'];

        const conversation = {
            id: '1',
            title: 'conversation1',
            participants,
            createdBy: participants[0],
            createdAt: new Date('2024-01-01'),
        };

        let result = await store.saveConversation(conversation);

        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId });

        const w = await createWatchClient(instanceId, '1', participants[0], conversation, [], queue);

        const c1 = await createConversationClient(instanceId, '2', participants[0], conversation, [], [], '1', queue);

        const c2 = await createConversationClient(instanceId, '3', participants[1], conversation, [participants[0]], [], '2', queue);

        const closedPromise1 = new Promise(resolve => {
            c1.transport.closeResolve = resolve;
        });

        const closedPromise2 = new Promise(resolve => {
            c2.transport.closeResolve = resolve;
        });

        const deleteConversationRequest = {
            type: 'delete',
            data: {
                conversationId: conversation.id,
            }
        };

        const data = JSON.stringify(deleteConversationRequest);

        const msg = await Promise.any(c1.transport.sendToClient(data));

        let closeData = await closedPromise1;

        expect(closeData).toEqual({
            code: 1000,
            data: 'Deleted',
        });

        closeData = await closedPromise2;

        expect(closeData).toEqual({
            code: 1000,
            data: 'Deleted',
        });

        expect(msg).toHaveLength(6);

        const deletedConversationData = {
            ...deleteConversationRequest.data,
            closedAt: currentTime,
            deletedAt: currentTime,
            updatedAt: undefined as Date | undefined,
            participants: undefined as string[] | undefined
        };

        expect(msg[5]).toBe(`{"type":"deleted","data":${JSON.stringify(deletedConversationData)}}`);

        const storedConversation = await store.getParticipantConversationById(participants[0], conversation.id);

        expect(storedConversation).toBeUndefined();

        const storedMessages = await store.findMessages({});
        expect(storedMessages.total).toEqual(5);
        expect(storedMessages.messages).toHaveLength(5);
        expect(storedMessages.messages[2]).toEqual({
            id: '3',
            conversationId: conversation.id,
            participants,
            connectionId: c1.client.connectionId,
            fromId: participants[0],
            type: 'deleted',
            createdAt: currentTime,
            data: deletedConversationData,
        });

        expect(storedMessages.messages[3]).toEqual({
            id: '4',
            conversationId: conversation.id,
            participants,
            connectionId: c1.client.connectionId,
            fromId: participants[0],
            type: 'left',
            createdAt: currentTime,
            data: null,
        });

        expect(storedMessages.messages[4]).toEqual({
            id: '5',
            conversationId: conversation.id,
            participants,
            connectionId: c2.client.connectionId,
            fromId: participants[1],
            type: 'left',
            createdAt: currentTime,
            data: null,
        });

        expect(c1.transport.closedByClient).toBeTruthy();
        expect(c1.transport.readyState).toBe(TransportState.CLOSED);

        let disconnectedMessage = await c1.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c1.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c1.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c1.client.state).toBe(WsClientState.Disconnected);

        expect(c2.transport.closedByClient).toBeTruthy();
        expect(c2.transport.readyState).toBe(TransportState.CLOSED);

        disconnectedMessage = await c2.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c2.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c2.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c2.client.state).toBe(WsClientState.Disconnected);

        closeData = await w.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        disconnectedMessage = await w.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: w.client.connectionId,
            fromId: w.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(w.transport.closedByClient).toBeTruthy();
        expect(w.transport.readyState).toBe(TransportState.CLOSED);
        expect(w.transport.sentMessages).toHaveLength(12);

        expect(w.client.state).toBe(WsClientState.Disconnected);

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);
    });

    it('remove participant', async () => {
        const queue = await initializeQueue();
        const store = await initializeStore();

        const participants = ['test1', 'test2'];

        const conversation = {
            id: '1',
            title: 'conversation1',
            participants,
            createdBy: participants[0],
            createdAt: new Date('2024-01-01'),
        };

        let result = await store.saveConversation(conversation);

        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId });

        const c1 = await createConversationClient(instanceId, '1', participants[0], conversation, [], [], '1', queue);

        const conversationInfo = WsClient.conversations.get(conversation.id)!;

        conversationInfo.participants.delete(participants[0]);

        const c2 = await createConversationClient(instanceId, '2', participants[1], conversation, [participants[0]], [participants[0]], '3', queue);

        let closeData = await c2.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        let disconnectedMessage = await c1.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c1.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c1.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c1.client.state).toBe(WsClientState.Disconnected);

        expect(c2.transport.closedByClient).toBeTruthy();
        expect(c2.transport.readyState).toBe(TransportState.CLOSED);

        disconnectedMessage = await c2.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c2.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c2.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c2.transport.closedByClient).toBeTruthy();
        expect(c2.client.state).toBe(WsClientState.Disconnected);

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);
    });

    it('queue messages', async () => {
        const queue = await initializeQueue();
        const store = await initializeStore();

        const participants1 = ['test1', 'test3'];

        const conversation1 = {
            id: '1',
            title: 'conversation1',
            participants: participants1,
            createdBy: participants1[0],
            createdAt: new Date('2024-01-01'),
        };

        const participants2 = ['test2', 'test3'];

        const conversation2 = {
            id: '2',
            title: 'conversation2',
            participants: participants2,
            createdBy: participants2[0],
            createdAt: new Date('2024-01-01'),
        };

        let result = await store.saveConversation(conversation1);

        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        result = await store.saveConversation(conversation2);

        expect(result._id).toBe('2');
        expect(result.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId });

        const w1 = await createWatchClient(instanceId, '1', participants1[0], conversation1, [], queue);

        const w2 = await createWatchClient(instanceId, '2', participants2[0], conversation2, [], queue);

        const textData = {
            text: 'text',
        };

        await queue.publish({
            id: '3',
            conversationId: conversation1.id,
            participants: participants1,
            instanceId: instanceId,
            connectionId: '3',
            fromId: 'test3',
            type: 'text',
            createdAt: currentTime,
            data: textData,
        });

        await queue.publish({
            id: '4',
            conversationId: conversation2.id,
            participants: participants2,
            instanceId: instanceId,
            connectionId: '3',
            fromId: 'test3',
            type: 'text',
            createdAt: currentTime,
            data: textData,
        });

        await queue.publish({
            id: '5',
            conversationId: conversation2.id,
            participants: participants2,
            instanceId: instanceId,
            connectionId: '3',
            fromId: 'test3',
            type: 'file',
            createdAt: currentTime,
            data: null,
        });

        let closeData = await w1.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        expect(w1.transport.closedByClient).toBeTruthy();
        expect(w1.transport.readyState).toBe(TransportState.CLOSED);

        let disconnectedMessage = await w1.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: w1.client.connectionId,
            fromId: w1.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(w1.client.state).toBe(WsClientState.Disconnected);

        closeData = await w2.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        expect(w2.transport.closedByClient).toBeTruthy();
        expect(w2.transport.readyState).toBe(TransportState.CLOSED);

        disconnectedMessage = await w2.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: w2.client.connectionId,
            fromId: w2.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(w2.client.state).toBe(WsClientState.Disconnected);

        expect(w1.transport.sentMessages).toHaveLength(4);
        expect(w2.transport.sentMessages).toHaveLength(4);

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);
    });

    it('failed updating conversation', async () => {
        const queue = await initializeQueue();
        const store = await initializeStore();

        const participants = ['test1', 'test2'];

        const conversation = {
            id: '1',
            title: 'conversation1',
            participants,
            createdBy: participants[0],
            createdAt: new Date('2024-01-01'),
        };

        let result = await store.saveConversation(conversation);

        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        const userStore = await initializeUserStore();

        const response = await saveInstance();

        const instanceId = response._id;

        initializeClient({ queue, store, userStore, instanceId });

        const w = await createWatchClient(instanceId, '1', participants[0], conversation, [], queue);

        const c1 = await createConversationClient(instanceId, '2', participants[0], conversation, [], [], '1', queue);

        const c2 = await createConversationClient(instanceId, '3', participants[1], conversation, [participants[0]], [], '2', queue);

        const closedPromise = new Promise(resolve => {
            c2.transport.closeResolve = resolve;
        });

        const newParticipants = ['test1', 'test3'];

        const updateConversationRequest = {
            type: 'update',
            data: {
                conversationId: conversation.id,
                title: 'updated title',
                participants: newParticipants,
            }
        };

        const info = WsClient.conversations.get(conversation.id);
        info!.participants = new Set(newParticipants)

        const getParticipantConversationById = store.getParticipantConversationById;

        const data = JSON.stringify(updateConversationRequest);

        let msg = await Promise.any(c1.transport.sendToClient(data));

        expect(msg).toHaveLength(6);

        const updatedConversationData = {
            ...updateConversationRequest.data,
            updatedAt: currentTime,
            participants: newParticipants
        };

        expect(msg[5]).toBe(`{"type":"updated","data":${JSON.stringify(updatedConversationData)}}`);

        const storedConversation = await getParticipantConversationById(participants[0], conversation.id);

        expect(storedConversation).toEqual({
            id: conversation.id,
            title: updatedConversationData.title,
            participants: updatedConversationData.participants,
            createdBy: participants[0],
            createdAt: conversation.createdAt,
            updatedAt: updatedConversationData.updatedAt,
        });

        expect(WsClient.joinedParticipants.size).toBe(1);
        expect(WsClient.connectedClients.size).toBe(2);
        expect(WsClient.watchers.size).toBe(1);
        expect(WsClient.conversations.size).toBe(1);

        WsClient.conversations.clear();

        store.getParticipantConversationById = () => Promise.resolve(undefined);

        await queue.publish({
            id: '3',
            conversationId: undefined,
            participants: newParticipants,
            instanceId: instanceId,
            connectionId: '4',
            fromId: newParticipants[3],
            type: 'joined',
            createdAt: currentTime,
            data: null,
        });

        await queue.publish({
            id: '4',
            conversationId: undefined,
            participants: newParticipants,
            instanceId: instanceId,
            connectionId: '4',
            fromId: newParticipants[3],
            type: 'left',
            createdAt: currentTime,
            data: null,
        });

        await queue.publish({
            id: '5',
            conversationId: 'wrong',
            participants: newParticipants,
            instanceId: instanceId,
            connectionId: '4',
            fromId: newParticipants[3],
            type: 'left',
            createdAt: currentTime,
            data: null,
        });

        await queue.publish({
            id: '6',
            conversationId: undefined,
            participants: newParticipants,
            instanceId: instanceId,
            connectionId: '4',
            fromId: newParticipants[0],
            type: 'message-deleted',
            createdAt: currentTime,
            data: null,
        });

        await queue.publish({
            id: '7',
            conversationId: undefined,
            participants: newParticipants,
            instanceId: instanceId,
            connectionId: '4',
            fromId: newParticipants[0],
            type: 'deleted',
            createdAt: currentTime,
            data: null,
        });

        await queue.publish({
            id: '8',
            conversationId: undefined,
            participants: newParticipants,
            instanceId: instanceId,
            connectionId: '4',
            fromId: newParticipants[0],
            type: 'updated',
            createdAt: currentTime,
            data: null,
        });

        await queue.publish({
            id: '9',
            conversationId: conversation.id,
            participants: newParticipants,
            instanceId: instanceId,
            connectionId: '4',
            fromId: newParticipants[1],
            type: 'updated',
            createdAt: currentTime,
            data: updatedConversationData,
        });

        expect(WsClient.joinedParticipants.size).toBe(1);
        expect(WsClient.connectedClients.size).toBe(2);
        expect(WsClient.watchers.size).toBe(1);
        expect(WsClient.conversations.size).toBe(0);

        WsClient.conversations.set(conversation.id, info!);

        store.getParticipantConversationById = getParticipantConversationById;

        info!.participants = new Set()

        await queue.publish({
            id: '6',
            conversationId: conversation.id,
            participants: newParticipants,
            instanceId: instanceId,
            connectionId: '4',
            fromId: newParticipants[1],
            type: 'updated',
            createdAt: currentTime,
            data: updatedConversationData,
        });

        let closeData = await closedPromise;

        expect(closeData).toEqual({
            code: 1000,
            data: 'Removed',
        });

        expect(c2.transport.closedByClient).toBeTruthy();
        expect(c2.transport.readyState).toBe(TransportState.CLOSED);

        let disconnectedMessage = await c2.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c2.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c2.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c2.client.state).toBe(WsClientState.Disconnected);

        closeData = await w.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        const storedMessages = await store.findMessages({});
        expect(storedMessages.total).toEqual(4);
        expect(storedMessages.messages).toHaveLength(4);
        expect(storedMessages.messages[2]).toEqual({
            id: '3',
            conversationId: conversation.id,
            participants: newParticipants,
            connectionId: c1.client.connectionId,
            fromId: participants[0],
            type: 'updated',
            createdAt: currentTime,
            data: updatedConversationData,
        });

        expect(storedMessages.messages[3]).toEqual({
            id: '4',
            conversationId: conversation.id,
            participants: newParticipants,
            connectionId: c2.client.connectionId,
            fromId: participants[1],
            type: 'left',
            createdAt: currentTime,
            data: null,
        });

        closeData = await c1.transport.closeToClient('stop test');

        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        expect(c1.transport.closedByClient).toBeTruthy();
        expect(c1.transport.readyState).toBe(TransportState.CLOSED);

        disconnectedMessage = await c1.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: c1.client.connectionId,
            conversationId: conversation.id,
            participants: conversation.participants,
            fromId: c1.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(c1.client.state).toBe(WsClientState.Disconnected);

        disconnectedMessage = await w.disconnectedPromise;

        expect(disconnectedMessage).toEqual({
            instanceId: instanceId,
            connectionId: w.client.connectionId,
            fromId: w.client.id,
            type: 'disconnected',
            createdAt: currentTime,
            data: null,
        });

        expect(w.transport.closedByClient).toBeTruthy();
        expect(w.transport.readyState).toBe(TransportState.CLOSED);
        expect(w.transport.sentMessages).toHaveLength(9);

        expect(w.client.state).toBe(WsClientState.Disconnected);

        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);
    });
});