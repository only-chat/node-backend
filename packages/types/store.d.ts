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

export interface ConversationIdResult {
    id?: string
    result?: string
}

export interface ConversationsResult {
    conversations: Conversation[]
    from: number
    size: number
    total: number
}

export interface MessageStore {
    /**
     * Searches for messages based on filter criteria with pagination and sorting support
     * 
     * @param r - FindRequest object containing search parameters including:
     *   - ids: Message IDs to retrieve
     *   - conversationIds: Messages from specific conversations
     *   - text: Text content filter (searches within text messages)
     *   - fromIds: Sender IDs
     *   - types: Message types (e.g., 'text', 'file')
     *   - clientMessageIds: Client-provided message IDs
     *   - excludeIds: Message IDs to exclude from results
     *   - createdFrom/createdTo: Date range filters
     *   - sort: Field to sort by (e.g., 'createdAt')
     *   - sortDesc: Whether to sort in descending order
     *   - from: Pagination starting index
     *   - size: Maximum number of results to return
     * 
     * @returns Promise<FindResult> containing filtered, sorted, and paginated messages
     */
    findMessages: (r: FindRequest) => Promise<FindResult>
    /**
     * Retrieves the latest message and last participant message for each specified conversation
     * 
     * @param participant - The user ID of the participant requesting the information
     * @param conversationId - Array of conversation IDs to fetch last message info for
     * 
     * @returns Promise<ConversationLastMessages> - Object mapping conversation IDs to:
     *   - latest: The most recent non-deleted message of type 'text' or 'file'
     *   - left: Timestamp of the last message sent by the specified participant
     */
    getLastMessagesTimestamps: (fromId: string, conversationId: string[]) => Promise<ConversationLastMessages>
    /**
     * Retrieves a single conversation by ID for a specific participant
     *  
     * @param participant - Optional participant ID; if provided, verifies the participant is part of the conversation
     * @param id - The unique identifier of the conversation to retrieve
     * 
     * @returns Promise<Conversation | undefined> - The conversation object if found and accessible,
     *          undefined if conversation doesn't exist, is deleted, or doesn't have specified participant
     */
    getParticipantConversationById: (participant: string | undefined, id: string) => Promise<Conversation | undefined>
    /**
     * Retrieves a paginated list of conversations for a specific participant with optional filtering
     * 
     * @param participant - The user ID of the participant whose conversations to retrieve
     * @param ids - Optional array of conversation IDs to filter by (if undefined, returns all conversations)
     * @param excludeIds - Optional array of conversation IDs to exclude from results
     * @param from - Pagination starting index (default: 0)
     * @param size - Maximum number of conversations to return (default: 100)
     * 
     * @returns Promise<ConversationsResult> - Paginated result containing:
     *   - conversations: Array of conversations sorted by creation date (newest first)
     *   - from: The starting index used for pagination
     *   - size: The number of conversations returned
     *   - total: The total number of conversations for the participant
     */
    getParticipantConversations: (participant: string, ids?: string[], excludeIds?: string[], from?: number, size?: number) => Promise<ConversationsResult>
    /**
     * Retrieves the last non-deleted message sent by a specific participant in a conversation
     * 
     * @param participant - The user ID of the participant whose last message to find
     * @param conversationId - The unique identifier of the conversation
     * 
     * @returns Promise<Message | undefined> - The last message sent by the participant in the conversation,
     *          undefined if conversation doesn't exist, is deleted, participant is not in conversation,
     *          or participant has no messages
     */
    getParticipantLastMessage: (participant: string, conversationId: string) => Promise<Message | undefined>
    /**
     * Gets or creates a peer-to-peer conversation ID between two users
     * 
     * @param peer1 - First user ID
     * @param peer2 - Second user ID
     * 
     * @returns Promise<ConversationIdResult | undefined> - Object containing:
     *   - id: The conversation ID (existing or newly created)
     *   - result: 'created' if a new conversation was created, undefined if existing conversation was found
     * 
     * Note: The conversation ID is deterministic - same two users will always get the same ID
     *       regardless of parameter order (peer1 and peer2 are sorted internally)
     */
    getPeerToPeerConversationId(peer1: string, peer2: string): Promise<ConversationIdResult | undefined>
    /**
     * Saves a connection record for a user instance (e.g., WebSocket connection)
     * 
     * @param userId - The ID of the user establishing the connection
     * @param instanceId - The instance identifier for this connection
     * 
     * @returns Promise<SaveResponse> - Object containing:
     *   - _id: The auto-generated unique connection ID
     *   - result: Always 'created' since connections are always new entries
     */
    saveConnection: (userId: string, instanceId: string) => Promise<SaveResponse>
    /**
     * Saves or updates a conversation in the store
     * 
     * @param c - Conversation to save. If the conversation has an ID,
     *            it updates the existing conversation; otherwise creates a new one
     * 
     * @returns Promise<SaveResponse> - Object containing:
     *   - _id: The conversation ID (preserved if provided, auto-generated if new)
     *   - result: 'created' for new conversations, 'updated' for existing ones
     */
    saveConversation: (c: Conversation) => Promise<SaveResponse>
    /**
     * Saves or updates a message in the store and associates it with a conversation
     * 
     * @param m - Message to save. If the message has an ID,
     *            it updates the existing message; otherwise creates a new one
     * 
     * @returns Promise<SaveResponse> - Object containing:
     *   - _id: The message ID (preserved if provided, auto-generated if new)
     *   - result: 'created' for new messages, 'updated' for existing ones
     */
    saveMessage: (m: Message) => Promise<SaveResponse>
}