# only-chat
This is an in-memory message store implementation for only-chat.

# Get started

```shell
npm i --save @only-chat/in-memory-store
```

```typescript
import { initialize as initializeStore, saveInstance } from '@only-chat/in-memory-store';
import { initialize as initializeClient, WsClient } from '@only-chat/client'

...

const store = await initializeStore();

const { _id: instanceId } = await saveInstance();

initializeClient({queue, store, userStore, instanceId}, logger)

const ws = new WebSocketServer({ host, port })

ws.on('connection', s => new WsClient(s))
```