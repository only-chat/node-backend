import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, TransportState, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeQueue } from '@only-chat/in-memory-queue';
import { initialize as initializeUserStore } from '@only-chat/in-memory-user-store';
import { MockTransport } from '../mocks/mockTransport.js';

import type { Log } from '@only-chat/types/log.js';
import type { Message } from '@only-chat/types/queue.js';
import type { MessageStore } from '@only-chat/types/store.js';

const logger: Log | undefined = undefined;

const currentTime = new Date('2024-08-01T00:00:00.000Z');
const jsonCurrentTime = currentTime.toJSON();
jest.useFakeTimers().setSystemTime(currentTime);

async function wrongConversationRequest(itConversationRequest: (t: MockTransport) => Promise<void>) {
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
        instanceId,
        connectionId: '1',
        fromId: userName,
        type: 'connected',
        createdAt: currentTime,
        data: null,
    });

    expect(WsClient.connectedClients.size).toBe(1);
    expect(WsClient.connectedClients.has(userName)).toBeTruthy();

    let participants = [userName, ' test2 '];
    const title = 'conversationTitle';

    data = JSON.stringify({
        type: 'join',
        data: {
            participants,
            title,
        }
    });

    [, msg] = await Promise.all(mockTransport.sendToClient(data));

    participants = participants.map(p => p.trim());

    msgCount++;

    expect(client.state).toBe(WsClientState.Session);
    expect(msg).toHaveLength(msgCount + 1);

    let id = '1';
    const conversationId = '1';
    const connectionId = '1';

    expect(msg[msgCount - 1]).toBe(`{"type":"conversation","conversation":{"id":"${conversationId}","participants":${JSON.stringify(participants)},"title":"${title}","createdBy":"${userName}","createdAt":"${jsonCurrentTime}"},"connected":["${userName}"]}`);
    expect(msg[msgCount++]).toBe(`{"type":"joined","id":"${id}","instanceId":"${instanceId}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"connectionId":"${connectionId}","fromId":"${userName}","createdAt":"${jsonCurrentTime}","data":null}`);

    expect(queueMessages).toHaveLength(queueMessagesCount + 1);
    expect(queueMessages[queueMessagesCount++]).toEqual({
        id,
        conversationId,
        participants,
        instanceId: instanceId,
        connectionId,
        fromId: userName,
        type: 'joined',
        createdAt: currentTime,
        data: null,
    });

    let storedConversation = await store.getParticipantConversationById(userName, conversationId);
    expect(storedConversation).toEqual({
        id: conversationId,
        title,
        participants,
        createdBy: userName,
        createdAt: currentTime,
    });

    let storedMessagesCount = 0;
    let storedMessages = await store.findMessages({});
    expect(storedMessages.total).toEqual(storedMessagesCount + 1);
    expect(storedMessages.messages).toHaveLength(storedMessagesCount + 1);
    expect(storedMessages.messages[storedMessagesCount++]).toEqual({
        id,
        conversationId,
        participants,
        connectionId,
        fromId: userName,
        type: 'joined',
        createdAt: currentTime,
        data: null,
    });

    expect(WsClient.joinedParticipants.get(conversationId)?.size).toBe(1);
    expect(WsClient.conversations.size).toBe(1);
    const info = WsClient.conversations.get(conversationId);
    expect(info).not.toBeNull();
    participants.forEach(p => expect(info!.participants.has(p)).toBeTruthy());
    expect(info!.clients).toHaveLength(1);
    expect(info!.clients[0]).toEqual(client);

    const disconnectedPromise = new Promise(resolve => {
        disconnectedResolve = resolve;
    });

    await itConversationRequest(mockTransport);

    expect(mockTransport.closedByClient).toBeTruthy();

    const disconnectedMessage = await disconnectedPromise;

    expect(disconnectedMessage).toEqual({
        conversationId,
        participants,
        instanceId: instanceId,
        connectionId,
        fromId: userName,
        type: 'disconnected',
        createdAt: currentTime,
        data: null,
    });

    id = '2';
    expect(queueMessages.length).toBeGreaterThan(queueMessagesCount);
    expect(queueMessages[queueMessagesCount++]).toEqual({
        id,
        conversationId,
        participants,
        instanceId: instanceId,
        connectionId,
        fromId: userName,
        type: 'left',
        createdAt: currentTime,
        data: null,
    });

    expect(mockTransport.readyState).toBe(TransportState.CLOSED);
    expect(client.state).toBe(WsClientState.Disconnected);

    expect(queueMessages.length).toBeGreaterThan(queueMessagesCount);
    expect(queueMessages[queueMessagesCount++]).toEqual({
        conversationId,
        participants,
        instanceId: instanceId,
        connectionId,
        fromId: userName,
        type: 'disconnected',
        createdAt: currentTime,
        data: null,
    });

    storedMessages = await store.findMessages({});
    expect(storedMessages.total).toEqual(storedMessagesCount + 1);
    expect(storedMessages.messages).toHaveLength(storedMessagesCount + 1);
    expect(storedMessages.messages[storedMessagesCount++]).toEqual({
        id,
        conversationId,
        participants,
        connectionId,
        fromId: userName,
        type: 'left',
        createdAt: currentTime,
        data: null,
    });

    expect(WsClient.joinedParticipants.size).toBe(0);
    expect(WsClient.connectedClients.size).toBe(0);
    expect(WsClient.watchers.size).toBe(0);
    expect(WsClient.conversations.size).toBe(0);

    queue.unsubscribe?.(queueCallback);
}

