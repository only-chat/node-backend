import type { AuthenticationInfo, UserStore } from '@only-chat/types/userStore.js';
import type { Conversation, ConversationUpdate, ConversationsResult, FileMessage, FindRequest, FindResult, Message as StoreMessage, MessageDelete, MessageStore, MessageData, MessageType as StoreMessageType, MessageUpdate, TextMessage } from '@only-chat/types/store.js';
import type { Log } from '@only-chat/types/log.js';
import type { Message as QueueMessage, MessageData as QueueMessageData, MessageQueue, MessageType as QueueMessageType } from '@only-chat/types/queue.js';
import type { Transport } from '@only-chat/types/transport.js';

export enum TransportState {
    /** The connection is not yet open. */
    CONNECTING = 0,
    /** The connection is open and ready to communicate. */
    OPEN,
    /** The connection is in the process of closing. */
    CLOSING,
    /** The connection is closed. */
    CLOSED,
}

export interface Config {
    queue: MessageQueue;
    store: MessageStore;
    userStore: UserStore;
    instanceId: string;
}

export interface LoadRequest {
    from?: number
    size?: number
    ids?: string[]
    excludeIds?: string[]
    before?: Date
}

interface JoinRequest {
    conversationId?: string;
    title?: string;
    messagesSize?: number;
    participants?: string[];
}

type RequestType = 'join' | 'watch' | 'close' | 'delete' | 'update' | 'load' | 'load-messages' | 'message-update' | 'message-delete' | 'find' | QueueMessageType;

type RequestData = FindRequest | JoinRequest | LoadRequest | QueueMessageData;

interface Request {
    type: RequestType;
    clientMessageId?: string;
    data: RequestData;
}

interface ConnectRequest {
    authInfo: AuthenticationInfo;
    conversationsSize?: number;
}

interface ConversationInfo {
    participants: Set<string>;
    clients: WsClient[];
}

export enum WsClientState {
    None = 0,
    Authenticated = 1,
    Connected = 2,
    Session = 3,
    WatchSession = 4,
    Disconnected = 0xFF,
}

const defaultSize = 100;

const sendStates = [WsClientState.Connected, WsClientState.Session, WsClientState.WatchSession];

const connectedRequestTypes: RequestType[] = ['close', 'delete', 'find', 'load', 'update'];

const types: StoreMessageType[] = ['file', 'text'];

let instanceId: string = undefined!;
let logger: Log | undefined;
let queue: MessageQueue = undefined!;
let store: MessageStore = undefined!;
let userStore: UserStore = undefined!;

export class WsClient {
    // These members are public for testing purposes only
    public static readonly connectedClients: Set<string> = new Set();
    public static readonly watchers: Map<string, WsClient> = new Map();
    public static readonly conversations: Map<string, ConversationInfo> = new Map();
    public static readonly joinedParticipants: Map<string, Set<string>> = new Map();

    private static readonly conversationsCache: Map<string, Set<string>> = new Map();

    public connectionId?: string;
    public conversation?: Conversation;
    public state = WsClientState.None;
    public id?: string;

    private readonly transport: Transport;
    private lastError?: string;

    constructor(t: Transport) {
        this.transport = t;

        t.on('message', this.onMessage.bind(this));
        t.once('close', this.onClose.bind(this));

        t.send(JSON.stringify({ type: 'hello', instanceId }), { binary: false, fin: true });
    }

    static async addClient(conversation: Conversation, wc: WsClient) {
        let info = WsClient.conversations.get(conversation.id!);
        if (!info) {
            info = { participants: new Set<string>(conversation.participants), clients: [wc] };
            WsClient.conversations.set(conversation.id!, info);
            WsClient.conversationsCache.delete(conversation.id!)
        } else {
            info.clients.push(wc);
        }

        for (const c of info.clients) {
            if (c.id && !info.participants.has(c.id)) {
                await c.stop('Removed by new participant');
            }
        }
    }

    private static removeClient(conversationId: string, wc: WsClient) {
        const info = WsClient.conversations.get(conversationId);

        if (!info) {
            return false;
        }

        const index = info.clients.indexOf(wc);
        if (index < 0) {
            return false;
        }

        info.clients.splice(index, 1);

        if (!info.clients.length) {
            WsClient.conversations.delete(conversationId);

            for (const id of info.participants) {
                if (WsClient.watchers.has(id)) {
                    WsClient.conversationsCache.set(conversationId, info.participants);
                    break;
                }
            }
        }
        return true;
    }

