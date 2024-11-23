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

export type MessageType = 'connected' | 'disconnected' | 'joined' | 'left' | 'closed' | 'deleted' | 'loaded' | 'updated' | 'message-updated' | 'message-deleted' | 'text' | 'file'

export type MessageData = ConversationUpdate | FileMessage | MessageDelete | MessageUpdate | TextMessage | null

export interface Message {
    type: MessageType
    id?: string
    clientMessageId?: string  
    instanceId: string
    conversationId?: string
    participants?: string[]
    connectionId: string
    fromId: string
    data: MessageData
    createdAt: Date
    updatedAt?: Date
    deletedAt?: Date
}

export interface MessageQueue {
    acceptTypes?: MessageType[]
    publish: (msg: Message) => Promise<boolean>
    subscribe: (callback: (msg: Message) => Promise<void>) => Promise<boolean>
    unsubscribe?: (callback: (msg: Message) => Promise<void>) => Promise<boolean>
}