describe('client', () => {
    it('wrong requests', async () => {
        await wrongConversationRequest(async (t) => {
            const data = JSON.stringify(null);

            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1000,
                data: 'Wrong message',
            });
        });

        await wrongConversationRequest(async (t) => {
            const data = '{}';

            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1000,
                data: 'Failed processConversationRequest. Wrong message',
            });
        });

        await wrongConversationRequest(async (t) => {
            const data = '[';

            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1011,
                data: 'Failed message processing. Unexpected end of JSON input',
            });
        });
    });
});

async function failedJoin(itJoinRequest: (t: MockTransport, s: MessageStore) => Promise<void>) {
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

    const userName = 'test';
    let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

    let msg = await Promise.any(mockTransport.sendToClient(data));

    let msgCount = 1;

    let connectionId = '1';

    expect(client.state).toBe(WsClientState.Connected);
    expect(msg).toHaveLength(msgCount + 1);
    expect(msg[msgCount - 1]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
    expect(msg[msgCount++]).toBe(`{"type":"connection","connectionId":"${connectionId}","id":"${userName}","conversations":{"conversations":[],"from":0,"size":100,"total":0}}`);

    expect(queueMessages).toHaveLength(queueMessagesCount + 1);
    expect(queueMessages[queueMessagesCount++]).toEqual({
        instanceId,
        connectionId,
        fromId: userName,
        type: 'connected',
        createdAt: currentTime,
        data: null,
    });

    expect(WsClient.connectedClients.size).toBe(1);
    expect(WsClient.connectedClients.has(userName)).toBeTruthy();

    const disconnectedPromise = new Promise(resolve => {
        disconnectedResolve = resolve;
    });

    await itJoinRequest(mockTransport, store);

    expect(mockTransport.closedByClient).toBeTruthy();

    const disconnectedMessage = await disconnectedPromise;

    expect(disconnectedMessage).toEqual({
        instanceId: instanceId,
        connectionId,
        fromId: userName,
        type: 'disconnected',
        createdAt: currentTime,
        data: null,
    });

    expect(mockTransport.readyState).toBe(TransportState.CLOSED);
    expect(client.state).toBe(WsClientState.Disconnected);

    expect(WsClient.joinedParticipants.size).toBe(0);
    expect(WsClient.connectedClients.size).toBe(0);
    expect(WsClient.watchers.size).toBe(0);
    expect(WsClient.conversations.size).toBe(0);

    queue.unsubscribe?.(queueCallback);
}

describe('client', () => {
    it('failed join', async () => {
        await failedJoin(async (t) => {
            const data = JSON.stringify({
                type: 'join',
                data: {
                    participants: ['test', ' test2 ', 'test3'],
                }
            });
    
            const result = await t.sendToClientToClose(data);
    
            expect(result).toEqual({
                code: 1000,
                data: 'Failed join. Conversation title required',
            });
        });

        await failedJoin(async (t, s) => {
            const data = JSON.stringify({
                type: 'join',
                data: {
                    participants: [' test2 '],
                }
            });
    
            s.saveConversation = async () => {
                throw new Error('Test exception');
            };

            const result = await t.sendToClientToClose(data);
    
            expect(result).toEqual({
                code: 1011,
                data: 'Failed join. Test exception',
            });
        });

        await failedJoin(async (t) => {
            const data = JSON.stringify({
                type: 'join',
                data: {
                    participants: [],
                }
            });
    
            const result = await t.sendToClientToClose(data);
    
            expect(result).toEqual({
                code: 1000,
                data: 'Failed join. Less than 2 participants',
            });
        });
    });
});