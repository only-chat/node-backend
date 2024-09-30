import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, TransportState, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeQueue } from '@only-chat/in-memory-queue';
import { initialize as initializeUserStore } from '@only-chat/in-memory-user-store';
import { MockTransport } from '../mocks/mockTransport.js';

import type { Log } from '@only-chat/types/log.js';
import type { Message } from '@only-chat/types/queue.js';

const watchConversationId = '@watch'
const logger: Log | undefined = undefined;

const currentTime = new Date('2024-08-01T00:00:00.000Z');
const jsonCurrentTime = currentTime.toJSON();
jest.useFakeTimers().setSystemTime(currentTime);

describe('client', () => {
    it('successfull workflow', async () => {
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

        initializeClient({ queue, store, userStore, instanceId, watchConversationId }, logger);

        const mockTransport = new MockTransport();

        const client = new WsClient(mockTransport);

        expect(client.state).toBe(WsClientState.None);

        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        const userName = 'test';
        let data = JSON.stringify({ name: userName, password: 'test' });

        let msg = await Promise.any(mockTransport.sendToClient(data));

        let msgCount = 1;
        
        expect(client.state).toBe(WsClientState.Connected);
        expect(msg).toHaveLength(msgCount + 1);
        expect(msg[msgCount-1]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
        expect(msg[msgCount++]).toBe(`{"type":"connection","connectionId":"1","id":"${userName}","conversations":{"conversations":[],"from":0,"size":100,"total":0}}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            instanceId: instanceId,
            fromConnectionId: '1',
            fromId: userName,
            type: 'connected',
            createdAt: currentTime,
            data: null,
        });

        expect(WsClient.connectedClients.size).toBe(1);
        expect(WsClient.connectedClients.has(userName)).toBeTruthy();

        const participants = [userName, 'test2'];
        const clientConversationId = 'clientConversationId';
        const conversationTitle = 'conversationTitle';

        data = JSON.stringify({
            type: 'join',
            participants,
            conversationId: null,
            clientConversationId,
            conversationTitle,
        });

        [, msg] = await Promise.all(mockTransport.sendToClient(data));

        msgCount++;

        expect(client.state).toBe(WsClientState.Session);
        expect(msg).toHaveLength(msgCount+1);

        let id = '1';
        const conversationId = '1';
        const fromConnectionId = '1';

        expect(msg[msgCount-1]).toBe(`{"type":"conversation","conversation":{"id":"${conversationId}","clientConversationId":"${clientConversationId}","participants":${JSON.stringify(participants)},"title":"${conversationTitle}","createdBy":"${userName}","createdAt":"${jsonCurrentTime}"},"connected":["${userName}"]}`);
        expect(msg[msgCount++]).toBe(`{"id":"${id}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"fromConnectionId":"${fromConnectionId}","fromId":"${userName}","type":"joined","data":null,"createdAt":"${jsonCurrentTime}"}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            conversationId,
            participants,
            instanceId: instanceId,
            fromConnectionId,
            fromId: userName,
            type: 'joined',
            createdAt: currentTime,
            data: null,
        });

        const storedConversation = await store.getConversationById(conversationId);
        expect(storedConversation).toEqual({
            id: conversationId,
            clientConversationId,
            title: conversationTitle,
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
            fromConnectionId,
            fromId: userName,
            type: 'joined',
            createdAt: currentTime,
            data: null,
        });

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
        expect(msg).toHaveLength(msgCount+1);
        expect(msg[msgCount++]).toBe(`{"id":"${id}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"fromConnectionId":"${fromConnectionId}","fromId":"${userName}","type":"text","data":${JSON.stringify(textData)},"createdAt":"${jsonCurrentTime}"}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            conversationId,
            participants,
            instanceId: instanceId,
            fromConnectionId,
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
            fromConnectionId,
            fromId: userName,
            type: 'text',
            createdAt: currentTime,
            data: textData,
        });

        const updateMessageData = {
            messageId: id,
            type: 'text',
            text: 'text2'
        };

        data = JSON.stringify({
            type: 'message-update',
            data: updateMessageData,
        });

        id = '3';

        msg = await Promise.any(mockTransport.sendToClient(data));

        expect(msg).toHaveLength(msgCount+1);
        expect(msg[msgCount++]).toBe(`{"id":"${id}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"fromConnectionId":"${fromConnectionId}","fromId":"${userName}","type":"message-updated","data":${JSON.stringify(updateMessageData)},"createdAt":"${jsonCurrentTime}"}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            conversationId,
            participants,
            instanceId: instanceId,
            fromConnectionId,
            fromId: userName,
            type: 'message-updated',
            createdAt: currentTime,
            data: updateMessageData,
        });

        storedMessages = await store.findMessages({});
        expect(storedMessages.total).toEqual(storedMessagesCount + 1);
        expect(storedMessages.messages).toHaveLength(storedMessagesCount + 1);
        expect(storedMessages.messages[storedMessagesCount++]).toEqual({
            id,
            conversationId,
            participants,
            fromConnectionId,
            fromId: userName,
            type: 'message-updated',
            createdAt: currentTime,
            data: updateMessageData,
        });

        expect(storedMessages.messages[1]).toEqual({
            id: '2',
            conversationId,
            participants,
            fromConnectionId,
            fromId: userName,
            type: 'text',
            createdAt: currentTime,
            data: { text: 'text2' },
            updatedAt: currentTime,
        });

        const newParticipants = [userName, 'test3'];
        const updateConversationData = {
            title: 'new title',
            participants: newParticipants,
        };

        data = JSON.stringify({
            type: 'update',
            data: updateConversationData,
        });

        id = '4';

        msg = await Promise.any(mockTransport.sendToClient(data));

        expect(msg).toHaveLength(msgCount+1);
        expect(msg[msgCount++]).toBe(`{"id":"${id}","conversationId":"${conversationId}","participants":${JSON.stringify(newParticipants)},"fromConnectionId":"${fromConnectionId}","fromId":"${userName}","type":"updated","data":${JSON.stringify(updateConversationData)},"createdAt":"${jsonCurrentTime}"}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            conversationId,
            participants: newParticipants,
            instanceId: instanceId,
            fromConnectionId,
            fromId: userName,
            type: 'updated',
            createdAt: currentTime,
            data: updateConversationData,
        });

        storedMessages = await store.findMessages({});
        expect(storedMessages.total).toEqual(storedMessagesCount + 1);
        expect(storedMessages.messages).toHaveLength(storedMessagesCount + 1);
        expect(storedMessages.messages[storedMessagesCount++]).toEqual({
            id,
            conversationId,
            fromConnectionId,
            participants: newParticipants,
            fromId: userName,
            type: 'updated',
            createdAt: currentTime,
            data: updateConversationData,
        });

        const deleteMessageData = {
            messageId: id,
        };

        data = JSON.stringify({
            type: 'message-delete',
            data: deleteMessageData,
        });

        id = '5';

        msg = await Promise.any(mockTransport.sendToClient(data));

        expect(msg).toHaveLength(msgCount+1);
        expect(msg[msgCount++]).toBe(`{"id":"${id}","conversationId":"${conversationId}","participants":${JSON.stringify(newParticipants)},"fromConnectionId":"${fromConnectionId}","fromId":"${userName}","type":"message-deleted","data":${JSON.stringify(deleteMessageData)},"createdAt":"${jsonCurrentTime}"}`);

        expect(queueMessages).toHaveLength(queueMessagesCount + 1);
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            conversationId,
            participants: newParticipants,
            instanceId: instanceId,
            fromConnectionId,
            fromId: userName,
            type: 'message-deleted',
            createdAt: currentTime,
            data: deleteMessageData,
        });

        storedMessages = await store.findMessages({});
        expect(storedMessages.total).toEqual(storedMessagesCount + 1);
        expect(storedMessages.messages).toHaveLength(storedMessagesCount + 1);
        expect(storedMessages.messages[storedMessagesCount++]).toEqual({
            id,
            conversationId,
            participants: newParticipants,
            fromConnectionId,
            fromId: userName,
            type: 'message-deleted',
            createdAt: currentTime,
            data: deleteMessageData,
        });

        const closeData = await mockTransport.closeToClient('stop test');
        expect(closeData).toEqual({
            code: 1000,
            data: 'Stopped',
        });

        expect(mockTransport.closedByClient).toBeTruthy();
        expect(mockTransport.readyState).toBe(TransportState.CLOSED);

        const disconnectedMessage = await new Promise(resolve => {
            disconnectedResolve = resolve;
        });

        expect(client.state).toBe(WsClientState.Disconnected);

        expect(queueMessages).toHaveLength(queueMessagesCount + 2);

        id = '6';
        expect(queueMessages[queueMessagesCount++]).toEqual({
            id,
            conversationId,
            participants: newParticipants,
            instanceId: instanceId,
            fromConnectionId,
            fromId: userName,
            type: 'left',
            createdAt: currentTime,
            data: null,
        });

        expect(queueMessages[7]).toEqual({
            instanceId: instanceId,
            fromConnectionId,
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
            participants: newParticipants,
            fromConnectionId,
            fromId: userName,
            type: 'left',
            createdAt: currentTime,
            data: null,
        });

        expect(WsClient.connectedClients.size).toBe(0);
        expect(WsClient.watchers.size).toBe(0);
        expect(WsClient.conversations.size).toBe(0);

        queue.unsubscribe?.(queueCallback);
    });
});