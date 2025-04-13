import { jest, describe, expect, beforeEach, it } from '@jest/globals';
import { initialize, saveInstance } from '../index.js';
import type { Message, MessageStore, MessageType } from '@only-chat/types/store.js';

const createdAt = new Date('2024-01-01');

const conversation1 = {
    id: '1',
    participants: ['user1', 'user2'],
    createdBy: '1',
    createdAt,
};

const conversation2 = {
    id: '2',
    participants: ['user1', 'user2'],
    createdBy: '2',
    createdAt,
};

const conversation3 = {
    id: '3',
    participants: ['user1', 'user2', 'user3'],
    createdBy: '2',
    createdAt: new Date('2024-01-03'),
};

const conversation4 = {
    id: '4',
    participants: ['user2', 'user5'],
    createdBy: '5',
    createdAt,
};

const conversation5 = {
    id: '5',
    participants: ['user6', 'user5'],
    createdBy: '5',
    createdAt,
    deletedAt: new Date('2024-02-02'),
};

const time = new Date('2024-01-01');
const mockMessages: Message[] = [
    { id: '1', connectionId: '1', conversationId: conversation1.id, type: 'text', clientMessageId: 'client1', fromId: 'user1', data: { text: 'Hello' }, createdAt: time, updatedAt: time },
    { id: '2', connectionId: '1', conversationId: conversation1.id, type: 'text', clientMessageId: 'client2', fromId: 'user1', data: { text: 'Mock message 2' }, createdAt: new Date('2021-01-01'), updatedAt: time },
    { id: '3', connectionId: '1', conversationId: conversation2.id, type: 'text', clientMessageId: 'client3', fromId: 'user2', data: { text: 'Mock message 3' }, createdAt: time, updatedAt: time },
    { id: '4', connectionId: '1', conversationId: conversation2.id, type: 'text', clientMessageId: 'client4', fromId: 'user2', data: { text: 'Mock message 4' }, createdAt: time, updatedAt: time },
    { id: '5', connectionId: '2', conversationId: conversation3.id, type: 'text', clientMessageId: 'client1', fromId: 'user1', data: { text: 'Hello' }, createdAt: time, updatedAt: time },
    { id: '6', connectionId: '2', conversationId: conversation3.id, type: 'text', clientMessageId: 'client1', fromId: 'user1', data: { text: 'Hello' }, createdAt: time, deletedAt: time },
    { id: '7', connectionId: '3', conversationId: conversation1.id, type: 'text', clientMessageId: 'client1', fromId: 'user3', data: { text: 'Hello' }, createdAt: time, updatedAt: time },
    { id: '8', connectionId: '4', conversationId: conversation1.id, type: 'wrong_type' as MessageType, clientMessageId: 'client1', fromId: 'user1', data: { text: 'Hello' }, createdAt: time, updatedAt: time },
    { id: '9', connectionId: '5', conversationId: conversation2.id, type: 'text', clientMessageId: 'client1', fromId: 'user2', data: { text: 'Mock message 3' }, createdAt: new Date('2026-01-31') },
    { id: '10', connectionId: '6', conversationId: conversation3.id, type: 'text', clientMessageId: 'client1', fromId: 'user1', data: { text: 'Hello' }, createdAt: new Date('2025-01-01'), updatedAt: time },
];

const currentTime = new Date('2024-08-01T00:00:00.000Z');
jest.useFakeTimers().setSystemTime(currentTime);

describe('saveInstance', () => {
    it('should save instance', async () => {
        let result = await saveInstance();
        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        const store = await initialize();

        result = await store.saveConnection('user1', result._id);

        expect(result.result).toBe('created');
    });
});

