export interface ConversationUpdate {
    conversationId?: string
    title?: string
    participants?: string[]
    closedAt?: Date
    deletedAt?: Date
    updatedAt?: Date
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
    deletedAt: Date
}

export interface MessageUpdate extends Partial<FileMessage>, Partial<TextMessage> {
    messageId: string
    updatedAt: Date
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
     // Provide list of accepted message types
    readonly acceptTypes?: MessageType[]
    /**
     * Publishes a message to the queue if its type is accepted
     * 
     * @param msg - The message object to publish
     * @returns Promise<boolean> - true if message was published, false if message type is not accepted
     */
    publish: (msg: Message) => Promise<boolean>
     /**
     * Subscribes a callback function to receive messages from the queue
     * 
     * @param callback - Async function that processes incoming messages
     * @returns Promise<boolean> - Always returns true when subscription is added
     * 
     * Note: Multiple subscribers can be registered, and all will be called for each message
     */
    subscribe: (callback: (msg: Message) => Promise<void>) => Promise<boolean>
    /**
     * Unsubscribes a previously registered callback function
     * 
     * @param callback - The callback function to remove
     * @returns Promise<boolean> - true if callback was found and removed, false otherwise
     * 
     * Note: Only removes the last occurrence if the same callback was added multiple times
     */
    unsubscribe?: (callback: (msg: Message) => Promise<void>) => Promise<boolean>
}