    private static addWatchClient(wc: WsClient): boolean {
        if (wc.id) {
            WsClient.watchers.set(wc.id, wc);
            return true;
        }

        return false;
    }

    private static removeWatchClient(wc: WsClient): boolean {
        if (!wc.id) {
            return false;
        }

        const result = WsClient.watchers.delete(wc.id);

        if (result) {
            const toRemove: string[] = [];
            WsClient.conversationsCache.forEach((v, k) => {
                if (v.has(wc.id!)) {
                    for (const id of v) {
                        if (WsClient.watchers.has(id)) {
                            return;
                        }
                    }
                    toRemove.push(k);
                }
            });

            toRemove.forEach(WsClient.conversationsCache.delete);
        }

        return result;
    }

    private static publishToWatchList(userId: string, action: (client: WsClient) => void) {
        if (!WsClient.watchers.size) {
            return;
        }

        const clients: Set<string> = new Set<string>([userId]);

        WsClient.conversations.forEach(info => {
            if (info.participants.has(userId)) {
                info.participants.forEach(p => clients.add(p));
            }
        });

        WsClient.conversationsCache.forEach(participants => {
            if (participants.has(userId)) {
                participants.forEach(p => clients.add(p));
            }
        })

        clients.forEach(c => {
            const client = WsClient.watchers.get(c);
            client && action(client);
        });
    }

    private static async getConversationParticipants(conversationId: string): Promise<Set<string> | undefined> {
        const info = WsClient.conversations.get(conversationId);
        if (info) {
            return info.participants;
        }

        let participants = WsClient.conversationsCache.get(conversationId);

        if (!participants) {
            const conversation = await store.getParticipantConversationById(undefined, conversationId);
            if (!conversation) {
                return;
            }

            participants = new Set<string>(conversation.participants);
            WsClient.conversationsCache.set(conversationId, participants);
        }

        return participants;
    }

    private static async publishToWsList(conversationId: string, action: (client: WsClient, a?: Set<string>) => Promise<void>, l?: string[]) {
        const tasks: Promise<void>[] = [];
        const info = WsClient.conversations.get(conversationId);
        if (info) {
            info.clients.forEach(client => {
                l?.push(client.id as string);
                tasks.push(action(client, info.participants));
            });
        }

        if (WsClient.watchers?.size) {
            const participants: Set<string> | undefined = await WsClient.getConversationParticipants(conversationId);
            participants?.forEach(
                id => {
                    const client = WsClient.watchers.get(id);
                    if (client) {
                        l?.push(client.id as string);
                        tasks.push(action(client));
                    }
                }
            );
        }

        return Promise.all(tasks);
    }

    private static async syncConversation(conversationId: string): Promise<boolean> {
        const conversation = await store.getParticipantConversationById(undefined, conversationId);
        if (!conversation) {
            return false;
        }

        WsClient.conversationsCache.delete(conversationId);

        const info = WsClient.conversations.get(conversationId);

        if (info) {
            const eqSet = (a: Set<string>, b: string[]) => {
                return a.size === b.length && b.every(a.has.bind(a));
            }

            if (eqSet(info.participants, conversation.participants)) {
                return false;
            }

            info.participants = new Set<string>(conversation.participants);
        }

        return true;
    }

