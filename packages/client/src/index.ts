import type { AuthenticationInfo, UserStore } from '@only-chat/types/userStore.js';
import type { Conversation, ConversationUpdate, ConversationsResult, FileMessage, FindRequest, FindResult, LoadRequest, Message, MessageData, MessageDelete, MessageStore, MessageType, MessageUpdate } from '@only-chat/types/store.js';
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
    watchConversationId?: string;
}

interface ConversationInfo {
    participants: Set<string>;
    clients: WsClient[];
}

interface JoinRequest {
    type: string;
    clientConversationId?: string;
    participants?: string[];
    conversationId?: string;
    conversationTitle?: string;
}

export enum WsClientState {
    None = 0,
    Authenticated = 1,
    Connected = 2,
    Session = 3,
    WatchSession = 4,
    Disconnected = 0xFF,
}

const sendStates = [WsClientState.Session, WsClientState.WatchSession];

const types: MessageType[] = ['file', 'text'];

let instanceId: string = undefined!;
let logger: Log | undefined;
let queue: MessageQueue = undefined!;
let store: MessageStore = undefined!;
let userStore: UserStore = undefined!;
let watchConversationId: string | undefined;


export class WsClient {
    // These members are public for testing purposes only
    public static connectedClients: Set<string> = new Set();
    public static watchers: Map<string, WsClient> = new Map();
    public static conversations: Map<string, ConversationInfo> = new Map();

    private static conversationsCache: Map<string, Set<string>> = new Map();

    public connectionId?: string;
    public conversation?: Conversation;
    public state = WsClientState.None;
    public id?: string;

