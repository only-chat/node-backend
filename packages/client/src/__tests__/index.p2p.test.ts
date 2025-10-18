import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, TransportState, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeQueue } from '@only-chat/in-memory-queue';
import { initialize as initializeUserStore } from '@only-chat/in-memory-user-store';
import { MockTransport } from '../mocks/mockTransport.js';

import type { Log } from '@only-chat/types/log.js';
import type { Message } from '@only-chat/types/queue.js';
import { MessageStore } from '@only-chat/types/store.js';

const logger: Log | undefined = undefined;

const currentTime = new Date('2024-08-01T00:00:00.000Z');
const jsonCurrentTime = currentTime.toJSON();
jest.useFakeTimers().setSystemTime(currentTime);

describe('client', () => {
    async function successfullRequest(conversation, participants: string[], itJoinRequest: (m, c, MockTransport, s: MessageStore) => Promise<void>) {
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
            instanceId: instanceId,
            connectionId: '1',
            fromId: userName,
            type: 'connected',
            createdAt: currentTime,
            data: null,
        });

        expect(WsClient.connectedClients.size).toBe(1);
        expect(WsClient.connectedClients.has(userName)).toBeTruthy();

        const conversationId = conversation.id;

        const saveResult = await store.saveConversation(conversation);
        expect(saveResult._id).toBe(conversation.id);
        expect(saveResult.result).toBe('created');

        store.getPeerToPeerConversationId = async () => ({ id: conversation.id });

        data = JSON.stringify({
            type: 'join',
            data: {
                participants,
            }
        });

        [, msg] = await Promise.all(mockTransport.sendToClient(data));

        participants = participants.map(p => p.trim());

        msgCount++;

        expect(client.state).toBe(WsClientState.Session);
        expect(msg).toHaveLength(msgCount + 1);

        let id = '1';
        const connectionId = '1';

        await itJoinRequest(msg[msgCount - 1], conversation, mockTransport, store);

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

        const wrongRequest = {
            type: 'wrong',
            data: {},
        };

        const disconnectedPromise = new Promise(resolve => {
            disconnectedResolve = resolve;
        });

        data = JSON.stringify(wrongRequest);

        const result = await mockTransport.sendToClientToClose(data);

        expect(result).toEqual({
            code: 1000,
            data: 'Failed processing conversation request. Wrong message type',
        });

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

    async function wrongRequest(itJoinRequest: (t: MockTransport, s: MessageStore) => Promise<void>) {
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
            instanceId: instanceId,
            connectionId: '1',
            fromId: userName,
            type: 'connected',
            createdAt: currentTime,
            data: null,
        });

        expect(WsClient.connectedClients.size).toBe(1);
        expect(WsClient.connectedClients.has(userName)).toBeTruthy();

        await itJoinRequest(mockTransport, store);

        expect(mockTransport.closedByClient).toBeTruthy();

        expect(mockTransport.readyState).toBe(TransportState.CLOSED);
        expect(client.state).toBe(WsClientState.Disconnected);


        expect(WsClient.joinedParticipants.size).toBe(0);
        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        queue.unsubscribe?.(queueCallback);
    }

    it('successfull peer to peer workflow with updated participants', async () => {
        const userName = 'test'
        const participants = [userName, ' test2 '];

        const conversation = {
            id: '1',
            title: 'title',
            participants: ['1', '2'],
            createdBy: userName,
            createdAt: new Date('2024-01-03'),
            connected: [],
        };

        await successfullRequest(conversation, participants, async (m, c, t, s) => {
            const updatedConversation = {
                id: c.id,
                participants: participants.map(p => p.trim()),
                title: undefined,
                createdBy: userName,
                createdAt: c.createdAt,
                updatedAt: currentTime,
            }

            expect(m).toBe(`{"type":"conversation","conversation":${JSON.stringify(updatedConversation)},"connected":["${userName}"],"messages":{"messages":[],"from":0,"size":100,"total":0}}`);

            const storedConversation = await s.getParticipantConversationById(c.createdBy, c.id);
            expect(storedConversation).toEqual(updatedConversation);
        });
    });

    it('successfull peer to peer workflow with deleted conversation ', async () => {
        const userName = 'test'

        const conversation = {
            id: '1',
            title: 'title',
            participants: [userName, '2'],
            createdBy: userName,
            createdAt: new Date('2024-01-03'),
            deletedAt: new Date('2024-01-04'),
            connected: [],
        };

        await successfullRequest(conversation, conversation.participants, async (m, c, t, s) => {
            const updatedConversation = {
                id: c.id,
                participants: conversation.participants,
                title: undefined,
                createdBy: '',
                createdAt: currentTime,
            }

            expect(m).toBe(`{"type":"conversation","conversation":${JSON.stringify(updatedConversation)},"connected":["${userName}"],"messages":{"messages":[],"from":0,"size":100,"total":0}}`);

            const storedConversation = await s.getParticipantConversationById(c.createdBy, c.id);
            expect(storedConversation).toEqual(updatedConversation);
        });
    });

    it('unsuccessfull peer to peer workflow', async () => {
        await wrongRequest(async (t, s) => {
            s.saveConversation = async () => ({
                _id: '',
                result: 'failed',
            });

            const userName = 'test';

            const participants = [userName, ' test2 '];

            const data = JSON.stringify({
                type: 'join',
                data: {
                    title: 'title',
                    participants,
                }
            });

            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1000,
                data: 'Failed join. Save conversation failed',
            });
        });
    });

    it('failed to get peer to peer conversation identifier workflow', async () => {
        await wrongRequest(async (t, s) => {
            s.getPeerToPeerConversationId = async () => undefined;

            const userName = 'test';

            const participants = [userName, ' test2 '];

            const data = JSON.stringify({
                type: 'join',
                data: {
                    participants,
                }
            });

            const result = await t.sendToClientToClose(data);

            expect(result).toEqual({
                code: 1000,
                data: 'Failed join. Unable to get peer to peer conversation identifier',
            });
        });
    });
});