    public static async translateQueueMessage(qm: QueueMessage) {
        logger?.debug('Queue message received: ' + JSON.stringify(qm));

        if (['connected', 'disconnected'].includes(qm.type)) {
            if (qm.type === 'disconnected') {
                WsClient.connectedClients.delete(qm.fromId);
            }
            else {
                WsClient.connectedClients.add(qm.fromId);
            }

            WsClient.publishToWatchList(qm.fromId, wc => {
                if (qm.connectionId !== wc.connectionId || qm.instanceId !== instanceId) {
                    wc.send({
                        type: qm.type,
                        id: qm.id,
                        connectionId: qm.connectionId,
                        fromId: qm.fromId,
                        createdAt: qm.createdAt,
                    });
                }
            });

            return;
        }

        if (['closed', 'deleted'].includes(qm.type)) {
            const conversationId = (qm.data as ConversationUpdate).conversationId ?? qm.conversationId;
            if (conversationId) {
                await WsClient.publishToWsList(conversationId, async (wc, _) => {
                    if (qm.connectionId !== wc.connectionId || qm.instanceId !== instanceId) {
                        wc.send(qm);
                    }

                    if (wc.conversation?.id === conversationId && qm.type === 'deleted') {
                        await wc.stop('Deleted');
                    }
                });

                if (qm.type === 'deleted') {
                    WsClient.conversationsCache.delete(conversationId);
                }
            }

            return;
        }

        switch (qm.type) {
            case 'text':
            case 'file':
                if (null === qm.data) {
                    break;
                }
            /* FALLTHROUGH */
            case 'joined':
            case 'left':
            case 'message-updated':
            case 'message-deleted':
                if (qm.conversationId) {
                    switch (qm.type) {
                        case 'joined':
                            {
                                const participants = WsClient.joinedParticipants.get(qm.conversationId);
                                if (participants) {
                                    participants.add(qm.fromId);
                                } else {
                                    WsClient.joinedParticipants.set(qm.conversationId, new Set([qm.fromId]));
                                }
                            }
                            break;
                        case 'left':
                            {
                                const participants = WsClient.joinedParticipants.get(qm.conversationId);
                                if (participants) {
                                    participants.delete(qm.fromId);
                                    if (!participants.size) {
                                        WsClient.joinedParticipants.delete(qm.conversationId);
                                    }
                                }
                            }
                            break;
                    }

                    const ids: string[] = [];
                    await WsClient.publishToWsList(qm.conversationId, async (wc, _) => {
                        wc.send(qm);
                    }, ids);
                }
                break;

            case 'updated':
                {
                    const conversationId = (qm.data as ConversationUpdate).conversationId ?? qm.conversationId;

                    if (conversationId) {
                        const updated = await WsClient.syncConversation(conversationId);

                        await WsClient.publishToWsList(conversationId, async (wc, participants) => {
                            wc.send(qm);

                            if (updated && false === participants?.has(wc.id!)) {
                                await wc.stop('Removed');
                            }
                        });
                    }
                }
                break;
        }
    }

    private async publishMessage(type: QueueMessageType, clientMessageId: string | undefined, data: RequestData, save: boolean): Promise<boolean> {
        let id: string | undefined = undefined;
        const createdAt = new Date();

        if (save) {
            const m: StoreMessage = {
                type: type as StoreMessageType,
                conversationId: this.conversation?.id,
                participants: this.conversation?.participants,
                connectionId: this.connectionId!,
                fromId: this.id!,
                clientMessageId: clientMessageId,
                createdAt,
                data: data as MessageData,
            };

            const response = await store.saveMessage(m);
            if (response.result !== 'created') {
                logger?.error(`Index message failed`);
                return false;
            }

            id = response?._id;
        }

        if (!Array.isArray(queue.acceptTypes) || (queue.acceptTypes as string[]).includes(type)) {
            return await queue.publish({
                type,
                id,
                instanceId,
                conversationId: this.conversation?.id,
                participants: this.conversation?.participants,
                connectionId: this.connectionId!,
                fromId: this.id!,
                clientMessageId: clientMessageId,
                createdAt,
                data: data as QueueMessageData,
            });
        }

        return true;
    }

    private send(msg: unknown) {
        if (this.transport && this.transport.readyState === TransportState.OPEN && sendStates.includes(this.state)) {
            return this.transport.send(JSON.stringify(msg), { binary: false, fin: true });
        }
    }

    private async stop(statusDescription: string, err?: any) {
        if (logger && err?.message) {
            logger.error(err.message);
        }

        if (this.state === WsClientState.Disconnected) {
            return;
        }

        this.state = WsClientState.Disconnected;

        const maxStatusLen = 123;
        const dotSpace = '. ';

        [this.lastError, err?.message].forEach(v => {
            if (v && statusDescription.length + dotSpace.length < maxStatusLen) {
                statusDescription += dotSpace + v.substring(0, maxStatusLen - statusDescription.length - dotSpace.length);
            }
        });

        if (this.connectionId && this.id) {
            if (this.conversation) {
                await this.publishMessage('left', undefined, null, true);
            }

            await this.publishMessage('disconnected', undefined, null, false);
        }

        if ([TransportState.CLOSING, TransportState.CLOSED].includes(this.transport.readyState)) {
            return;
        }

        if (statusDescription.length > maxStatusLen) {
            statusDescription = statusDescription.substring(0, maxStatusLen);
        }

        this.transport.close(err ? 1011 : 1000, statusDescription);
        this.transport.removeAllListeners();
    }

