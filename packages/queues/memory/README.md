# only-chat
This is an in-memory queue implementation for only-chat.

# Get started

```shell
npm i --save @only-chat/in-memory-queue
```

```typescript
import { initialize as initializeQueue } from '@only-chat/in-memory-queue'
import { initialize as initializeClient, WsClient } from '@only-chat/client'

...

const queue = await initializeQueue()

initializeClient({queue, store, userStore, instanceId}, logger)

const ws = new WebSocketServer({ host, port })

ws.on('connection', s => new WsClient(s))
```