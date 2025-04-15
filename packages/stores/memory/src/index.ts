import type { Conversation, ConversationLastMessages, ConversationIdResult, ConversationsResult, FindRequest, FindResult, Message, MessageStore, TextMessage, SaveResponse } from '@only-chat/types/store.js';

let connectionId = 0;
let conversationId = 0;
let instanceId = 0;
let messageId = 0;

let conversations = new Map<string, { conversation: Conversation, messages: string[] }>();
let messages = new Map<string, Message>();
let peerToPeerConversations = new Map<string, string>();

async function findMessages(r: FindRequest): Promise<FindResult> {
    function filterMessage(m: Message, r: FindRequest): boolean {
        if (m.deletedAt) {
            return false;
        }

        if ((r.excludeIds as (string | undefined)[])?.includes(m.id)) {
            return false;
        }

        if (r.text) {
            if (m.type !== 'text' || !(m.data as TextMessage)?.text.includes(r.text)) {
                return false;
            }
        }

        if (r.fromIds?.length) {
            if (!r.fromIds.includes(m.fromId)) {
                return false;
            }
        }

        if (r.types?.length) {
            if (!r.types.includes(m.type)) {
                return false;
            }
        }

        if (r.clientMessageIds?.length) {
            if (!(r.clientMessageIds as (string | undefined)[]).includes(m.clientMessageId)) {
                return false;
            }
        }

        if (r.createdFrom) {
            if (m.createdAt < r.createdFrom) {
                return false;
            }
        }

        if (r.createdTo) {
            if (m.createdAt > r.createdTo) {
                return false;
            }
        }

        return true;
    }

    let m: Message[] = [];

    if (r.ids?.length) {
        r.ids.forEach(id => {
            const msg = messages.get(id);
            if (msg && filterMessage(msg, r)) {
                m.push(msg);
            }
        })
    } else if (r.conversationIds?.length) {
        r.conversationIds.forEach(id => {
            const c = conversations.get(id);
            c?.messages.forEach(id => {
                const msg = messages.get(id);
                if (msg && filterMessage(msg, r)) {
                    m.push(msg);
                }
            })
        })
    } else {
        m = Array.from(messages.values()).filter(m => filterMessage(m, r));
    }

    if (r.sort) {
        const sortOrder = r.sortDesc ? 'desc' : 'asc';

        m.sort((msg1, msg2) => {
            if (sortOrder == 'desc') {
                return msg1[r.sort!] > msg2[r.sort!] ? -1 : 1;
            }

            return msg1[r.sort!] < msg2[r.sort!] ? -1 : 1;
        })
    }

    if (r.size !== 0 && !r.size || r.size < 0) {
        r.size = 100;
    }

    if (!r.from || r.from < 0) {
        r.from = 0;
    }

    return {
        messages: m.slice(r.from, r.from + r.size),
        from: r.from,
        size: r.size,
        total: m.length,
    };
}

async function getLastMessagesTimestamps(participant: string, conversationId: string[]): Promise<ConversationLastMessages> {
    const result: ConversationLastMessages = {};
    for (const id of conversationId) {
        const c = conversations.get(id);
        if (!c || c.conversation.deletedAt || c.messages.length < 1) {
            continue
        }

        const latest = c.messages.findLast(m => {
            const msg = messages.get(m);
            return !msg!.deletedAt && (['file', 'text'] as (string | undefined)[]).includes(msg!.type);
        });

        const lastFromId = c.messages.findLast(m => {
            const msg = messages.get(m);
            return !msg!.deletedAt && msg!.fromId === participant;
        });

        result[id] = {
            latest: latest ? messages.get(latest) : undefined,
            left: lastFromId ? messages.get(lastFromId)?.createdAt : undefined,
        }
    }

    return result;
}

async function getParticipantConversationById(participant: string | undefined, id: string): Promise<Conversation | undefined> {
    const c = conversations.get(id);

    if (!c?.conversation) {
        return undefined;
    }

    if (c.conversation.deletedAt) {
        return undefined;
    }

    if (participant) {
        if (!c.conversation.participants.includes(participant)) {
            return undefined;
        }
    }

    return c.conversation;
}