    private async watch(): Promise<void> {
        this.state = WsClientState.WatchSession;

        const conversations = await this.getConversations(0, 0);

        WsClient.addWatchClient(this);

        this.send({ type: 'watching', conversations });

        logger?.debug(`Watch client with id ${this.id} added successfully`);
    }

    private async join(request: Request): Promise<boolean> {
        let conversation: Conversation | undefined;
        let created = false;

        const data = request.data as JoinRequest;

        if (data.conversationId) {
            conversation = await store.getParticipantConversationById(this.id, data.conversationId);
            if (!conversation?.id) {
                this.lastError = "Wrong conversation";
                return false;
            }
        } else {
            const participants = new Set<string>(data.participants?.map(p => p.trim()).filter(s => s.length));
            participants.add(this.id!);

            if (participants.size < 2) {
                this.lastError = "Less than 2 participants";
                return false;
            }

            let conversationId: string | undefined;

            const participantsArray = Array.from(participants);

            if (!data.title && participants.size == 2) {
                conversationId = await store.getPeerToPeerConversationId(participantsArray[0], participantsArray[1]);
                if (!conversationId) {
                    this.lastError = 'Unable to get peer to peer conversation identifier';
                    logger?.error(this.lastError);
                    return false;
                }

                conversation = await store.getParticipantConversationById(this.id, conversationId);
            } else if (!data.title) {
                this.lastError = "Conversation title required";
                return false;
            }

            const conversationsParticipans = conversation ? new Set<string>(conversation.participants) : undefined;

            if (!conversationsParticipans
                || participants.size !== conversationsParticipans.size
                || participantsArray.some(p => !conversationsParticipans.has(p))) {

                const now = new Date();

                conversation = {
                    id: conversationId,
                    participants: participantsArray,
                    title: conversation?.title ?? data.title,
                    createdBy: conversation?.createdBy ?? this.id!,
                    updatedAt: conversation?.createdAt ? now : undefined,
                    createdAt: conversation?.createdAt ?? now,
                };

                const response = await store.saveConversation(conversation);

                created = response.result === 'created';

                if (!created && response.result !== 'updated') {
                    logger?.error(`Save conversation with id ${conversation.id} failed`);
                    this.lastError = "Save conversation failed";
                    return false;
                }

                conversation.id = response._id;
            }
        }

        this.state = WsClientState.Session;

        this.conversation = conversation;

        await WsClient.addClient(conversation!, this);

        const size = data.messagesSize ?? defaultSize;

        let lastMessage: StoreMessage | undefined = undefined;
        let messages: FindResult | undefined = undefined;
        if (!created) {
            const fr: FindRequest = {
                size,
                conversationIds: [conversation!.id!],
                types,
                sort: 'createdAt',
                sortDesc: true,
            }

            messages = await store.findMessages(fr);
            lastMessage = await store.getParticipantLastMessage(this.id!, conversation!.id!);
        }

        const connected = conversation!.participants.filter(p => p === this.id || WsClient.joinedParticipants.get(conversation!.id!)?.has(p));

        const joined = {
            type: 'conversation',
            clientMessageId: request.clientMessageId,
            conversation,
            connected,
            messages,
            leftAt: lastMessage?.createdAt,
        };

        this.send(joined);

        logger?.debug(`Client with id ${this.id} added successfully`);

        return this.publishMessage('joined', request.clientMessageId, null, true);
    }