describe('saveMessage', () => {
    let store: MessageStore;

    beforeEach(async () => {
        store = await initialize();
    });

    it('should create a new message if the message does not exist', async () => {
        let result = await store.saveConversation(conversation1);
        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        const message = {
            id: '1',
            conversationId: conversation1.id,
            text: 'Hello, world!',
        };

        result = await store.saveMessage(message as unknown as Message);

        expect(result._id).toBe('1');
        expect(result.result).toBe('created');
    });

    it('should update an existing message if the message already exists', async () => {
        let result = await store.saveConversation(conversation1);
        expect(result._id).toBe('1');
        expect(result.result).toBe('created');

        const message = {
            id: '1',
            conversationId: conversation1.id,
            text: 'Hello, world!',
        };

        await store.saveMessage(message as unknown as Message);

        message.text = 'Updated message';

        result = await store.saveMessage(message as unknown as Message);

        expect(result._id).toBe('1');
        expect(result.result).toBe('updated');

        const findResult = await store.findMessages({ conversationIds: [conversation1.id] });

        expect(findResult).toEqual({
            messages: [message],
            from: 0,
            size: 100,
            total: 1,
        });
    });
});

describe('findMessages', () => {
    let store;

    beforeEach(async () => {
        store = await initialize();
        let r = await store.saveConversation(conversation1);
        expect(r.result).toBe('created');
        r = await store.saveConversation(conversation2);
        expect(r.result).toBe('created');
        r = await store.saveConversation(conversation3);
        expect(r.result).toBe('created');
        r = await store.saveConversation(conversation4);
        expect(r.result).toBe('created');

        r = await store.saveConversation(conversation4);
        expect(r.result).toBe('updated');

        for (const message of mockMessages) {
            r = await store.saveMessage(message);
            expect(r.result).toBe('created');
        }
    });

    it('should return participant conversation by id', async () => {
        const result1 = await store.getParticipantConversationById('user3', '3');

        expect(result1).toEqual(conversation3);

        const result2 = await store.getParticipantConversationById('user3', '2');

        expect(result2).toBeUndefined();

        const result3 = await store.getParticipantConversationById('user3', '1');

        expect(result3).toBeUndefined();
    });

    it('should return participant conversations', async () => {
        const result1 = await store.getParticipantConversations('user2', undefined, undefined, 1, 3);

        expect(result1).toEqual({
            from: 1,
            size: 3,
            total: 4,
            conversations: [conversation4, conversation2, conversation1],
        });

        const result2 = await store.getParticipantConversations('user2', undefined, undefined, 0, 2);

        expect(result2).toEqual({
            from: 0,
            size: 2,
            total: 4,
            conversations: [conversation3, conversation4],
        });

        console.log('result2', result2);

        const result3 = await store.getParticipantConversations('user3');

        expect(result3).toEqual({
            from: 0,
            size: 100,
            total: 1,
            conversations: [conversation3],
        });

        const result4 = await store.getParticipantConversations('user3', undefined, undefined, 1);

        expect(result4).toEqual({
            from: 1,
            size: 100,
            total: 1,
            conversations: [],
        });

        const result5 = await store.getParticipantConversations('user4');

        expect(result5).toEqual({
            from: 0,
            size: 100,
            total: 0,
            conversations: [],
        });
    });

    it('should return filtered messages based on the provided request', async () => {
        const request = {
            ids: ['1', '2', '3', '5', '6', '7', '8', '9'],
            conversationIds: [] as string[],
            excludeIds: ['4', '5'],
            text: 'Hello',
            fromIds: ['user1', 'user2'],
            types: ['text', 'file'],
            clientMessageIds: ['client1', 'client2'],
            createdFrom: new Date('2022-01-01'),
            createdTo: new Date('2025-01-31'),
            sort: 'createdAt',
            sortDesc: true,
            size: 10,
            from: 0,
        };

        const result1 = await store.findMessages(request);

        expect(result1.messages).toHaveLength(1);
        expect(result1.total).toBe(1);
        expect(result1.messages[0].id).toBe(mockMessages[0].id);

        request.ids = [];
        request.conversationIds = [conversation1.id, conversation2.id];
        request.text = '';

        const result2 = await store.findMessages(request);

        expect(result2.messages).toHaveLength(1);
        expect(result2.total).toBe(1);
        expect(result2.messages[0].id).toBe(mockMessages[0].id);

        request.conversationIds = [];
        const result3 = await store.findMessages(request);

        expect(result3.messages).toHaveLength(2);
        expect(result3.total).toBe(2);
        expect(result3.messages[0].id).toBe(mockMessages[9].id);
        expect(result3.messages[1].id).toBe(mockMessages[0].id);

        request.sortDesc = false;
        const result4 = await store.findMessages(request);

        expect(result4.messages).toHaveLength(2);
        expect(result4.total).toBe(2);
        expect(result4.messages[1].id).toBe(mockMessages[9].id);
        expect(result4.messages[0].id).toBe(mockMessages[0].id);
    });

    it('should return an empty array if no messages match the provided request', async () => {
        const request = {
            ids: ['4', '5'],
            excludeIds: ['1', '2', '3'],
            text: 'Goodbye',
            fromIds: ['user3', 'user4'],
            types: ['audio', 'video'],
            clientMessageIds: ['client3', 'client4'],
            createdFrom: new Date('2022-02-01'),
            createdTo: new Date('2022-02-28'),
            sort: 'updatedAt',
            sortDesc: false,
            size: 10,
            from: 0,
        };

        const result = await store.findMessages(request);

        expect(result.messages).toHaveLength(0);
        expect(result.total).toBe(0);
    });
});

