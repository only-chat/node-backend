export interface Connection {
    id?: string
    instanceId: string
    timestamp: Date
    userId: string
}

export interface Conversation {
    id?: string
    clientConversationId?: string
    title?: string
    participants: string[]
    createdBy: string
    createdAt: Date
    updatedAt?: Date
    closedAt?: Date
    deletedAt?: Date
}

export interface ConversationUpdate {
    title?: string
    participants?: string[]
}

export interface FileMessage {
    link: string
    name: string
    type: string
    size: number
}

export interface TextMessage {
    text: string
}

export interface MessageDelete {
    messageId: string
}

export interface MessageUpdate extends Partial<FileMessage>, Partial<TextMessage> {
    messageId: string
}

export interface FindRequest {
    from?: number
    size?: number
    sort?: string
    sortDesc?: boolean
    ids?: string[]
    clientMessageIds?: string[]
    excludeIds?: string[]
    conversationIds?: string[]
    fromIds?: string[]
    types?: MessageType[]
    createdFrom?: Date
    createdTo?: Date
    text?: string
}

export interface FindResult {
    messages: Message[]
    from: number
    size: number
    total: number
}

export interface LoadRequest {
    from?: number
    size?: number
    excludeIds?: string[]
    before?: Date
}

export type MessageType = 'hello' | 'connected' | 'disconnected' | 'joined' | 'left' | 'close' | 'closed' | 'delete' | 'deleted' | 'update' | 'updated' | 'load' | 'message-update' | 'message-updated' | 'message-delete' | 'message-deleted' | 'text' | 'file' | 'find' | 'load-messages'

export type MessageData = ConversationUpdate | FileMessage | FindRequest | LoadRequest | MessageDelete | MessageUpdate | TextMessage | null

export interface Message {
    type: MessageType
    id?: string
    clientMessageId?: string
    conversationId: string
    participants: string[]
    fromConnectionId: string
    fromId: string
    data: MessageData
    createdAt: Date
    updatedAt?: Date
    deletedAt?: Date
}

export interface SaveResponse {
    _id: string
    result: string
}

export type ConversationLastMessages = Record<string, { latest?: Message, left?: Date }>

export interface ConversationsResult {
    conversations: Conversation[]
    from: number
    size: number
    total: number
}

export interface MessageStore {
    findMessages: (r: FindRequest) => Promise<FindResult>
    getConversationByCreatorId: (createdBy: string, id: string) => Promise<Conversation | undefined>
    getConversationById: (id: string) => Promise<Conversation | undefined>
    getLastMessagesTimestamps: (fromId: string, conversationId: string[]) => Promise<ConversationLastMessages>
    getParticipantConversationById: (participant: string | undefined, id: string) => Promise<Conversation | undefined>
    getParticipantConversations: (participant: string, excludeIds: string[], from: number, size: number) => Promise<ConversationsResult>
    getParticipantLastMessage: (participant: string, conversationId: string) => Promise<Message | undefined>
    getPeerToPeerConversationId(peer1: string, peer2: string): Promise<string | undefined>
    saveConnection: (userId: string, instanceId: string) => Promise<SaveResponse>
    saveConversation: (c: Conversation) => Promise<SaveResponse>
    saveMessage: (m: Message) => Promise<SaveResponse>
}