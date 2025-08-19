import { jest, describe, expect, it } from '@jest/globals';
import { initialize as initializeClient, TransportState, WsClient, WsClientState } from '../index.js';
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeUserStore } from '@only-chat/in-memory-user-store';
import { MockTransport } from '../mocks/mockTransport.js';

import type { Message } from '@only-chat/types/queue.js';

const currentTime = new Date('2024-08-01T00:00:00.000Z');
const jsonCurrentTime = currentTime.toJSON();
jest.useFakeTimers().setSystemTime(currentTime);

describe('client', () => {
    function itWithQueue(testName, queue) {
        it(testName, async () => {

            const store = await initializeStore();

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

            const userName = 'test';
            let data = JSON.stringify({ authInfo: { name: userName, password: 'test' }, conversationsSize: 100 });

            let msg = await Promise.any(mockTransport.sendToClient(data));

            expect(client.state).toBe(WsClientState.Connected);
            expect(msg).toHaveLength(2);
            expect(msg[0]).toBe(`{"type":"hello","instanceId":"${instanceId}"}`);
            expect(msg[1]).toBe(`{"type":"connection","connectionId":"1","id":"${userName}","conversations":{"conversations":[],"from":0,"size":100,"total":0}}`);

            expect(WsClient.connectedClients.size).toBe(1);
            expect(WsClient.connectedClients.has(userName)).toBeTruthy();

            let participants = [userName, ' test2 '];
            const title = 'conversationTitle';

            data = JSON.stringify({
                type: 'join',
                data: {
                    conversationId: null,
                    participants,
                    title,
                }
            });

            [, msg] = await Promise.all(mockTransport.sendToClient(data));

            participants = participants.map(p => p.trim());

            expect(client.state).toBe(WsClientState.Session);
            expect(msg).toHaveLength(4);

            let id = '1';
            const conversationId = '1';
            const connectionId = '1';

            expect(msg[2]).toBe(`{"type":"conversation","conversation":{"id":"${conversationId}","participants":${JSON.stringify(participants)},"title":"${title}","createdBy":"${userName}","createdAt":"${jsonCurrentTime}"},"connected":["${userName}"]}`);
            expect(msg[3]).toBe(`{"type":"joined","id":"${id}","instanceId":"${instanceId}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"connectionId":"${connectionId}","fromId":"${userName}","createdAt":"${jsonCurrentTime}","data":null}`);

            const storedConversation = await store.getParticipantConversationById(userName, conversationId);
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

            const textData = {
                text: 'text',
            };

            data = JSON.stringify({
                type: 'text',
                data: textData,
            });

            id = '2';

            msg = await Promise.any(mockTransport.sendToClient(data));

            expect(msg).toHaveLength(5);
            expect(msg[4]).toBe(`{"type":"text","id":"${id}","instanceId":"${instanceId}","conversationId":"${conversationId}","participants":${JSON.stringify(participants)},"connectionId":"${connectionId}","fromId":"${userName}","createdAt":"${jsonCurrentTime}","data":${JSON.stringify(textData)}}`);

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

            let disconnectedResolve: ((value: Message) => void) | undefined;

            const disconnectedPromise = new Promise(resolve => {
                disconnectedResolve = resolve;
            });

            const translateQueueMessage = WsClient.translateQueueMessage;

            WsClient.translateQueueMessage = async (qm) => {
                await translateQueueMessage(qm);

                if (qm.type === 'disconnected') {
                    disconnectedResolve!(qm);
                }
            }

            const closeData = await mockTransport.closeToClient('stop test');

            expect(closeData).toEqual({
                code: 1000,
                data: 'Stopped',
            });

            expect(mockTransport.closedByClient).toBeTruthy();
            expect(mockTransport.readyState).toBe(TransportState.CLOSED);

            expect(client.state).toBe(WsClientState.Disconnected);

            id = '3';
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

            const disconnectedMessage = await disconnectedPromise;

            expect(disconnectedMessage).toEqual({
                instanceId: instanceId,
                conversationId,
                participants,
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
        });
    }

    itWithQueue('successfull workflow with undefined queue', undefined);

    const q1 = {
        acceptTypes: 'string',
        publish: async (msg: Message) => {
            await WsClient.translateQueueMessage(msg);
            return true;
        },
        subscribe: (callback: (msg: Message) => Promise<void>) => { },
    }

    itWithQueue('successfull workflow with not array acceptTypes', q1);

    const q2 = {
        acceptTypes: [],
        publish: (msg: Message) => { },
        subscribe: (callback: (msg: Message) => Promise<void>) => { },
    }

    itWithQueue('successfull workflow with empty array acceptTypes', q2);
});