describe('conversations', () => {
    it('should create peer to peer conversation', async () => {
        const store = await initialize();

        const result1 = await store.getPeerToPeerConversationId('user1', 'user2');

        const id = '1';

        expect(result1).toEqual({
            id,
            result: 'created',
        });

        const result2 = await store.getParticipantConversationById(undefined, id);

        expect(result2).toEqual({
            id,
            participants: [],
            createdBy: '',
            createdAt: currentTime,
        });
    });
});

describe('conversation messages', () => {
    it('should return last messages', async () => {
        const store = await initialize();

        let r = await store.saveConversation(conversation1);
        expect(r.result).toBe('created');
        r = await store.saveConversation(conversation2);
        expect(r.result).toBe('created');
        r = await store.saveConversation(conversation3);
        expect(r.result).toBe('created');
        r = await store.saveConversation(conversation5);
        expect(r.result).toBe('created');

        for (const message of mockMessages) {
            r = await store.saveMessage(message);
            expect(r.result).toBe('created');
        }

        const result = await store.getLastMessagesTimestamps('user1', ['1', '2', '5']);

        expect(result).toEqual({
            '1': {
                latest: { ...mockMessages[6] },
                left: time,
            },
            '2': {
                latest: { ...mockMessages[8] },
                left: undefined,
            },
        });

        const result2 = await store.getParticipantLastMessage('user1', '1');
        expect(result2).toEqual(mockMessages[7]);

        const result3 = await store.getParticipantLastMessage('user1', '2');
        expect(result3).toBeUndefined();

        const result4 = await store.getParticipantLastMessage('user3', '2');
        expect(result4).toBeUndefined();

        const result5 = await store.getParticipantLastMessage('user5', '5');
        expect(result5).toBeUndefined();

        const result6 = await store.getParticipantLastMessage('user5', '6');
        expect(result6).toBeUndefined();
    });
});

describe('conversations', () => {
    it('should not return conversations', async () => {
        const store = await initialize();

        let r = await store.saveConversation(conversation1);
        expect(r.result).toBe('created');
        
        r = await store.saveConversation(conversation5);
        expect(r.result).toBe('created');

        const result1 = await store.getParticipantConversationById('user1', '6');
        expect(result1).toBeUndefined();

        const result2 = await store.getParticipantConversationById('user6', conversation5.id);
        expect(result2).toBeUndefined(); 
    });
});