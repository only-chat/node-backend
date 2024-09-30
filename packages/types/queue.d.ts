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

export interface MessageUpdate {
    messageId: string
    data?: FileMessage | TextMessage
}

export type MessageType = 'connected' | 'disconnected' | 'joined' | 'left' | 'closed' | 'deleted' | 'updated' | 'message-updated' | 'message-deleted' | 'text' | 'file'

export type MessageData = ConversationUpdate | FileMessage | MessageDelete | MessageUpdate | TextMessage | null

export interface Message {
    type: MessageType
    id?: string
    clientMessageId?: string  
    instanceId: string
    conversationId?: string
    participants?: string[]
    fromConnectionId: string
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