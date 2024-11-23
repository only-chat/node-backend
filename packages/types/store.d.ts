export interface Connection {
    id?: string
    instanceId: string
    timestamp: Date
    userId: string
}

export interface Conversation {
    id?: string
    title?: string
    participants: string[]
    createdBy: string
    createdAt: Date
    updatedAt?: Date
    closedAt?: Date
    deletedAt?: Date
}

export interface ConversationUpdate {
    conversationId?: string
    title?: string
    participants?: string[]
    closedAt?: Date
    deletedAt?: Date
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

export type MessageType = 'joined' | 'left' | 'closed' | 'deleted' | 'updated' | 'message-updated' | 'message-deleted' | 'text' | 'file'

export type MessageData = ConversationUpdate | FileMessage | MessageDelete | MessageUpdate | TextMessage | null

export interface Message {
    type: MessageType
    id?: string
    clientMessageId?: string
    conversationId?: string
    participants?: string[]
    connectionId: string
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