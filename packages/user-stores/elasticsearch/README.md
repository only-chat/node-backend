# only-chat
This is an Elasticsearch user store implementation for only-chat.

# Get started

```shell
npm i --save @only-chat/elasticsearch-user-store
```

```typescript
import { initialize as initializeUserStore } from '@only-chat/elasticsearch-user-store'
import { initialize as initializeClient, WsClient } from '@only-chat/client'

...

const userStore = await initializeUserStore(userStoreConfig);

initializeClient({queue, store, userStore, instanceId}, logger)

const ws = new WebSocketServer({ host, port })

ws.on('connection', s => new WsClient(s))
```