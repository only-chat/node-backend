# only-chat
This is an Elasticsearch messages store implementation for only-chat.

# Get started

```shell
npm i --save @only-chat/elasticsearch-store
```

```typescript
import { initialize as initializeStore, saveInstance } from '@only-chat/elasticsearch-store'
import { initialize as initializeClient, WsClient } from '@only-chat/client'

...

const store = await initializeStore(storeConfig);

const { _id: instanceId } = await saveInstance(appId);

initializeClient({queue, store, userStore, instanceId}, logger)

const ws = new WebSocketServer({ host, port })

ws.on('connection', s => new WsClient(s))
```