    private transport: Transport;
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
            const conversation = await store.getConversationById(conversationId);
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
        const conversation = await store.getConversationById(conversationId);
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
                if (qm.fromConnectionId !== wc.connectionId || qm.instanceId !== instanceId) {
                    wc.send({
                        id: qm.id,
                        fromConnectionId: qm.fromConnectionId,
                        fromId: qm.fromId,
                        type: qm.type,
                        createdAt: qm.createdAt,
                    });
                }
            });

            return;
        }

        if (!qm.conversationId) {
            return;
        }
        
        const msg: Message = {
            id: qm.id,
            conversationId: qm.conversationId,
            participants: qm.participants ?? [],
            fromConnectionId: qm.fromConnectionId,
            fromId: qm.fromId,
            type: qm.type,
            clientMessageId: qm.clientMessageId,
            data: qm.data,
            createdAt: qm.createdAt,
            updatedAt: qm.updatedAt,
        }

        if (['closed', 'deleted'].includes(msg.type)) {
            await WsClient.publishToWsList(msg.conversationId, async (wc, _) => {
                wc.send(msg);

                if (wc.conversation?.id === msg.conversationId && msg.type === 'deleted') {
                    await wc.stop('Deleted');
                }
            });

            if (msg.type === 'deleted') {
                WsClient.conversationsCache.delete(msg.conversationId);
            }

            return;
        }

        switch (msg.type) {
            case 'text':
            case 'file':
                if (null === msg.data) {
                    break;
                }
            /* FALLTHROUGH */
            case 'joined':
            case 'left':
            case 'message-updated':
            case 'message-deleted':
                {
                    const ids: string[] = [];
                    await WsClient.publishToWsList(msg.conversationId, async (wc, _) => {
                        wc.send(msg);
                    }, ids);
                }
                break;

            case 'updated':
                {
                    const updated = await WsClient.syncConversation(msg.conversationId);

                    await WsClient.publishToWsList(msg.conversationId, async (wc, participants) => {
                        wc.send(msg);

                        if (updated && false === participants?.has(wc.id!)) {
                            await wc.stop('Removed');
                        }
                    });
                }
                break;
        }
    }

    private async publishMessage(type: MessageType, clientMessageId: string | undefined, data: MessageData, save: boolean): Promise<boolean> {
        let id: string | undefined = undefined;
        const createdAt = new Date();

        if (save) {
            if (!this.conversation?.id) {
                throw new Error('Failed publishMessage');
            }

            const m: Message = {
                type,
                conversationId: this.conversation.id,
                participants: this.conversation.participants,
                fromConnectionId: this.connectionId!,
                clientMessageId: clientMessageId,
                fromId: this.id!,
                createdAt,
                data: data,
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
                type: type as QueueMessageType,
                id,
                instanceId,
                conversationId: this.conversation?.id,
                participants: this.conversation?.participants,
                fromConnectionId: this.connectionId!,
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

    private async stop(statusDescription = 'Stopped') {
        try {
            if (this.state === WsClientState.Disconnected) {
                return;
            }

            if (this.lastError) {
                statusDescription += '. ' + this.lastError;
            }

            if (TransportState.CLOSED !== this.transport.readyState && TransportState.CLOSING !== this.transport.readyState) {
                if (statusDescription.length > 123) {
                    statusDescription = statusDescription.substring(0, 123);
                }

                this.transport.close(1000, statusDescription);
            }

            this.transport.removeAllListeners();

            this.state = WsClientState.Disconnected;

            if (this.connectionId && this.id) {
                if (this.conversation) {
                    await this.publishMessage('left', undefined, null, true);
                    delete this.conversation;
                }

                await this.publishMessage('disconnected', undefined, null, false);
            }
        }
        catch (e: any) {
            if (!this.lastError) {
                this.lastError += ' ' + e.Message;
            }
            else {
                this.lastError = e.Message;
            }
        }
    }

    private async watch(): Promise<void> {
        this.state = WsClientState.WatchSession;

        const conversations = await this.getConversations();

        WsClient.addWatchClient(this);

        this.send({ type: 'watching', conversations });

        logger?.debug(`Watch client with id ${this.id} added successfully`);
    }

    private async join(request: JoinRequest): Promise<boolean> {
        let conversation: Conversation | undefined;
        let created = false;

        if (request.conversationId) {
            conversation = await store.getParticipantConversationById(this.id, request.conversationId);
            if (!conversation?.id) {
                this.lastError = "Wrong conversation";
                return false;
            }
        } else {
            const participants = new Set<string>(request.participants?.map(p => p.trim()).filter(s => s.length));
            participants.add(this.id!);

            if (participants.size < 2) {
                this.lastError = "Less than 2 participants";
                return false;
            }

            let conversationId: string | undefined;

            const participantsArray = Array.from(participants);

            if (!request.conversationTitle && participants.size == 2) {
                conversationId = await store.getPeerToPeerConversationId(participantsArray[0], participantsArray[1]);
                if (!conversationId) {
                    this.lastError = 'Unable to get peer to peer conversation identifier';
                    logger?.error(this.lastError);
                    return false;
                }

                conversation = await store.getConversationById(conversationId);
            } else if (!request.conversationTitle) {
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
                    clientConversationId: conversation?.clientConversationId || request.clientConversationId,
                    participants: participantsArray,
                    title: conversation?.title || request.conversationTitle,
                    createdBy: conversation?.createdBy || this.id!,
                    updatedAt: conversation?.createdAt ? now : undefined,
                    createdAt: conversation?.createdAt || now,
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

        let lastMessage: Message | undefined = undefined;
        let oldMessages: FindResult | undefined = undefined;
        if (!created) {
            const fr: FindRequest = {
                size: 0,
                conversationIds: [conversation!.id!],
                types,
                sort: 'createdAt',
                sortDesc: true,
            }

            oldMessages = await store.findMessages(fr);
            lastMessage = await store.getParticipantLastMessage(this.id!, conversation!.id!);
        }

        const connected = conversation!.participants.filter(p => WsClient.connectedClients.has(p));

        const joined = {
            type: 'conversation',
            conversation,
            connected,
            messages: oldMessages?.messages.reverse(),
            total: oldMessages?.total,
            leftAt: lastMessage?.createdAt,
            closedAt: conversation!.closedAt,
        };

        this.send(joined);

        logger?.debug(`Client with id ${this.id} added successfully`);

        return this.publishMessage('joined', undefined, null, true);
    }

    private onMessage(data: Buffer, isBinary: boolean) {
        try {
            if (!(data instanceof Buffer)) {
                throw new Error('Wrong message');
            }

            if (isBinary) {
                throw new Error('Binary message received!');
            }

            switch (this.state) {
                case WsClientState.None:
                    {
                        const authInfo: AuthenticationInfo = JSON.parse(data.toString());
                        this.connect(authInfo).then(response => {
                            if (!response) {
                                this.stop('Not connected');
                            }
                        }).catch(e => {
                            this.lastError = e.message;
                            this.stop('Not connected');
                        });
                    }
                    break;
                case WsClientState.Connected:
                    {
                        const request: JoinRequest = JSON.parse(data.toString());

                        if (request.type !== 'join') {
                            throw new Error('Wrong join');
                        }

                        if (watchConversationId && request.conversationId === watchConversationId) {
                            this.watch().catch(e => this.stop('Failed watch'));
                        }
                        else {
                            this.join(request).then(response => {
                                if (!response) {
                                    this.stop('Not joined');
                                }
                            }).catch(e => {
                                this.lastError = e.message;
                                this.stop('Not joined');
                            });
                        }
                    }
                    break;
                case WsClientState.Session:
                case WsClientState.WatchSession:
                    {
                        const msg: Message = JSON.parse(data.toString());

                        if (msg) {
                            this.processMessage(msg).then(result => {
                                if (false === result) {
                                    throw new Error('Failed processMessage');
                                }
                            }).catch(e => this.stop(e.message));
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
            this.stop(e.message);
        }
    }

    private onClose() {
        if (this.conversation?.id) {
            WsClient.removeClient(this.conversation.id, this);
            logger?.debug(`Client with id ${this.id} removed successfully`);
            this.stop();
        }
        else if (WsClientState.WatchSession === this.state) {
            WsClient.removeWatchClient(this);
            logger?.debug(`Watch client with id ${this.id} removed successfully`);
        }
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

        message.deletedAt = new Date();

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
                const { link, name, type, size } = request;
                message.data = { link, name, type, size };
                break;
            case 'text':
                message.data = { text: request.text };
                break;
        }

        message.updatedAt = new Date();

        const response = await store.saveMessage(message);

        if (response.result !== 'updated') {
            logger?.error(`Update message with id ${message.id} failed`);
            this.lastError = 'Update message failed';
            return false;
        }

        logger?.debug(`Message with id ${message.id} was updated successfully`);

        return true;
    }

    private async updateConversation(request: ConversationUpdate): Promise<boolean> {
        const conversation = this.conversation!;

        if (this.id !== conversation.createdBy) {
            //Only creator can update conversation
            this.lastError = 'User is not allowed to update conversation';
            return false;
        }

        conversation.title = request?.title;

        conversation.updatedAt = new Date();

        const participants = new Set([conversation.createdBy]);

        request?.participants?.forEach(p => participants.add(p));

        conversation.participants = Array.from(participants);

        const response = await store.saveConversation(conversation);

        if (response.result !== 'updated') {
            logger?.error(`Update conversation with id ${conversation.id} failed`);
            this.lastError = 'Update conversation failed';
            return false;
        }

        logger?.debug(`Conversation with id ${conversation.id} was updated successfully`);

        return true;
    }

    private async closeDeleteConversation(del: boolean): Promise<boolean | null> {
        if (!this.conversation?.id) {
            return false;
        }

        const conversation = await store.getConversationByCreatorId(this.id!, this.conversation.id);

        if (!conversation) {
            return false;
        }

        const now = new Date();
        conversation.closedAt = now;

        if (del) {
            conversation.deletedAt = now;
        }

        const response = await store.saveConversation(conversation);

        if (response.result !== 'updated') {
            logger?.error(`Close conversation with id ${conversation.id} failed`);
            this.lastError = 'Close conversation failed';
            return true;
        }

        logger?.debug(`Conversation with id ${conversation.id} was closed successfully`);

        if (del) {
            this.lastError = 'Conversation deleted';
        }

        return del ? true : null;
    }

    private async processMessage(msg: Message): Promise<boolean | null> {
        if (!msg.data && !['close', 'delete'].includes(msg.type)) {
            this.lastError = 'Wrong message';
            return false;
        }

        let data: MessageData = null, broadcast = false, save = false, result: boolean | null = null;

        const verifyConversation = () => {
            if (this.conversation!.closedAt) {
                this.lastError = 'Conversation closed';
                return false;
            }
            return true;
        }

        let broadcastType = msg.type;

        switch (msg.type) {
            case 'text':
                if (!verifyConversation()) {
                    return false;
                }

                data = msg.data;
                broadcast = !!data;
                save = true;
                break;
            case 'file':
                if (!verifyConversation()) {
                    return false;
                }

                data = msg.data;

                if (!(data as FileMessage).name) {
                    this.lastError = 'Wrong file name';
                    return false;
                }

                broadcast = !!data;
                save = true;
                break;
            case 'message-update':
                data = msg.data;
                broadcast = !!data && await this.updateMessage(data as MessageUpdate);
                if (broadcast) {
                    broadcastType = 'message-updated';
                    save = true;
                }
                break;
            case 'message-delete':
                data = msg.data;
                broadcast = !!data && await this.deleteMessage((data as MessageDelete));
                if (broadcast) {
                    broadcastType = 'message-deleted';
                    save = true;
                }
                break;
            case 'update':
                data = msg.data;
                broadcast = !!data && await this.updateConversation(data as ConversationUpdate);
                if (broadcast) {
                    broadcastType = 'updated';
                    (msg.data as ConversationUpdate).participants = this.conversation!.participants;
                    save = true;
                }
                break;
            case 'find':
                data = msg.data as FindRequest;
                await this.findMessages(data, msg.clientMessageId);
                break;
            case 'load':
                data = msg.data as LoadRequest;
                await this.loadConversations(data, msg.clientMessageId);
                break;
            case 'load-messages':
                data = msg.data as LoadRequest;
                await this.loadMessages(data, msg.clientMessageId);
                break;
            case 'delete':
                if (this.conversation!.deletedAt) {
                    this.lastError = 'Conversation already deleted';
                    return false;
                }
            /*fallbackthrough*/
            case 'close':
                if (msg.type !== 'delete' && this.conversation!.closedAt) {
                    this.lastError = 'Conversation already closed';
                    return false;
                }
                broadcast = false !== (result = await this.closeDeleteConversation(msg.type === 'delete'));
                if (broadcast) {
                    broadcastType = msg.type === 'delete' ? 'deleted' : 'closed';
                    save = true;
                }
                // if current converation was deleted then close also current websocket
                break;
            default:
                this.lastError = 'Wrong message type';
                return false;
        }

        if (broadcast) {
            return this.publishMessage(broadcastType, msg.clientMessageId, data, save);
        }

        return result;
    }

    private async connect(authInfo: AuthenticationInfo): Promise<boolean> {
        this.id = await userStore.authenticate(authInfo);

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

        const conversations = await this.getConversations();

        this.transport.send(JSON.stringify({
            type: 'connection',
            connectionId: this.connectionId,
            id: this.id,
            conversations,
        }), { binary: false, fin: true });

        return this.publishMessage('connected', undefined, null, false);
    }

    private async getConversations(from = 0, size = 100, excludeIds?: string[]): Promise<ConversationsResult> {
        const result = await store.getParticipantConversations(this.id!, excludeIds || [], from, size);

        const ids = result.conversations.map(c => c.id!);

        if (!ids?.length) {
            return {
                conversations: [],
                from,
                size,
                total: 0,
            };
        }

        const messagesInfo = await store.getLastMessagesTimestamps(this.id!, ids);

        const conversations = result.conversations.map(c => ({
            ...c,
            leftAt: c.id! in messagesInfo ? messagesInfo[c.id!].left : undefined,
            latestMessage: c.id! in messagesInfo ? messagesInfo[c.id!].latest : undefined,
        }));

        return {
            conversations,
            from,
            size,
            total: result.total,
        }
    }

    private async findMessages(request: FindRequest, clientMessageId?: string): Promise<void> {
        const result = await store.getParticipantConversations(this.id!, [], request.from || 0, request.size || 100);

        if (request.conversationIds?.length) {
            request.conversationIds = Array.from(new Set(result.conversations.map(c => c.id!).concat(request.conversationIds)));
        }
        else {
            request.conversationIds = result.conversations.map(c => c.id!);
        }

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

        const result = await this.getConversations(request.from, request.size, request.excludeIds);

        this.send({ type: 'loaded', clientMessageId, conversations: result.conversations, count: result.total });
    }
}

export function initialize(config: Config, log?: Log) {
    instanceId = config.instanceId;
    logger = log;
    queue = config.queue;
    store = config.store;
    userStore = config.userStore;
    watchConversationId = config.watchConversationId;

    queue?.subscribe(WsClient.translateQueueMessage);
}