    private onMessage(data: Buffer, isBinary: boolean) {
        try {
            if (!(data instanceof Buffer)) {
                throw new Error('Wrong message');
            }

            if (isBinary) {
                throw new Error('Binary message received!');
            }

            if (sendStates.includes(this.state)) {
                const msg: Request = JSON.parse(data.toString());

                if (connectedRequestTypes.includes(msg.type)) {
                    this.processRequest(msg).then(result => {
                        if (!result) {
                            this.stop('Failed processRequest');
                        }
                    }).catch(e => {
                        this.stop('Failed processRequest', e);
                    });

                    return;
                }
            }

            switch (this.state) {
                case WsClientState.None:
                    {
                        const request: ConnectRequest = JSON.parse(data.toString());
                        this.connect(request).then(response => {
                            if (!response) {
                                this.stop('Failed connect');
                            }
                        }).catch(e => {
                            this.stop('Failed connect', e);
                        });
                    }
                    break;
                case WsClientState.Connected:
                    {
                        const request: Request = JSON.parse(data.toString());

                        switch (request.type) {
                            case 'join':
                                this.join(request).then(response => {
                                    if (!response) {
                                        this.stop('Failed join');
                                    }
                                }).catch(e => {
                                    this.stop('Failed join', e);
                                });
                                break;
                            case 'watch':
                                this.watch().catch(e => {
                                    this.stop('Failed watch', e);
                                });
                                break;
                            default:
                                throw new Error('Wrong request type');
                        }
                    }
                    break;
                case WsClientState.Session:
                case WsClientState.WatchSession:
                    {
                        const request: Request = JSON.parse(data.toString());

                        if (request) {
                            this.processConversationRequest(request).then(result => {
                                if (!result) {
                                    this.stop('Failed processConversationRequest');
                                }
                            }).catch(e => {
                                this.stop('Failed processConversationRequest', e);
                            });
                        } else {
                            this.stop('Wrong message');
                        }
                    }
                    break;
                case WsClientState.Disconnected:
                    break;
            }
        }
        catch (e: any) {
            this.stop('Failed message processing', e);
        }
    }

    private onClose() {
        this.stop('Stopped').finally(() => {

            if (this.conversation?.id) {
                WsClient.removeClient(this.conversation.id, this);
                logger?.debug(`Client with id ${this.id} removed successfully`);
            }
            else if (WsClientState.WatchSession === this.state) {
                WsClient.removeWatchClient(this);
                logger?.debug(`Watch client with id ${this.id} removed successfully`);
            }

            delete this.conversation;
        });
    }

    private async deleteMessage(request: MessageDelete): Promise<boolean> {
        const findResult = await store.findMessages({
            ids: [request.messageId],
            conversationIds: [this.conversation!.id!],
        });

        const message = findResult.messages?.[0];

        if (!message || message.fromId != this.id) {
            this.lastError = 'User is not allowed to delete message';
            return false;
        }

        message.deletedAt = request.deletedAt;

        const response = await store.saveMessage(message);

        if (response.result !== 'updated') {
            logger?.error(`Delete message with id ${message.id} failed`);
            this.lastError = 'Delete message failed';
            return false;
        }

        logger?.debug(`Message with id ${message.id} was deleted successfully`);

        return true;
    }

    private async updateMessage(request: MessageUpdate): Promise<boolean> {
        const findResult = await store.findMessages({
            ids: [request.messageId],
            conversationIds: [this.conversation!.id!],
        });

        const message = findResult.messages?.[0];

        if (!message) {
            this.lastError = 'Wrong message';
            return false;
        }

        if (message.fromId !== this.id) {
            this.lastError = 'User is not allowed to update message';
            return false;
        }

        switch (message.type) {
            case 'file':
                {
                    const { link, name, type, size } = request as FileMessage;
                    if (!name) {
                        this.lastError = 'Wrong file name';
                        return false;
                    }
                    message.data = { link, name, type, size };
                }
                break;
            case 'text':
                {
                    const { text } = request as TextMessage;
                    message.data = { text };
                }
                break;
        }

        message.updatedAt = request.updatedAt;

        const response = await store.saveMessage(message);

        if (response.result !== 'updated') {
            logger?.error(`Update message with id ${message.id} failed`);
            this.lastError = 'Update message failed';
            return false;
        }

        logger?.debug(`Message with id ${message.id} was updated successfully`);

        return true;
    }

    private async updateConversation(data: ConversationUpdate): Promise<boolean> {
        const conversation = data.conversationId ? await store.getParticipantConversationById(this.id, data.conversationId) : this.conversation;

        if (!conversation || this.id !== conversation.createdBy) {
            //Only creator can update conversation
            this.lastError = 'User is not allowed to update conversation';
            return false;
        }

        conversation.title = data.title;

        conversation.updatedAt = data.updatedAt;

        conversation.participants = data.participants!;

        const response = await store.saveConversation(conversation);

        if (response.result !== 'updated') {
            logger?.error(`Update conversation with id ${conversation.id} failed`);
            this.lastError = 'Update conversation failed';
            return false;
        }

        logger?.debug(`Conversation with id ${conversation.id} was updated successfully`);

        return true;
    }

