# only-chat
This is a client implementation for only-chat.

The client is a main part of the platform that processes and dispatches messages from the transport layer and from the queue.

# Client Statuses

| Status | Value | Description |
| :--- | :--- | :--- |
| None | 0 | The client was created, no actions have been performed with it. |
| Authenticated | 1 | The client is successfully authenticated. |
| Connected | 2 | The client is successfully connected to the server. |
| Session | 3 | The client has joined one of the chats. |
| WatchSession | 4 | The client is monitoring changes in all chats. |
| Disconnected | 0xFF | The client is successfully disconnected from the server. |

## Request Structure

For all commands, the request is of the type `Request`:

```typescript
{
  type: string;        // Command type
  clientMessageId: string; // Client identifier
  data: object;        // Request data
}
```

## Command Specifications

### Status: `None`

*   Any command is treated as a connection command to the service.
*   **Must be of request type:** `ConnectRequest`.

---

### Status: `Connected`, `Session`, or `WatchSession`

The command must be of request type `JoinRequest` or `Request`.

| Command | Description | Request Data Type |
| :--- | :--- | :--- |
| `close` | Command to close a conversation; new messages cannot be added to a closed conversation. | `ConversationRequest` |
| `delete` | Command to delete a conversation. If a user attempts to delete a conversation where they are not the creator, they will be removed from the conversation and the participant list. | `ConversationRequest` |
| `update` | Command to modify a conversation; the creator can change the title and participant list. | `ConversationRequest` |
| `find` | Search for messages in conversations. | `FindRequest` |
| `load` | Retrieve the list of the user's conversations. | `LoadRequest` |

---

### Status: `Connected`

The command must be of request type `JoinRequest`.

| Command | Description |
| :--- | :--- |
| `join` | Join a conversation. |
| `watch` | Monitor changes in conversations. |

---

### Status: `Session`

The command must be of request type `Request`.

| Command | Description | Request Data Type |
| :--- | :--- | :--- |
| `text` | Add a text message to the current conversation. | `TextMessage` |
| `file` | Add a message with a link to an external resource in the current conversation. | `FileMessage` |
| `message-update` | Command to edit a message in the current conversation; the author can modify it. | `MessageUpdate` |
| `message-delete` | Command to delete a message in the current conversation; the author can delete it. | `MessageDelete` |
| `load-messages` | Command to load messages in the current conversation. | `LoadRequest` |

---

## Error Handling

Any other command or an incorrect request type is considered an error and results in forced connection termination and disconnection of the client from the service.