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
const jsonCurrentTime = currentTime.toJSON();
jest.useFakeTimers().setSystemTime(currentTime);

describe('client', () => {
    it('find, load messages and wrong message', async () => {
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

        let participants = [userName, ' test2 '];
        const title = 'conversationTitle';

        data = JSON.stringify({
            type: 'join',
            data: {
                id: null,
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


        const textData = {
            text: 'text',
        };

        data = JSON.stringify({
            type: 'text',
            data: textData,
        });

        id = '2';

        msg = await Promise.any(mockTransport.sendToClient(data));
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount++]).toBe(`{"type":"text","id":"${id}","instanceId":"${instanceId}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"connectionId":"${connectionId}","fromId":"${userName}","createdAt":"${jsonCurrentTime}","data":${JSON.stringify(textData)}}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            conversationId,
            participants,
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'text',
            createdAt: currentTime,
            data: textData,
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
            type: 'text',
            createdAt: currentTime,
            data: textData,
        });

        textData.text = 'text2';

        data = JSON.stringify({
            type: 'text',
            data: textData,
        });

        id = '3';

        msg = await Promise.any(mockTransport.sendToClient(data));
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount++]).toBe(`{"type":"text","id":"${id}","instanceId":"${instanceId}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"connectionId":"${connectionId}","fromId":"${userName}","createdAt":"${jsonCurrentTime}","data":${JSON.stringify(textData)}}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            conversationId,
            participants,
            instanceId: instanceId,
            connectionId,
            fromId: userName,
            type: 'text',
            createdAt: currentTime,
            data: textData,
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
            type: 'text',
            createdAt: currentTime,
            data: textData,
        });

        const loadRequest = {
            type: 'load-messages',
            data: {
                from: 0,
                size: 100,
                excludeIds: ['3'],
                before: jsonCurrentTime,
            },
        };

        data = JSON.stringify(loadRequest);

        msg = await Promise.any(mockTransport.sendToClient(data));
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount++]).toBe(`{"type":"loaded-messages","messages":${JSON.stringify([storedMessages.messages[storedMessagesCount-2]])},"count":1}`);

        const findRequest = {
            type: 'find',
            data: {
                from: 0,
                size: 50,
                sort: 'id',
                sortDesc: true,
                ids: ['1','2','3','4'],
                clientMessageIds: [],
                excludeIds: ['1'],
                conversationIds: [conversationId],
                fromIds: [userName],
                types: ['text', 'file', 'joined'],
                createdFrom: jsonCurrentTime,
                createdTo: jsonCurrentTime,
                text: 'text',
            },
        };

        data = JSON.stringify(findRequest);

        msg = await Promise.any(mockTransport.sendToClient(data));
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount++]).toBe(`{"type":"find","messages":${JSON.stringify([storedMessages.messages[storedMessagesCount-1], storedMessages.messages[storedMessagesCount-2]])},"from":0,"size":50,"total":2}`);

        const findRequest2 = {
            type: 'find',
            data: {
                sort: 'id',
                conversationIds: [conversationId],
                fromIds: [userName],
                types: ['text', 'file', 'joined'],
                createdFrom: jsonCurrentTime,
                createdTo: jsonCurrentTime,
            },
        };

        data = JSON.stringify(findRequest2);

        msg = await Promise.any(mockTransport.sendToClient(data));
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount++]).toBe(`{"type":"find","messages":${JSON.stringify([storedMessages.messages[storedMessagesCount-3], storedMessages.messages[storedMessagesCount-2], storedMessages.messages[storedMessagesCount-1]])},"from":0,"size":100,"total":3}`);

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
            data: 'Failed processConversationRequest. Wrong message type',
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

        id = '4';
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
    });
});