async function getParticipantConversations(participant: string, ids: string[] | undefined, excludeIds: string[] = [], from: number = 0, size: number = 100): Promise<ConversationsResult> {
    const result: Conversation[] = [];

    const filteredConversations = Array.from(conversations.values(), v => v.conversation).filter(c => (ids ? ids.includes(c.id!) : true) && !excludeIds.includes(c.id!));
    const sortedConversations = filteredConversations.sort((a, b) => {
        if (a.createdAt == b.createdAt) {
            return a.id! < b.id! ? 1 : -1;
        }

        return a.createdAt < b.createdAt ? 1 : -1;
    });

    let start = from;
    let total = 0;

    for (const c of sortedConversations) {
        if (!c.deletedAt) {
            if (c.participants.includes(participant)) {
                ++total;
                if (start < 1) {
                    if (result.length < size) {
                        result.push(c);
                    }
                } else {
                    --start;
                }
            }
        }
    }

    return {
        conversations: result,
        from,
        size,
        total,
    };
}

async function getParticipantLastMessage(participant: string, conversationId: string): Promise<Message | undefined> {
    const c = conversations.get(conversationId);

    if (!c) {
        return undefined;
    }

    if (c.conversation.deletedAt) {
        return undefined;
    }

    if (!c.conversation.participants.includes(participant)) {
        return undefined;
    }

    const lastFromId = c.messages.findLast(m => {
        const msg = messages.get(m);
        return !msg!.deletedAt && msg!.fromId === participant;
    });

    return lastFromId ? messages.get(lastFromId) : undefined;
}

async function getPeerToPeerConversationId(peer1: string, peer2: string): Promise<ConversationIdResult | undefined> {
    const id = [peer1, peer2].sort(undefined).join('-');
    let peerToPeerConversationId = peerToPeerConversations.get(id);
    const create = !peerToPeerConversationId;

    if (create) {
        peerToPeerConversationId = (++conversationId).toString();
        conversations.set(peerToPeerConversationId, {
            conversation: {
                id: peerToPeerConversationId,
                participants: [],
                createdBy: '',
                createdAt: new Date(),

            }, messages: []
        });
        peerToPeerConversations.set(id, peerToPeerConversationId);
    }

    return { id: peerToPeerConversationId, result: create ? 'created' : undefined };
}

async function saveConnection(userId: string, instanceId: string): Promise<SaveResponse> {
    return {
        _id: (++connectionId).toString(),
        result: 'created',
    };
}

async function saveConversation(c: Conversation): Promise<SaveResponse> {
    const exists = c.id && conversations.has(c.id);

    const _id = c.id ?? (++conversationId).toString();

    if (exists) {
        conversations.get(_id)!.conversation = c;
    } else {
        conversations.set(_id, { conversation: c, messages: [] });
    }

    return {
        _id,
        result: exists ? 'updated' : 'created',
    };
}

async function saveMessage(m: Message): Promise<SaveResponse> {
    const conversationId = m.conversationId ?? '';
    const exists = m.id && messages.has(m.id) && conversations.has(conversationId);

    const _id = m.id ?? (++messageId).toString();

    messages.set(_id, { ...m, id: _id });

    if (!exists) {
        conversations.get(conversationId)?.messages.push(_id);
    }

    return {
        _id,
        result: exists ? 'updated' : 'created',
    };
}

export async function saveInstance(): Promise<SaveResponse> {
    return {
        _id: (++instanceId).toString(),
        result: 'created',
    };
}

export async function initialize(): Promise<MessageStore> {
    connectionId = 0;
    conversationId = 0;
    instanceId = 0;
    messageId = 0;

    conversations.clear();
    messages.clear();
    peerToPeerConversations.clear();

    return {
        findMessages,
        getLastMessagesTimestamps,
        getParticipantConversationById,
        getParticipantConversations,
        getParticipantLastMessage,
        getPeerToPeerConversationId,
        saveConnection,
        saveConversation,
        saveMessage,
    };
}