    private async closeDeleteConversation(data: ConversationUpdate, del: boolean): Promise<QueueMessageType | null> {
        const id = data.conversationId ?? this.conversation?.id;
        if (!id) {
            this.lastError = 'Wrong conversation identifier';
            return null;
        }

        const conversation = await store.getParticipantConversationById(this.id, id);

        if (!conversation) {
            //Only creator can close or delete conversation
            this.lastError = 'Conversation not found';
            return null;
        }

        if (!del && conversation.closedAt) {
            this.lastError = 'Conversation already closed';
            return null;
        }

        if (conversation.deletedAt) {
            this.lastError = 'Conversation already deleted';
            return null;
        }

        let type: QueueMessageType = 'updated';

        if (this.id === conversation.createdBy) {
            //Only creator can close or delete conversation
            conversation.closedAt = data.closedAt;

            if (del) {
                conversation.deletedAt = data.deletedAt;
                type = 'deleted';
            } else {
                type = 'closed';
            }
        } else if (del) {
            //leave conversation
            const count = conversation.participants.length;
            conversation.participants = conversation.participants.filter(p => p !== this.id);
            if (count === conversation.participants.length) {
                this.lastError = 'User is not allowed to delete conversation';
                return null;
            }

            data.participants = conversation.participants;
        } else {
            this.lastError = 'User is not allowed to close conversation';
            return null;
        }

        const response = await store.saveConversation(conversation);

        if (response.result !== 'updated') {
            logger?.error(`Close conversation with id ${conversation.id} failed`);
            this.lastError = 'Close conversation failed';
            return null;
        }

        logger?.debug(`Conversation with id ${conversation.id} was updated successfully`);

        return type;
    }

    private async processRequest(request: Request): Promise<boolean> {
        if (!request.data) {
            this.lastError = 'Wrong message';
            return false;
        }

        const clientMessageId = request.clientMessageId;

        switch (request.type) {
            case 'close':
            case 'delete':
                {
                    const { conversationId } = request.data as ConversationUpdate;
                    const now = new Date();
                    const data: ConversationUpdate = {
                        conversationId,
                        closedAt: now,
                    };

                    const del = request.type === 'delete';
                    if (del) {
                        data.deletedAt = now;
                    }

                    const type: QueueMessageType | null = await this.closeDeleteConversation(data, del);
                    if (type) {

                        this.send({ type, clientMessageId, data });

                        return this.publishMessage(type, clientMessageId, data, true);
                    }
                }
                break;
            case 'find':
                await this.findMessages(request.data as FindRequest, clientMessageId);
                return true;
            case 'load':
                await this.loadConversations(request.data as LoadRequest, clientMessageId);
                return true;
            case 'update':
                {
                    const { conversationId, title, participants } = request.data as ConversationUpdate;
                    const participantsSet = new Set([this.id!]);

                    participants?.forEach(p => participantsSet.add(p.trim()));

                    const data: ConversationUpdate = {
                        conversationId,
                        title,
                        participants: Array.from(participantsSet),
                        updatedAt: new Date(),
                    };

                    if (await this.updateConversation(data)) {
                        const type: QueueMessageType = 'updated';

                        this.send({ type, clientMessageId, data });

                        return this.publishMessage(type, clientMessageId, data, true);
                    }
                }
                break;
        }

        return false;
    }

