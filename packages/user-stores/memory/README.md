# only-chat
This is an in-memory user store implementation for only-chat.

# Get started

```shell
npm i --save @only-chat/in-memory-user-store
```

```typescript
import { initialize as initializeUserStore } from '@only-chat/in-memory-user-store'
import { initialize as initializeClient, WsClient } from '@only-chat/client'

...

const userStore = await initializeUserStore();

initializeClient({queue, store, userStore, instanceId}, logger)

const ws = new WebSocketServer({ host, port })

ws.on('connection', s => new WsClient(s))
```