    private async processConversationRequest(request: Request): Promise<boolean> {
        if (!request.data) {
            this.lastError = 'Wrong message';
            return false;
        }

        const verifyConversation = () => {
            if (this.conversation!.closedAt) {
                this.lastError = 'Conversation closed';
                return false;
            }
            return true;
        }

        let broadcastType = request.type as QueueMessageType;

        switch (request.type) {
            case 'text':
                if (!verifyConversation()) {
                    return false;
                }
                break;
            case 'file':
                if (!verifyConversation()) {
                    return false;
                }

                if (!(request.data as FileMessage).name) {
                    this.lastError = 'Wrong file name';
                    return false;
                }
                break;
            case 'message-update':
                (request.data as MessageUpdate).updatedAt = new Date();
                if (!await this.updateMessage(request.data as MessageUpdate)) {
                    return false;
                }

                broadcastType = 'message-updated';
                break;
            case 'message-delete':
                (request.data as MessageDelete).deletedAt = new Date();
                if (!await this.deleteMessage(request.data as MessageDelete)) {
                    return false;
                }

                broadcastType = 'message-deleted';
                break;
            case 'load-messages':
                await this.loadMessages(request.data as LoadRequest, request.clientMessageId);
                return true;
            default:
                this.lastError = 'Wrong message type';
                return false;
        }

        return this.publishMessage(broadcastType, request.clientMessageId, request.data, true);
    }

    private async connect(request: ConnectRequest): Promise<boolean> {

        this.id = request?.authInfo && await userStore.authenticate(request.authInfo);

        if (!this.id) {
            this.lastError = 'Authentication failed';
            return false;
        }

        this.state = WsClientState.Authenticated;

        const response = await store.saveConnection(this.id, instanceId);

        if (response.result !== 'created') {
            logger?.debug(`Save connection with id ${response._id} failed`);
            return false;
        }

        this.state = WsClientState.Connected;

        this.connectionId = response._id;

        logger?.debug(`Save connection with id ${this.connectionId} succeeded`);

        const conversations = await this.getConversations(0, request.conversationsSize);

        this.transport.send(JSON.stringify({
            type: 'connection',
            connectionId: this.connectionId,
            id: this.id,
            conversations,
        }), { binary: false, fin: true });

        return this.publishMessage('connected', undefined, null, false);
    }

    private async getConversations(from: number = 0, conversationsSize?: number, ids?: string[], excludeIds?: string[]): Promise<ConversationsResult> {

        const size = conversationsSize != null && conversationsSize >= 0 ? conversationsSize : defaultSize;

        const result = await store.getParticipantConversations(this.id!, ids, excludeIds, from, size);

        const conversationIds = result.conversations.map(c => c.id!);

        if (!conversationIds?.length) {
            return result;
        }

        const messagesInfo = await store.getLastMessagesTimestamps(this.id!, conversationIds);

        const conversations = result.conversations.map(c => ({
            ...c,
            leftAt: c.id! in messagesInfo ? messagesInfo[c.id!].left : undefined,
            latestMessage: c.id! in messagesInfo ? messagesInfo[c.id!].latest : undefined,
            connected: c.participants.filter(p => WsClient.joinedParticipants.get(c.id!)?.has(p)),
        }));

        return {
            conversations,
            from,
            size,
            total: result.total,
        }
    }

    private async findMessages(request: FindRequest, clientMessageId?: string): Promise<void> {
        const result = await store.getParticipantConversations(this.id!, request.conversationIds, undefined, request.from ?? 0, request.size ?? defaultSize);

        request.conversationIds = result.conversations.map(c => c.id!);

        const findResult: FindResult = await store.findMessages(request);

        this.send({ type: 'find', clientMessageId, messages: findResult.messages, from: findResult.from, size: findResult.size, total: findResult.total });
    }

    private async loadMessages(request: LoadRequest, clientMessageId?: string): Promise<void> {
        if (!this.conversation?.id) {
            return;
        }

        const findRequest: FindRequest =
        {
            from: request.from,
            size: request.size,
            sort: 'createdAt',
            sortDesc: true,
            conversationIds: [this.conversation.id],
            createdTo: request.before,
            types,
            excludeIds: request.excludeIds,
        };

        const result: FindResult = await store.findMessages(findRequest);

        result.messages.reverse();

        this.send({ type: 'loaded-messages', clientMessageId, messages: result.messages, count: result.total });
    }

    private async loadConversations(request: LoadRequest, clientMessageId?: string): Promise<void> {
        const result = await this.getConversations(request.from, request.size, request.ids, request.excludeIds);

        this.send({ type: 'loaded', clientMessageId, conversations: result.conversations, count: result.total });
    }
}

export function initialize(config: Config, log?: Log) {
    instanceId = config.instanceId;
    logger = log;
    queue = config.queue;
    store = config.store;
    userStore = config.userStore;

    queue?.subscribe(WsClient.translateQueueMessage);
}